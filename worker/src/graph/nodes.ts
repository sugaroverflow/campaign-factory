// Graph node implementations. Agent execution is delegated to w3's
// executeAgentTurn / runSynthesisReview (injected via RuntimeContext). Nodes own
// durable identity, event emission, proposal capture, deterministic proposal
// APPLICATION (via w1-db's reducer), Step Report stamping, cost/cancel guards,
// and Terminal Gaps. Agents never mutate state (ADR 0008).

import { randomUUID } from "node:crypto";
import type { RunnableConfig } from "@langchain/core/runnables";
import { agentDef, agentDefFor, type AgentKey, type SpecialistKey } from "@web/lib/factory/contracts/roster.js";
import { journeyStepByKey, type JourneyStepKey } from "@web/lib/factory/contracts/journey.js";
import { MAX_JUDGEMENT_REQUESTS_PER_RUN } from "@web/lib/factory/contracts/state.js";
import type { CampaignState, ChangeProposal, ProposalOp } from "@web/lib/factory/contracts/state.js";
import { runtimeLimitsFor, type RuntimeLimits } from "@web/lib/factory/contracts/limits.js";
import type { AgentTaskEnvelope, AgentResult } from "@web/lib/factory/contracts/envelope.js";
import type { ExecutorDeps } from "../agents/deps.js";
import { contextFrom, type RuntimeContext } from "./context.js";
import { GraphState, type GraphStateType, type PendingProposal } from "./state.js";
import type { ReviewPass } from "./review-contract.js";
import { checkCost } from "../cost.js";
import * as store from "../store/index.js";

// Node return type is the channel UPDATE shape (pendingProposals accepts the
// "clear" sentinel; terminalGaps appends), not the stored value shape.
type Patch = typeof GraphState.Update;

const MAX_INLINE_DOC_BYTES = 32 * 1024;

function deadlineIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

// ---- Halt guard: cancellation + hard time limit + cost hard stop ------------

// Hard execution limit (parameters §5): crossing hardCampaignLimitMs (25 min,
// both profiles — the "publish everything" point) stops STARTING new model
// nodes; deterministic finalisation still runs and the remaining work is
// recorded as Terminal Gaps — same semantics as the cost hard stop. The
// separate absoluteWallClockMs (30 min) bounds the post-cap review exception
// in reviewGate. Returns the halt reason, or null while within the limit.
function hardTimeLimit(startedAt: string | undefined, limits: RuntimeLimits): string | null {
  if (!startedAt) return null;
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (elapsedMs < limits.hardCampaignLimitMs) return null;
  const limitMin = limits.hardCampaignLimitMs / 60000;
  return `Hard execution limit reached (${Math.round(elapsedMs / 60000)} min elapsed; limit ${limitMin} min)`;
}

// Returns a halt patch (recording gaps for the sections this node would build)
// or null to proceed.
async function guard(
  ctx: RuntimeContext,
  state: GraphStateType,
  sections: string[],
  checkCostGuard: boolean,
): Promise<Patch | null> {
  if (state.halted) {
    return { terminalGaps: sections.map((s) => gapText(s, state.haltReason ?? "run halted")) };
  }
  const run = await store.getRun(ctx.sql, state.campaignId);
  if (ctx.signal.aborted || run?.status === "cancelled") {
    const reason = "run cancelled";
    return { halted: true, haltReason: reason, terminalGaps: sections.map((s) => gapText(s, reason)) };
  }
  const timeUp = hardTimeLimit(run?.startedAt, runtimeLimitsFor(ctx.profile));
  if (timeUp) {
    return { halted: true, haltReason: timeUp, terminalGaps: sections.map((s) => gapText(s, timeUp)) };
  }
  if (checkCostGuard) {
    const cost = await checkCost(ctx.sql, state.campaignId, ctx.batchId);
    await ctx.emitter.emit({
      type: "cost.update",
      visibility: "public",
      payload: {
        summary: `Spend $${cost.campaignSpendUSD.toFixed(2)}${cost.campaignWarning ? " (warning)" : ""}`,
        detail: { campaignUSD: cost.campaignSpendUSD, batchUSD: cost.batchSpendUSD },
      },
    });
    if (cost.hardStop) {
      return {
        halted: true,
        haltReason: cost.reason,
        terminalGaps: sections.map((s) => gapText(s, cost.reason ?? "cost hard stop")),
      };
    }
  }
  return null;
}

function gapText(section: string, reason: string): string {
  return `${section} not built (${reason})`;
}

