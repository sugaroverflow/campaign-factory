// Resolves the two agent-brain functions the graph delegates to:
//   executeAgentTurn (w3, worker/src/agents/executor.ts) — the 18 non-reviewer agents
//   runSynthesisReview (w3, worker/src/agents/reviewer.ts) — the recurring reviewer
//
// w3 OWNS both, incl. the FACTORY_MODEL_MODE=mock path. When their modules are
// present they always win. The local fallbacks below exist ONLY so W2 can
// verify the queue→graph→events→SSE→checkpoint pipeline end-to-end before w3's
// files land; they produce schema-valid minimal content and zero-cost usage.
// The dynamic imports use computed specifiers so a missing module is a runtime
// fallback, not a compile error.

import type { AgentTurnFn } from "../agents/deps.js";
import type { ReviewFn, ReviewOutcome, QAFn } from "./review-contract.js";
import type { AgentResult, ChangeProposalDraft, ClaimDraft } from "@web/lib/factory/contracts/envelope.js";
import type { AgentTaskEnvelope } from "@web/lib/factory/contracts/envelope.js";
import type { JourneyStepKey } from "@web/lib/factory/contracts/journey.js";
import { recordSource } from "../store/index.js";

export interface RuntimeAgents {
  executeAgentTurn: AgentTurnFn;
  review: ReviewFn;
  runQA: QAFn;
  source: string; // "w3" | "w3-executor+mock-reviewer" | "mock" — surfaced at boot
}

