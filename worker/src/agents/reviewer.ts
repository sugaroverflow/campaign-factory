// runSynthesisReview — the recurring Campaign Synthesis Reviewer node. It does
// NOT go through executeAgentTurn (its output is ProposalReviews + Step Reports,
// not an AgentResult). W2's reviewer node calls this once per proposal cluster,
// then deterministically applies accepted proposals via w1's reducer and emits
// proposal.* / section.status / document.status events.
//
// Split (agreed with W2): this function decides + writes Step Reports; W2 owns
// state mutation and proposal-status events. The Opus 4.8 upgrade for the
// strategy review and the final whole-campaign review is applied here.

import type {
  AgentRunId,
  AgentTerminalStatus,
  BatchId,
  CampaignId,
  ChangeProposal,
  ReviewDecision,
} from "@web/lib/factory/contracts/index.js";
// Value imports direct from their modules (contracts barrel uses `export *`).
import { JOURNEY_STEPS, journeyStepByKey } from "@web/lib/factory/contracts/journey.js";
import { REVIEWER_OPUS_MODEL, REVIEWER_OPUS_STEPS } from "@web/lib/factory/contracts/roster.js";
import {
  REVIEW_SCHEMA,
  SYNTHESIS_REVIEWER_SYSTEM,
  formatProposalsForReview,
  parseReview,
  reviewerUserMessage,
} from "@web/lib/factory/agents/index.js";
import { getAcceptedState } from "@web/lib/factory/store/state-versions.js";
import type { ExecutorDeps } from "./deps.js";
import {
  EmptyOutputError,
  runModelTurn,
  TurnAbortedError,
  TurnTimeoutError,
  type ModelTurnResult,
  type ModelTurnSpec,
} from "./model-call.js";
import { WorkEmitter } from "./work.js";
import { mockReview } from "./mock.js";

export type ReviewPass = "evidence" | "analysis" | "strategy" | "final";

export interface ReviewInput {
  campaignId: CampaignId;
  batchId?: BatchId;
  reviewerAgentRunId: AgentRunId; // stable across all reviewer turns
  pass: ReviewPass;
  journeySteps: number[];
  proposals: ChangeProposal[]; // full, status "submitted"
  acceptedStateExtracts?: string; // optional pre-assembled context; else assembled here
  priorStepReports?: Array<{ step: number; report: string }>;
  qaFlagsByProposalId?: Record<string, string[]>;
  profile?: "full" | "express"; // express reviews never escalate to Opus
}

export interface ReviewOutcome {
  reviewerAgentRunId: AgentRunId;
  status: AgentTerminalStatus;
  workSummary: string;
  confidence: "high" | "medium" | "low";
  // One entry per input proposal (never fewer): decision + rationale (dissent
  // preserved verbatim) + the Step Report for that proposal's primary step.
  reviews: Array<{ proposalId: string; decision: ReviewDecision; rationale: string; stepReport?: string }>;
  stepReports: Array<{ step: number; report: string }>;
  consistencyFlags: string[];
}

function useOpus(input: ReviewInput): boolean {
  // Express keeps every review pass on the roster model: the Opus strategy
  // review alone consumed ~8 of the 15-minute budget in live batch 3
  // (15 Jul), starving planning/production entirely.
  if (input.profile === "express") return false;
  return (
    input.pass === "strategy" ||
    input.pass === "final" ||
    input.journeySteps.some((s) => REVIEWER_OPUS_STEPS.includes(s))
  );
}

function proposalPrimaryStep(p: ChangeProposal): number {
  for (const op of p.ops) {
    if (op.op === "set_section" || op.op === "merge_section") return journeyStepByKey(op.step).step;
    if (op.op === "set_pack") return 10;
  }
  return 0;
}