// The distinct sections/documents a set of pending proposals would change.
function proposalTargets(pending: PendingProposal[]): string[] {
  const targets = new Set<string>();
  for (const pp of pending) {
    for (const op of pp.proposal.ops) {
      if (op.op === "set_section" || op.op === "merge_section") targets.add(String(op.step));
      else if (op.op === "set_pack") targets.add(String(op.document));
    }
  }
  return [...targets];
}

// The distinct sections/documents ONE proposal would change (for per-proposal
// Terminal Gaps on rejection).
function singleProposalTargets(pp: PendingProposal): string[] {
  return proposalTargets([pp]);
}

// ---- Accepted-content excerpts (W3's published campaign cards) ---------------

// Statement/summary-like fields surface first in an excerpt.
const EXCERPT_PREFERRED_KEYS = new Set([
  "statement",
  "summary",
  "narrative",
  "interpretation",
  "formal",
  "dm",
  "action",
  "whoActs",
  "mvw",
  "success",
]);

// Plain-text excerpt of accepted section content: readable strings pulled out
// of the structured content object (preferred fields first), joined with
// separators — never raw JSON braces. ≤ `max` chars.
function sectionExcerpt(content: unknown, max = 280): string {
  const preferred: string[] = [];
  const rest: string[] = [];
  const visit = (value: unknown, key?: string, depth = 0): void => {
    if (depth > 4 || preferred.length + rest.length > 24) return;
    if (typeof value === "string") {
      const text = value.replace(/\s+/g, " ").trim();
      if (text.length < 3) return;
      (key && EXCERPT_PREFERRED_KEYS.has(key) ? preferred : rest).push(text);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, key, depth + 1);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, k, depth + 1);
    }
  };
  visit(content);
  const joined = [...preferred, ...rest].join(" · ");
  if (joined.length <= max) return joined;
  return `${joined.slice(0, max - 1).trimEnd()}…`;
}

// Where an accepted artefact flows next (for artefact.handoff summaries).
const HANDOFF_NEXT: Record<ReviewPass, string> = {
  evidence: "Analysis",
  analysis: "Strategy",
  strategy: "Planning & Production",
  final: "Document compilation",
};

// ---- One agent turn (delegated to w3) --------------------------------------

function buildDeps(
  ctx: RuntimeContext,
  agentRunId: string,
  key: AgentKey,
  parentAgentRunId: string | undefined,
  primaryStep: number,
): ExecutorDeps {
  return {
    emit: ctx.emitter.forAgent({ agentRunId, parentAgentRunId, journeyStep: primaryStep }),
    gate: ctx.gate,
    sql: ctx.sql,
    recordUsage: ctx.recordUsage,
    agentDef: agentDefFor(key, ctx.profile),
    modelMode: ctx.modelMode,
    signal: ctx.signal,
    apiKey: ctx.apiKey,
    apiProvider: ctx.apiProvider,
    now: () => new Date(),
  };
}

