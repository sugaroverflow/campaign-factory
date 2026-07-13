import { postcodeLookup } from "./geo";
import { runResearch } from "./stageA";
import { runPlan } from "./stageB";
import { runDrafts } from "./stageC";
import { runLint } from "./lint";
import { publicInput, errMsg, now } from "./util";
import { addSpend } from "../spend/ledger";
import { costUSD, WEB_SEARCH_COST_USD, type Usage } from "../spend/pricing";
import {
  type RunInput,
  type RunState,
  type RunMutator,
  type ResearchResult,
  type Plan,
  type Drafts,
  type StageId,
  type StageStatus,
} from "./types";

export interface RunHooks {
  onResearchText?: (delta: string) => void; // live research feed (M3)
}

// The durable run. Stages fail independently (no synthetic fallback): whatever
// completed stays on the campaign, failed stages are marked, the run ends
// "partial" if some produced and some failed, "failed" only if nothing usable.
//
// NOTE (durability): this function is written as a sequence of pure stage calls
// that mutate RunState through `mutate`. In production it will be wrapped in a
// Vercel Workflow so it survives function timeouts; the in-memory store (dev)
// and the Workflow store share this same shape.
export async function runPipeline(input: RunInput, mutate: RunMutator, hooks: RunHooks = {}): Promise<void> {
  const note = (t: string) => mutate((s) => void s.notes.push(t));
  const setStage = (id: StageId, status: StageStatus, error?: string) =>
    mutate((s) => {
      s.stages[id] = { status, ...(error ? { error } : {}) };
      s.updatedAt = now();
    });

  // Usage → cost: accumulate on the run and add to the global daily ledger that
  // the kill-switch reads.
  const onUsage = (model: string, usage: Usage) => {
    const c = costUSD(model, usage);
    if (c > 0) {
      mutate((s) => void (s.costUSD += c));
      addSpend(c);
    }
  };

  let anyFailed = false;
  mutate((s) => void (s.status = "running"));

  // Deterministic geography (keyless, no LLM).
  const pc = await postcodeLookup(input.location || input.problem);
  if (pc) note(`Geography verified via postcodes.io: ${pc.evidence}`);

  // Stage A — research
  let research: ResearchResult | null = null;
  setStage("research", "running");
  try {
    research = await runResearch(input, { onText: hooks.onResearchText, onNote: note, onUsage });
    // approximate the web-search server-tool cost (not in token usage)
    addSpend(WEB_SEARCH_COST_USD);
    mutate((s) => void (s.costUSD += WEB_SEARCH_COST_USD));
    mutate((s) => {
      s.campaign.research = research!;
      if (research!.campaignName) s.campaign.name = research!.campaignName;
      s.campaign.refinedProblem = research!.refinedProblem;
      s.campaign.interpretation = research!.interpretation;
      s.campaign.sources = [...(pc ? [pc] : []), ...(research!.claims || [])];
      s.campaign.completed.research = true;
    });
    setStage("research", "done");
  } catch (e) {
    anyFailed = true;
    setStage("research", "failed", errMsg(e));
    note("Research failed — continuing with what we have.");
    if (pc) mutate((s) => void (s.campaign.sources = [pc]));
  }

  // Stage B — plan (Opus)
  let plan: Plan | null = null;
  setStage("plan", "running");
  try {
    plan = await runPlan(input, research, onUsage);
    mutate((s) => {
      s.campaign.plan = plan!;
      s.campaign.completed.plan = true;
    });
    setStage("plan", "done");
  } catch (e) {
    anyFailed = true;
    setStage("plan", "failed", errMsg(e));
    note("Plan generation failed.");
  }

  // Stage C — drafts (only meaningful with research or plan)
  let drafts: Drafts | null = null;
  if (research || plan) {
    setStage("drafts", "running");
    try {
      drafts = await runDrafts(input, research, plan, { onNote: note, onUsage });
      mutate((s) => {
        s.campaign.drafts = drafts!;
        s.campaign.completed.drafts = !!(drafts!.lobbying || drafts!.media || drafts!.digital);
      });
      setStage("drafts", "done");
    } catch (e) {
      anyFailed = true;
      setStage("drafts", "failed", errMsg(e));
      note("Drafting failed.");
    }
  } else {
    setStage("drafts", "failed", "Skipped — no research or plan to draft from");
    anyFailed = true;
  }

  // Lint — Haiku consistency check (only if we have drafts)
  if (drafts && (drafts.lobbying || drafts.media || drafts.digital)) {
    setStage("lint", "running");
    try {
      const lint = await runLint(input, research, drafts, onUsage);
      mutate((s) => {
        s.campaign.lint = lint;
        s.campaign.completed.lint = true;
      });
      setStage("lint", lint.ok ? "done" : "done");
      if (!lint.ok) note(`Consistency check flagged ${lint.flags.filter((f) => f.severity === "block").length} item(s) to verify.`);
    } catch (e) {
      setStage("lint", "failed", errMsg(e));
      note("Consistency check unavailable.");
    }
  } else {
    setStage("lint", "pending");
  }

  // Final status
  mutate((s) => {
    const c = s.campaign.completed;
    if (c.research && c.plan && c.drafts) s.status = anyFailed ? "partial" : "complete";
    else if (c.research || c.plan || c.drafts) s.status = "partial";
    else s.status = "failed";
    s.updatedAt = now();
  });
}

// Build the initial run state (empty campaign — no synthetic baseline).
export function initialRunState(id: string, input: RunInput): RunState {
  const ts = now();
  const pending = { status: "pending" as StageStatus };
  return {
    id,
    status: "queued",
    stages: { research: { ...pending }, plan: { ...pending }, drafts: { ...pending }, lint: { ...pending } },
    notes: [],
    campaign: {
      id,
      name: input.org ? `${input.org} campaign` : "Untitled campaign",
      input: publicInput(input),
      sources: [],
      completed: { research: false, plan: false, drafts: false, lint: false },
      createdAt: ts,
    },
    costUSD: 0,
    startedAt: ts,
    updatedAt: ts,
  };
}