export async function runSynthesisReview(input: ReviewInput, deps: ExecutorDeps): Promise<ReviewOutcome> {
  const journeyStep = input.journeySteps[0];
  const work = new WorkEmitter(deps, "synthesis_reviewer", journeyStep);

  if (deps.modelMode === "mock") {
    return mockReview(input, deps, work);
  }

  const def = deps.agentDef;
  const model = useOpus(input) ? REVIEWER_OPUS_MODEL : def.model;
  const maxOutputTokens = input.pass === "final" ? 6000 : def.maxOutputTokens;

  const contextExtracts = input.acceptedStateExtracts ?? (await assembleReviewerContext(input, deps));
  const proposalsBlock = formatProposalsForReview(input.proposals, (id) => input.qaFlagsByProposalId?.[id] ?? []);
  const priorReports = (input.priorStepReports ?? [])
    .map((r) => `Step ${r.step}: ${r.report}`)
    .join("\n");
  const fullContext = [
    contextExtracts,
    priorReports ? `PRIOR STEP REPORTS:\n${priorReports}` : "",
    `PROPOSALS AWAITING YOUR DECISION:\n${proposalsBlock}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const spec: ModelTurnSpec = {
    system: SYNTHESIS_REVIEWER_SYSTEM,
    userText: reviewerUserMessage(fullContext, { isFinal: input.pass === "final", step: journeyStep ?? 0 }),
    schema: REVIEW_SCHEMA,
    structuredOutput: false,
    model,
    effort: "high",
    adaptiveThinking: true, // reviewer runs on Sonnet/Opus, both adaptive
    maxOutputTokens,
    timeoutMs: def.timeoutMs,
    tools: undefined,
    def,
    campaignId: input.campaignId,
    agentRunId: input.reviewerAgentRunId,
    batchId: input.batchId,
    journeyStep,
    work,
  };

  work.work(`Reviewing ${input.proposals.length} proposal${input.proposals.length === 1 ? "" : "s"}`, "reviewing");
  // The reviewer is a model call like any other: acquire the concurrency gate
  // (kind "model" — no tools) so review turns count against the campaign/global
  // call caps exactly as executor turns do.
  const release = await deps.gate.acquire({
    campaignId: input.campaignId,
    mode: input.batchId ? "presenter" : "public",
    kind: "model",
  });
  let turn: ModelTurnResult | null;
  try {
    turn = await runReviewTurn(spec, deps, work);
  } finally {
    release();
  }
  work.flush();

  if (!turn) {
    // Operational failure after a retry: return every proposal held for revision
    // rather than silently accepting or rejecting.
    return {
      reviewerAgentRunId: input.reviewerAgentRunId,
      status: "failed",
      workSummary: "The reviewer could not complete after a retry (timeout or provider failure).",
      confidence: "low",
      reviews: input.proposals.map((p) => ({
        proposalId: p.id,
        decision: "return" as ReviewDecision,
        rationale: "Reviewer turn failed; held for revision.",
      })),
      stepReports: [],
      consistencyFlags: [],
    };
  }

  const parsed = parseReview(turn.raw);
  const byId = new Map(parsed.reviews.map((r) => [r.proposalId, r]));
  const stepReportFor = (step: number) => parsed.stepReports.find((s) => s.step === step)?.report;

  const reviews = input.proposals.map((p) => {
    const decided = byId.get(p.id);
    const step = proposalPrimaryStep(p);
    return {
      proposalId: p.id,
      decision: decided?.decision ?? ("return" as ReviewDecision),
      rationale: decided?.rationale ?? "Reviewer did not return an explicit decision; held for revision.",
      stepReport: stepReportFor(step),
    };
  });

  return {
    reviewerAgentRunId: input.reviewerAgentRunId,
    status: "complete",
    workSummary: parsed.workSummary || `Reviewed ${input.proposals.length} proposal(s).`,
    confidence: parsed.confidence,
    reviews,
    stepReports: parsed.stepReports,
    consistencyFlags: parsed.consistencyFlags,
  };
}

async function runReviewTurn(
  spec: ModelTurnSpec,
  deps: ExecutorDeps,
  work: WorkEmitter,
): Promise<ModelTurnResult | null> {
  try {
    return await runModelTurn(spec, deps);
  } catch (e) {
    if (e instanceof TurnAbortedError) throw e;
    // Empty output already had its in-turn correction retry inside
    // runModelTurn; a second full review turn would only burn budget. Fall
    // through to the safe hold-for-revision outcome.
    if (e instanceof EmptyOutputError) return null;
    deps
      .emit({
        type: "agent.retry",
        journeyStep: spec.journeyStep,
        payload: {
          summary: `Reviewer retrying after ${e instanceof TurnTimeoutError ? "a timeout" : "a provider error"}`,
          verb: "retrying",
          agentKey: "synthesis_reviewer",
        },
      })
      .catch((err) => console.error("[agents] synthesis_reviewer: agent.retry emit failed:", err));
    work.work("Retrying review", "retrying");
    try {
      return await runModelTurn(spec, deps);
    } catch (e2) {
      if (e2 instanceof TurnAbortedError) throw e2;
      return null;
    }
  }
}

async function assembleReviewerContext(input: ReviewInput, deps: ExecutorDeps): Promise<string> {
  const state = await getAcceptedState(deps.sql, input.campaignId);
  const parts: string[] = [`PROBLEM: ${state.problem}`, `PLACE: ${state.place}`, `Accepted state version: ${state.version}`];
  const secParts: string[] = [];
  for (const s of JOURNEY_STEPS) {
    const sec = state.sections?.[s.key];
    if (!sec || sec.status === "empty" || !sec.content) continue;
    let content: string;
    try {
      content = JSON.stringify(sec.content).slice(0, 2500);
    } catch {
      content = String(sec.content).slice(0, 2500);
    }
    secParts.push(`--- SECTION ${s.step} ${s.key} [${sec.status}] ---\n${content}${sec.stepReport ? `\nStep report: ${sec.stepReport}` : ""}`);
  }
  if (secParts.length) parts.push(`CURRENT ACCEPTED STATE:\n${secParts.join("\n\n")}`);
  return parts.join("\n\n");
}