async function runAgent(
  ctx: RuntimeContext,
  state: GraphStateType,
  key: AgentKey,
  parentAgentRunId?: string,
): Promise<PendingProposal[]> {
  const def = agentDefFor(key, ctx.profile);
  const agentRunId = randomUUID();
  const primaryStep = def.journeySteps[0];
  const version = state.stateVersion;

  await store.createAgentRun(ctx.sql, {
    agentRunId,
    campaignId: state.campaignId,
    batchId: ctx.batchId,
    agentKey: key,
    displayName: def.displayName,
    parentAgentRunId,
    status: "running",
    journeySteps: def.journeySteps,
    model: def.model,
    effort: def.effort,
  });
  const task = `${def.responsibility}. Problem: "${state.problem}". Place: "${state.place}".`;
  await ctx.emitter.emit({
    type: "agent.started",
    agentRunId,
    parentAgentRunId,
    journeyStep: primaryStep,
    payload: {
      summary: `${def.displayName} started`,
      verb: "starting",
      agentKey: key,
      agentDisplayName: def.displayName,
      // W3's cards show WHAT the agent is doing, not just that it started.
      detail: { task: task.slice(0, 200) },
    },
  });

  const envelope: AgentTaskEnvelope = {
    batchId: ctx.batchId,
    campaignId: state.campaignId,
    agentRunId,
    parentAgentRunId,
    stateVersion: version,
    journeySteps: def.journeySteps,
    task,
    contextRefs: [],
    evidenceRefs: [],
    constraints: [],
    toolPolicy: def.toolPolicy,
    deadlineAt: deadlineIso(def.timeoutMs),
  };
  const deps = buildDeps(ctx, agentRunId, key, parentAgentRunId, primaryStep);

  // One visible operational retry after a timeout/provider/tool failure.
  let result: AgentResult | null = null;
  for (let attempt = 1; attempt <= 2 && result === null; attempt++) {
    try {
      result = await ctx.executeAgentTurn(envelope, deps);
    } catch (err) {
      if (attempt === 1) {
        await ctx.emitter.emit({
          type: "agent.retry",
          agentRunId,
          journeyStep: primaryStep,
          payload: { summary: `${def.shortName} retrying after a failure`, agentKey: key },
        });
        continue;
      }
      // Give up: visible failure + a Terminal Gap, but the graph continues.
      await store.setAgentRunStatus(ctx.sql, agentRunId, "failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await ctx.emitter.emit({
        type: "agent.failed",
        agentRunId,
        journeyStep: primaryStep,
        payload: { summary: `${def.displayName} failed`, agentKey: key, agentDisplayName: def.displayName },
      });
      await ctx.emitter.emit({
        type: "gap.terminal",
        agentRunId,
        journeyStep: primaryStep,
        payload: { summary: gapText(def.shortName, "agent failed"), agentKey: key },
      });
      return [];
    }
  }
  if (!result) return [];

  // Executor RETURNED a failed result (timeout after retry, provider failure,
  // effectively-empty output, …). Same honesty contract as the throw path
  // above: visible failure + a Terminal Gap for this agent's responsibilities —
  // never a silently missing section. Nothing downstream applies from it.
  if (result.status === "failed") {
    const reason = result.workSummary || "agent returned a failed result";
    await store.setAgentRunStatus(ctx.sql, agentRunId, "failed", {
      workSummary: result.workSummary,
      confidence: result.confidence,
    });
    await ctx.emitter.emit({
      type: "agent.failed",
      agentRunId,
      journeyStep: primaryStep,
      payload: { summary: `${def.displayName} failed: ${reason}`.slice(0, 280), agentKey: key, agentDisplayName: def.displayName },
    });
    await ctx.emitter.emit({
      type: "gap.terminal",
      agentRunId,
      journeyStep: primaryStep,
      payload: { summary: gapText(def.shortName, reason.slice(0, 160)), agentKey: key },
    });
    return [];
  }

  // Persist claims (assign id/author/version); collect for evidence-ref resolution.
  const assignedClaimIds: string[] = [];
  for (const draft of result.claims) {
    const claim = await store.upsertClaim(ctx.sql, {
      ...draft,
      authorAgentRunId: agentRunId,
      adjudicatedBy: key === "evidence_adjudicator" ? agentRunId : undefined,
      stateVersion: version,
    });
    assignedClaimIds.push(claim.id);
  }

  // Nonblocking Judgement Request: record + emit + apply provisional default.
  // Capped at MAX_JUDGEMENT_REQUESTS_PER_RUN per campaign — the excess is
  // recorded honestly as an evidence.gap (folded into next checks) rather than
  // emitted as another judgement; the provisional default still applies either
  // way, so nothing blocks.
  if (result.judgementRequest) {
    const jr = result.judgementRequest;
    // Reserve a slot through the per-run serialised counter (context.ts): a
    // plain read-then-insert races under Promise.all clusters and can exceed
    // the cap. The counter loads the DB count once (resume-safe) and hands out
    // at most MAX_JUDGEMENT_REQUESTS_PER_RUN reservations per process run.
    const reserved = await ctx.judgementSlots.reserve(
      async () => (await store.listJudgements(ctx.sql, state.campaignId)).length,
    );
    if (!reserved) {
      await ctx.emitter.emit({
        type: "evidence.gap",
        agentRunId,
        journeyStep: primaryStep,
        payload: {
          summary: `Judgement cap (${MAX_JUDGEMENT_REQUESTS_PER_RUN}) reached — folded into next checks: ${jr.question}`,
          agentKey: key,
          detail: {
            question: jr.question,
            provisionalDefault: jr.provisionalDefault,
            rationale: jr.rationale,
            affectedOutputs: jr.affectedOutputs,
            cap: MAX_JUDGEMENT_REQUESTS_PER_RUN,
            foldedIntoNextChecks: true,
          },
        },
      });
      // Provisional default proceeds implicitly; no judgement row/events.
    } else {
      const judgementId = randomUUID();
      const full = {
        id: judgementId,
        campaignId: state.campaignId,
        agentRunId,
        kind: jr.kind,
        question: jr.question,
        options: jr.options,
        provisionalDefault: jr.provisionalDefault,
        rationale: jr.rationale,
        affectedOutputs: jr.affectedOutputs,
        status: "defaulted" as const,
        answer: jr.provisionalDefault,
      };
      await store.insertJudgement(ctx.sql, full);
      await ctx.emitter.emit({
        type: "judgement.requested",
        agentRunId,
        journeyStep: primaryStep,
        payload: { summary: `Judgement: ${jr.question}`, judgementId, agentKey: key, detail: { ...full } },
      });
      await ctx.emitter.emit({
        type: "judgement.defaulted",
        agentRunId,
        journeyStep: primaryStep,
        payload: {
          summary: `Applied provisional default: ${jr.provisionalDefault}`,
          judgementId,
          detail: { judgementId, answer: jr.provisionalDefault },
        },
      });
    }
  }

  // Specialist escalation is recorded but auto-declined (scope-guard cut #2).
  if (result.specialistRequest) {
    await ctx.emitter.emit({
      type: "specialist.requested",
      agentRunId,
      payload: { summary: `Requested specialist: ${result.specialistRequest.specialist}`, agentKey: key },
    });
    await ctx.emitter.emit({
      type: "specialist.rejected",
      agentRunId,
      payload: {
        summary: "Escalation beyond the two selected specialists is out of scope for this build",
        agentKey: key,
      },
    });
  }

  if (result.conflict) {
    await ctx.emitter.emit({
      type: "evidence.conflicted",
      agentRunId,
      payload: { summary: result.conflict.description, agentKey: key, claimIds: result.conflict.claimIds },
    });
  }

  // Build full proposals (assign id/agentRunId/status), resolve evidence refs.
  const pending: PendingProposal[] = [];
  for (const draft of result.proposals) {
    const proposal: ChangeProposal = {
      ...draft,
      id: randomUUID(),
      agentRunId,
      status: "submitted",
    };
    const resolved = store.resolveEvidenceRefs(proposal, assignedClaimIds);
    await ctx.emitter.emit({
      type: "proposal.submitted",
      agentRunId,
      journeyStep: primaryStep,
      payload: { summary: resolved.summary || `${def.shortName} proposal`, proposalId: resolved.id, agentKey: key },
    });
    pending.push({ proposal: resolved, agentKey: key });
  }

  // Invisible QA (w3): deterministic checks always; Haiku pass in live only.
  // Flags are surfaced to the reviewer (never as agent events).
  let qaFlags: string[] = [];
  try {
    qaFlags = await ctx.runQA(
      { result, def, campaignId: state.campaignId, agentRunId, batchId: ctx.batchId },
      deps,
    );
  } catch {
    qaFlags = [];
  }
  for (const pp of pending) pp.qaFlags = qaFlags;

  await store.setAgentRunStatus(ctx.sql, agentRunId, result.status, {
    workSummary: result.workSummary,
    confidence: result.confidence,
  });
  await ctx.emitter.emit({
    type: result.status === "complete" ? "agent.completed" : result.status === "partial" ? "agent.partial" : "agent.failed",
    agentRunId,
    journeyStep: primaryStep,
    payload: {
      summary: result.workSummary || `${def.displayName} ${result.status}`,
      agentKey: key,
      agentDisplayName: def.displayName,
    },
  });

  return pending;
}