// Dynamic import via a computed specifier: (1) sidesteps tsx/esbuild's inability
// to statically link named VALUE imports through a barrel (w3's warning), and
// (2) lets the local fallbacks below cover a not-yet-landed module.
async function tryImport(spec: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(spec)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function loadRuntimeAgents(): Promise<RuntimeAgents> {
  const mod = await tryImport("../agents/index.js");

  const executeAgentTurn =
    (mod?.executeAgentTurn as AgentTurnFn | undefined) ?? localMockExecuteAgentTurn;

  let review: ReviewFn;
  if (typeof mod?.runSynthesisReview === "function") {
    const fn = mod.runSynthesisReview as (i: unknown, d: unknown) => Promise<unknown>;
    review = async (input, deps): Promise<ReviewOutcome> => {
      const out = (await fn(input, deps)) as {
        reviews?: Array<{ proposalId: string; decision: "accept" | "return" | "reject"; rationale?: string; stepReport?: string }>;
        workSummary?: string;
      };
      const reviews = Array.isArray(out?.reviews)
        ? out.reviews.map((r) => ({
            proposalId: r.proposalId,
            decision: r.decision,
            rationale: r.rationale ?? "",
            stepReport: r.stepReport,
          }))
        : input.proposals.map((p) => ({ proposalId: p.id, decision: "return" as const, rationale: "reviewer omitted a decision" }));
      return { reviews, passStepReport: out?.workSummary };
    };
  } else {
    review = localMockReview;
  }

  let runQA: QAFn;
  if (typeof mod?.runInvisibleQA === "function") {
    const fn = mod.runInvisibleQA as (i: unknown, d: unknown) => Promise<unknown>;
    runQA = async (input, deps): Promise<string[]> => {
      const flags = (await fn(input, deps)) as unknown[];
      return Array.isArray(flags) ? flags.map(qaToString) : [];
    };
  } else {
    runQA = async () => [];
  }

  const source = mod?.executeAgentTurn
    ? mod?.runSynthesisReview
      ? "w3"
      : "w3-executor+mock-reviewer"
    : "mock";
  return { executeAgentTurn, review, runQA, source };
}

function qaToString(f: unknown): string {
  if (typeof f === "string") return f;
  const o = f as { message?: string; code?: string; detail?: string };
  return o?.message ?? o?.detail ?? o?.code ?? JSON.stringify(f);
}

/* -------------------------------------------------------------------------- */
/* Local fallbacks (removed from the hot path the moment w3's modules land).   */
/* -------------------------------------------------------------------------- */

// agentKey -> the primary section it sets, or the pack it produces.
const SECTION_FOR: Record<string, JourneyStepKey> = {
  research_director: "problem",
  evidence_adjudicator: "evidence",
  local_government: "evidence",
  parliamentary: "evidence",
  public_body: "evidence",
  planning: "evidence",
  local_media: "evidence",
  precedent_opposition: "evidence",
  objective_strategist: "objective",
  decision_route: "decision_route",
  power_stakeholder: "power",
  pressure_analysis: "pressure",
  strategy_architect: "strategy",
  tactics_planner: "tactics",
  organising_designer: "organising",
};
const PACK_FOR: Record<string, "lobbying_pack" | "media_pack" | "digital_pack"> = {
  lobbying_producer: "lobbying_pack",
  media_producer: "media_pack",
  digital_producer: "digital_pack",
};

function minimalContent(step: JourneyStepKey, env: AgentTaskEnvelope): unknown {
  const where = env.campaignId.slice(0, 8);
  switch (step) {
    case "problem":
      return { statement: `Mock problem for ${where}`, interpretation: "Mock interpretation." };
    case "evidence":
      return { summary: "Mock research summary from official sources.", researchQuestions: ["Who decides?"] };
    case "objective":
      return { dm: "Mock decision-maker", action: "Adopt the mock measure", by: "next quarter" };
    case "decision_route":
      return { formal: "Mock cabinet decision", implementer: "Mock officer" };
    case "power":
      return { stakeholders: [{ name: "Mock Councillor", role: "Cabinet member", tier: "decides" }] };
    case "pressure":
      return { pressures: [{ type: "reputational", on: "Mock body", why: "Mock reason" }] };
    case "strategy":
      return { narrative: "Mock campaign narrative.", audiences: ["Residents"] };
    case "tactics":
      return { tactics: [{ name: "Mock tactic", phase: 1, purpose: "Build pressure" }] };
    case "organising":
      return { whoActs: "Mock residents group", asks: ["Sign the mock letter"] };
    case "documents":
      return { summary: "Mock document overview." };
    default:
      return {};
  }
}

function buildMockProposals(agentKey: string, env: AgentTaskEnvelope): ChangeProposalDraft[] {
  const base = { campaignId: env.campaignId, baseStateVersion: env.stateVersion, assumptions: [] as string[] };
  const pack = PACK_FOR[agentKey];
  if (pack) {
    return [
      {
        ...base,
        summary: `Mock ${pack.replace("_", " ")}`,
        ops: [
          {
            op: "set_pack",
            document: pack,
            resources: [{ key: `${pack}_item`, title: "Mock resource", body: "Mock body text." }],
            evidenceClaimIds: [],
          },
        ],
      },
    ];
  }
  const step = SECTION_FOR[agentKey];
  if (!step) return [];
  return [
    {
      ...base,
      summary: `Mock ${step} section`,
      ops: [{ op: "set_section", step, content: minimalContent(step, env), evidenceClaimIds: [] }],
    },
  ];
}

const localMockExecuteAgentTurn: AgentTurnFn = async (env, deps) => {
  const key = deps.agentDef.key;
  await deps.emit({
    type: "work.update",
    payload: { summary: `${deps.agentDef.shortName} working on a mock turn`, verb: "working", agentKey: key },
  });

  const claims: ClaimDraft[] = [];
  if (deps.agentDef.searchBudget > 0) {
    await deps.emit({ type: "source.search.started", payload: { summary: "Searching official sources", agentKey: key } });
    const src = await recordSource(deps.sql, {
      campaignId: env.campaignId,
      url: `https://example.gov.uk/mock/${key}`,
      title: "Mock official record",
      organisation: "Mock Council",
      accessedAt: new Date().toISOString(),
      tier: "A",
      isPrimary: true,
      mediaType: "html",
      contentHash: `mock-${key}`,
      retrievalStatus: "fetched",
    });
    await deps.emit({
      type: "source.fetch.completed",
      payload: { summary: "Fetched mock official record", agentKey: key, sourceIds: [src.id] },
    });
    await deps.emit({
      type: "evidence.found",
      payload: { summary: "Found a mock load-bearing fact", agentKey: key, sourceIds: [src.id] },
    });
    claims.push({
      campaignId: env.campaignId,
      text: `Mock verified fact from ${key}`,
      type: "context",
      status: "Verified public information",
      loadBearing: true,
      confidence: "medium",
      sourceIds: [src.id],
      excerpt: "…mock excerpt…",
      affectedOutputs: [],
    });
  }

  await deps.recordUsage({
    campaignId: env.campaignId,
    batchId: env.batchId,
    agentRunId: env.agentRunId,
    model: deps.agentDef.model,
    inputTokens: 0,
    outputTokens: 0,
    costUSD: 0,
  });

  const result: AgentResult = {
    agentRunId: env.agentRunId,
    status: "complete",
    workSummary: `${deps.agentDef.shortName} completed a mock turn`,
    claims,
    proposals: buildMockProposals(key, env),
    unknowns: [],
    confidence: "medium",
    handoffs: [],
  };
  return result;
};

const localMockReview: ReviewFn = async (input) => {
  return {
    reviews: input.proposals.map((p) => ({
      proposalId: p.id,
      decision: "accept" as const,
      rationale: "Mock reviewer accepted the proposal.",
      stepReport: `Mock ${input.pass} step report.`,
    })),
    passStepReport: `Mock ${input.pass} pass complete.`,
  };
};