// ---- Specialist selection (deterministic scheduler, not an agent) -----------

const SPECIALIST_HINTS: Array<[RegExp, SpecialistKey]> = [
  [/council|cabinet|councillor|local authority|mayor|combined authority/i, "local_government"],
  [/\bmp\b|parliament|minister|\bbill\b|commons|constituency/i, "parliamentary"],
  [/nhs|regulator|ofsted|ofcom|agency|quango|transport for/i, "public_body"],
  [/planning|application|development|consultation|local plan/i, "planning"],
  [/media|news|resident|community|campaign group/i, "local_media"],
  [/precedent|similar|opposition|objection|comparable/i, "precedent_opposition"],
];

function selectSpecialists(problem: string, place: string, count = 2): SpecialistKey[] {
  const text = `${problem} ${place}`;
  const picked: SpecialistKey[] = [];
  for (const [re, key] of SPECIALIST_HINTS) {
    if (re.test(text) && !picked.includes(key)) picked.push(key);
    if (picked.length === count) break;
  }
  while (picked.length < count) {
    const fallback: SpecialistKey[] = ["local_government", "local_media"];
    const next = fallback.find((k) => !picked.includes(k));
    if (!next) break;
    picked.push(next);
  }
  return picked.slice(0, count);
}

// ---- Nodes ------------------------------------------------------------------

export function researchDirectorNode() {
  return async (state: GraphStateType, config?: RunnableConfig): Promise<Patch> => {
    const ctx = contextFrom(config);
    const halt = await guard(ctx, state, ["problem"], true);
    if (halt) return halt;
    const proposals = await runAgent(ctx, state, "research_director");
    // Contribute only this node's proposals; the channel reducer appends
    // (the specialists run in the SAME superstep) and reviewers clear.
    return { pendingProposals: proposals };
  };
}

export function specialistsClusterNode() {
  return async (state: GraphStateType, config?: RunnableConfig): Promise<Patch> => {
    const ctx = contextFrom(config);
    const halt = await guard(ctx, state, ["evidence"], true);
    if (halt) return halt;
    // Selection is a deterministic regex over problem+place — it needs nothing
    // from the director, so this wave runs CONCURRENTLY with the director
    // (build.ts fans both out of START; the adjudicator joins on both).
    // Specialist context comes from the task string (problem+place) plus
    // whatever claims exist at execution time — fewer while the director is
    // still running, which is fine.
    // Express profile runs ONE specialist; full runs two.
    const keys = state.selectedSpecialists.length
      ? state.selectedSpecialists
      : selectSpecialists(state.problem, state.place, ctx.profile === "express" ? 1 : 2);
    for (const key of keys) {
      const def = agentDef(key);
      await ctx.emitter.emit({
        type: "specialist.approved",
        payload: { summary: `Selected specialist: ${def.displayName}`, agentKey: key, detail: { useWhen: (def as { useWhen?: string }).useWhen } },
      });
      await ctx.emitter.emit({
        type: "specialist.spawned",
        payload: { summary: `${def.displayName} spawned`, agentKey: key },
      });
    }
    // 2 selected specialists in parallel (real concurrent model calls, gated).
    const results = await Promise.all(keys.map((k) => runAgent(ctx, state, k)));
    return { pendingProposals: results.flat(), selectedSpecialists: keys };
  };
}

// A node that runs a fixed set of agent keys in parallel and captures proposals.
export function agentClusterNode(keys: AgentKey[], sections: string[]) {
  return async (state: GraphStateType, config?: RunnableConfig): Promise<Patch> => {
    const ctx = contextFrom(config);
    const halt = await guard(ctx, state, sections, true);
    if (halt) return halt;
    const results = await Promise.all(keys.map((k) => runAgent(ctx, state, k)));
    return { pendingProposals: results.flat() };
  };
}

// ---- Reviewer node ----------------------------------------------------------

export function reviewerNode(pass: ReviewPass, journeySteps: number[]) {
  return async (state: GraphStateType, config?: RunnableConfig): Promise<Patch> => {
    const ctx = contextFrom(config);
    const pending = state.pendingProposals;
    // Dropping un-reviewed proposals must be HONEST: their target sections/
    // documents are recorded as Terminal Gaps, never silently discarded.
    const dropPending = (reason: string): Patch => ({
      pendingProposals: "clear",
      terminalGaps: proposalTargets(pending).map((t) => `${t} not accepted (${reason})`),
    });
    // Hard-time-limit EXCEPTION (batch 7 fix): finished work never goes
    // unreviewed. Past hardCampaignLimitMs, model-call waves stay guarded (the
    // shared guard() halts them), but a review pass over already-SUBMITTED
    // proposals always runs — batch 7 binned five finished deliverables when
    // the final review was blocked at the cap. Cancellation and cost halts are
    // NOT excepted; only the time limit is.
    const haltedByTime = state.halted && (state.haltReason ?? "").startsWith("Hard execution limit reached");
    if (state.halted && !(haltedByTime && pending.length > 0)) {
      return dropPending(state.haltReason ?? "run halted");
    }
    const run = await store.getRun(ctx.sql, state.campaignId);
    if (ctx.signal.aborted || run?.status === "cancelled") {
      return { halted: true, haltReason: "run cancelled", ...dropPending("run cancelled") };
    }
    const limits = runtimeLimitsFor(ctx.profile);
    // Absolute wall clock (user, 16 Jul): the review exception below must not
    // stretch a run past 30 minutes — beyond it, pending work drops to gaps
    // and the run closes with what is already published.
    const absoluteUp =
      run?.startedAt != null &&
      Date.now() - new Date(run.startedAt).getTime() >= limits.absoluteWallClockMs;
    if (absoluteUp) {
      const reason = `Absolute wall clock reached (${limits.absoluteWallClockMs / 60000} min)`;
      return { halted: true, haltReason: reason, ...dropPending(reason) };
    }
    const timeUp = hardTimeLimit(run?.startedAt, limits) ?? (haltedByTime ? state.haltReason ?? null : null);
    if (timeUp) {
      if (pending.length === 0) {
        return { halted: true, haltReason: timeUp, ...dropPending(timeUp) };
      }
      await ctx.emitter.emit({
        type: "work.update",
        agentRunId: state.reviewerAgentRunId,
        journeyStep: journeySteps[0],
        payload: {
          summary: "Past the time limit — reviewing finished work before closing",
          verb: "reviewing",
          agentKey: "synthesis_reviewer",
        },
      });
      // fall through: the review pass runs; the returned patch marks the run halted.
    }
    if (pending.length === 0) return { pendingProposals: "clear" };

    // Time-aware routing: past the soft campaign target the strategy revision
    // loop (two extra Opus waves) is unaffordable — a returned strategy
    // proposal becomes an honest Terminal Gap instead of a revision.
    const elapsedMs = run?.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0;
    const overSoftTarget = elapsedMs > limits.softCampaignTargetMs;

    const reviewerAgentRunId = state.reviewerAgentRunId;
    const reviewerDef = agentDefFor("synthesis_reviewer", ctx.profile);
    const deps: ExecutorDeps = {
      emit: ctx.emitter.forAgent({ agentRunId: reviewerAgentRunId, journeyStep: journeySteps[0] }),
      gate: ctx.gate,
      sql: ctx.sql,
      recordUsage: ctx.recordUsage,
      agentDef: reviewerDef,
      modelMode: ctx.modelMode,
      signal: ctx.signal,
      apiKey: ctx.apiKey,
      apiProvider: ctx.apiProvider,
      now: () => new Date(),
    };

    await ctx.emitter.emit({
      type: "work.update",
      agentRunId: reviewerAgentRunId,
      journeyStep: journeySteps[0],
      payload: { summary: `Reviewing ${pass} proposals`, verb: "reviewing", agentKey: "synthesis_reviewer" },
    });

    // Base state (before applying) — also the source of prior Step Reports.
    let currentState: CampaignState = await store.getAcceptedState(ctx.sql, state.campaignId);
    const priorStepReports: Array<{ step: number; report: string }> = [];
    for (const [key, sec] of Object.entries(currentState.sections)) {
      if (sec?.stepReport) priorStepReports.push({ step: journeyStepByKey(key as JourneyStepKey).step, report: sec.stepReport });
    }
    const qaFlagsByProposalId: Record<string, string[]> = {};
    for (const pp of pending) {
      if (pp.qaFlags && pp.qaFlags.length) qaFlagsByProposalId[pp.proposal.id] = pp.qaFlags;
    }

    const outcome = await ctx.review(
      {
        campaignId: state.campaignId,
        batchId: ctx.batchId,
        reviewerAgentRunId,
        pass,
        journeySteps,
        proposals: pending.map((p) => p.proposal),
        priorStepReports,
        qaFlagsByProposalId,
        profile: ctx.profile,
      },
      deps,
    );
    const reviewById = new Map(outcome.reviews.map((r) => [r.proposalId, r]));

    // Apply accepted proposals sequentially against the live state version, in
    // INPUT order (director's evidence set_section before specialists' merges).
    let version = currentState.version;
    const acceptedSteps: string[] = [];
    let needsStrategyRevision = false;

    // Counts for the Step Build Receipt (W4 nice-to-have).
    const agentCount = (await store.listAgentRuns(ctx.sql, state.campaignId)).length;
    const sourceCount = (await store.getSources(ctx.sql, state.campaignId)).length;
    // artefact.handoff is capped at one per producing agent within this pass.
    const handedOff = new Set<string>();

    // A rejected/returned proposal with NO revision loop leaves its sections
    // missing — that must be a visible Terminal Gap, never a silent drop.
    const emitRejectionGaps = async (pp: PendingProposal, rationale: string, kind: string) => {
      const excerpt = (rationale || "no reason given").replace(/\s+/g, " ").slice(0, 140);
      for (const target of singleProposalTargets(pp)) {
        await ctx.emitter.emit({
          type: "gap.terminal",
          agentRunId: pp.proposal.agentRunId,
          payload: { summary: gapText(target, `${kind}: ${excerpt}`), agentKey: pp.agentKey },
        });
      }
    };

    for (const pp of pending) {
      const proposal = pp.proposal;
      const r = reviewById.get(proposal.id) ?? {
        proposalId: proposal.id,
        decision: "return" as const,
        rationale: "reviewer omitted a decision",
        stepReport: undefined,
      };

      if (r.decision === "reject") {
        await ctx.emitter.emit({
          type: "proposal.rejected",
          agentRunId: proposal.agentRunId,
          payload: { summary: r.rationale || "Proposal rejected", proposalId: proposal.id, agentKey: pp.agentKey },
        });
        await emitRejectionGaps(pp, r.rationale, "reviewer rejected");
        continue;
      }
      if (r.decision === "return") {
        // EXPRESS: a return becomes ACCEPT-WITH-DISSENT (user decision, 15 Jul).
        // The graph has no revision loop here, and a hole in the brief is a
        // worse outcome than flagged content: the content lands, the reviewer's
        // objection ships verbatim as a Next Check on the affected sections,
        // and the dissent stays in the rationale (ADR: preserve dissent).
        if (ctx.profile === "express") {
          const affected = proposal.ops.flatMap((op) =>
            op.op === "set_section" || op.op === "merge_section" ? [op.step] : [],
          );
          proposal.ops.push({
            op: "add_next_check",
            check: {
              description: `Reviewer dissent (accepted with reservations): ${(r.rationale || "unspecified").slice(0, 400)}`,
              reason: "reviewer_return_express",
              affectedSections: affected,
            },
          });
          await ctx.emitter.emit({
            type: "work.update",
            agentRunId: reviewerAgentRunId,
            journeyStep: journeySteps[0],
            payload: {
              summary: `Accepted with dissent recorded: ${(r.rationale || "").slice(0, 140)}`,
              agentKey: "synthesis_reviewer",
            },
          });
          // fall through to the accept path below
        } else {
          await ctx.emitter.emit({
            type: "proposal.returned",
            agentRunId: proposal.agentRunId,
            payload: { summary: r.rationale || "Returned for one revision", proposalId: proposal.id, agentKey: pp.agentKey },
          });
          // Only the strategy pass has a revision loop, only within the soft
          // time target. Everywhere else a "return" is terminal for the section.
          const loopAvailable = pass === "strategy" && state.strategyRevisions < 1;
          if (loopAvailable && !overSoftTarget) {
            needsStrategyRevision = true;
          } else {
            if (loopAvailable && overSoftTarget) {
              await ctx.emitter.emit({
                type: "work.update",
                agentRunId: reviewerAgentRunId,
                journeyStep: journeySteps[0],
                payload: {
                  summary: `Skipping strategy revision — ${Math.round(elapsedMs / 60000)} min elapsed exceeds the ${limits.softCampaignTargetMs / 60000} min soft target`,
                  agentKey: "synthesis_reviewer",
                },
              });
            }
            await emitRejectionGaps(pp, r.rationale, "reviewer returned; no revision loop");
          }
          continue;
        }
      }

      // accept → rebase to current version (sequential applies within a cluster)
      const rebased: ChangeProposal = { ...proposal, baseStateVersion: version };
      const { state: nextState, errors } = store.applyProposal(currentState, rebased);
      if (errors.length > 0) {
        await ctx.emitter.emit({
          type: "proposal.rejected",
          agentRunId: proposal.agentRunId,
          payload: { summary: `Reducer rejected: ${errors[0]}`, proposalId: proposal.id, agentKey: pp.agentKey },
        });
        await ctx.emitter.emit({
          type: "gap.terminal",
          agentRunId: proposal.agentRunId,
          payload: { summary: gapText(pp.agentKey, "invalid proposal content"), agentKey: pp.agentKey },
        });
        continue;
      }

      // Stamp Step Reports onto touched sections (deterministic; ADR 0008).
      if (r.stepReport) stampStepReport(nextState, rebased.ops, r.stepReport);

      version = nextState.version;
      currentState = nextState;
      await store.saveStateVersion(ctx.sql, {
        campaignId: state.campaignId,
        version,
        state: nextState,
        createdByAgentRunId: proposal.agentRunId,
        proposalId: proposal.id,
      });
      await store.setRunStateVersion(ctx.sql, state.campaignId, version);

      await ctx.emitter.emit({
        type: "proposal.accepted",
        agentRunId: proposal.agentRunId,
        payload: { summary: r.rationale || "Accepted", proposalId: proposal.id, agentKey: pp.agentKey },
      });
      // Excerpt of the accepted content for W3's published campaign cards:
      // taken from the FIRST section this proposal touched (post-apply state).
      const firstSectionOp = rebased.ops.find(
        (op): op is Extract<ProposalOp, { op: "set_section" | "merge_section" }> =>
          op.op === "set_section" || op.op === "merge_section",
      );
      const firstStep = firstSectionOp ? (firstSectionOp.step as JourneyStepKey) : undefined;
      const appliedExcerpt = firstStep
        ? {
            excerpt: sectionExcerpt(nextState.sections[firstStep]?.content),
            sectionTitle: journeyStepByKey(firstStep).title,
          }
        : undefined;
      await ctx.emitter.emit({
        type: "proposal.applied",
        agentRunId: proposal.agentRunId,
        stateVersion: version,
        payload: {
          summary: `Applied to campaign state v${version}`,
          proposalId: proposal.id,
          agentKey: pp.agentKey,
          ...(appliedExcerpt ? { detail: appliedExcerpt } : {}),
        },
      });

      // Emit the FULL accepted content per op (events are the transport).
      for (const op of rebased.ops) {
        if (op.op === "set_section" || op.op === "merge_section") {
          const step = op.step as JourneyStepKey;
          const sectionState = nextState.sections[step];
          acceptedSteps.push(step);
          await ctx.emitter.emit({
            type: "section.status",
            agentRunId: proposal.agentRunId,
            journeyStep: journeyStepByKey(step).step,
            stateVersion: version,
            payload: {
              summary: `Section accepted: ${journeyStepByKey(step).title}`,
              sectionStep: journeyStepByKey(step).step,
              sectionStatus: "accepted",
              detail: {
                content: sectionState?.content,
                stepReport: sectionState?.stepReport ?? r.stepReport,
                evidenceClaimIds: sectionState?.evidenceClaimIds ?? [],
                nextChecks: nextState.nextChecks,
                agentCount,
                sourceCount,
                excerpt: sectionExcerpt(sectionState?.content),
                sectionTitle: journeyStepByKey(step).title,
              },
            },
          });
        } else if (op.op === "set_pack") {
          const doc = nextState.documents.find((d) => d.key === op.document);
          const resources = doc?.resources ?? op.resources;
          const inline = JSON.stringify(resources).length <= MAX_INLINE_DOC_BYTES;
          await ctx.emitter.emit({
            type: "document.status",
            agentRunId: proposal.agentRunId,
            stateVersion: version,
            payload: {
              summary: `Document ready: ${op.document}`,
              documentKey: op.document,
              documentStatus: "ready",
              detail: {
                documentKey: op.document,
                documentStatus: "ready",
                version,
                ...(inline ? { resources } : {}),
              },
            },
          });
        }
      }

      // Accepted work flows to the next wave — make the handoff visible
      // (artefact.handoff, ≤1 per producing agent per pass).
      if (!handedOff.has(proposal.agentRunId)) {
        handedOff.add(proposal.agentRunId);
        const packOp = rebased.ops.find(
          (op): op is Extract<ProposalOp, { op: "set_pack" }> => op.op === "set_pack",
        );
        const artefact = firstStep
          ? journeyStepByKey(firstStep).title
          : packOp
            ? packOp.document.replace(/_/g, " ")
            : "accepted work";
        await ctx.emitter.emit({
          type: "artefact.handoff",
          agentRunId: proposal.agentRunId,
          journeyStep: journeySteps[0],
          stateVersion: version,
          payload: {
            summary: `Handed ${artefact} to ${HANDOFF_NEXT[pass]}`,
            agentKey: pp.agentKey,
            proposalId: proposal.id,
          },
        });
      }
    }

    if (outcome.passStepReport) {
      await ctx.emitter.emit({
        type: "work.update",
        agentRunId: reviewerAgentRunId,
        journeyStep: journeySteps[0],
        payload: { summary: outcome.passStepReport, agentKey: "synthesis_reviewer" },
      });
    }

    const patch: Patch = { pendingProposals: "clear", stateVersion: version, acceptedSteps };
    if (timeUp) {
      // The exception reviewed finished work; the run still closes halted so
      // no further model-call waves start.
      patch.halted = true;
      patch.haltReason = timeUp;
    }
    if (needsStrategyRevision) {
      patch.needsStrategyRevision = true;
      patch.strategyRevisions = state.strategyRevisions + 1;
    } else {
      patch.needsStrategyRevision = false;
    }
    return patch;
  };
}

function stampStepReport(state: CampaignState, ops: ProposalOp[], stepReport: string): void {
  for (const op of ops) {
    if (op.op === "set_section" || op.op === "merge_section") {
      const s = state.sections[op.step as JourneyStepKey];
      if (s) s.stepReport = stepReport;
    }
  }
}

// Re-export the state root so build.ts imports one place.
export { GraphState };
