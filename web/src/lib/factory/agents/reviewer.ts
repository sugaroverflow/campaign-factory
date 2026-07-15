// The recurring Campaign Synthesis Reviewer (ADR 0003). One campaign-scoped
// identity: Sonnet 5 for ordinary step closure, upgraded to Opus 4.8 for the
// strategy review (step 7) and the final whole-campaign review (step 10).
//
// The reviewer does not fit the AgentResult mould (it emits ProposalReviews,
// not claims/proposals), so the worker's reviewer node parses its output into a
// ReviewOutcome using REVIEW_SCHEMA + parseReview below, rather than going
// through executeAgentTurn. A thin AgentContract is still registered so prompts,
// mock output, and QA can treat every agent key uniformly.

import type { ReviewDecision } from "../contracts/state";
import type { ChangeProposal } from "../contracts/state";
import { A, describeSchema, enumStr, int, S, str, strA, type JSchema } from "./schema";
import { JSON_ONLY, NO_SYNTHETIC_DATA, asString, asStrArray, coerceConfidence } from "./shared";
import type { AgentContract } from "./types";

const DECISIONS: readonly ReviewDecision[] = ["accept", "return", "reject"];
const DECISION_SET = new Set<string>(DECISIONS);

export const REVIEW_SCHEMA: JSchema = S({
  workSummary: str,
  confidence: enumStr(["high", "medium", "low"]),
  reviews: A(
    S({
      proposalId: str,
      decision: enumStr(DECISIONS),
      rationale: str,
    }),
  ),
  stepReports: A(S({ step: int, report: str })),
  consistencyFlags: strA,
});

export interface ReviewParsed {
  workSummary: string;
  confidence: "high" | "medium" | "low";
  reviews: Array<{ proposalId: string; decision: ReviewDecision; rationale: string }>;
  stepReports: Array<{ step: number; report: string }>;
  consistencyFlags: string[];
}

const coerceDecision = (v: unknown): ReviewDecision =>
  typeof v === "string" && DECISION_SET.has(v) ? (v as ReviewDecision) : "return";

/** Runtime-neutral parse used by the worker's reviewer node. */
export function parseReview(raw: Record<string, unknown>): ReviewParsed {
  const reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).map((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return { proposalId: asString(o.proposalId), decision: coerceDecision(o.decision), rationale: asString(o.rationale) };
  });
  const stepReports = (Array.isArray(raw.stepReports) ? raw.stepReports : []).map((s) => {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return { step: typeof o.step === "number" ? o.step : 0, report: asString(o.report) };
  });
  return {
    workSummary: asString(raw.workSummary),
    confidence: coerceConfidence(raw.confidence, "medium"),
    reviews: reviews.filter((r) => r.proposalId.length > 0),
    stepReports: stepReports.filter((s) => s.report.length > 0),
    consistencyFlags: asStrArray(raw.consistencyFlags),
  };
}

const REVIEWER_ROLE = `You are the Campaign Synthesis Reviewer for Campaign Factory — one recurring identity across the whole campaign. You do NOT do open research or write sections yourself. You decide the Campaign Change Proposals submitted for a step against the current ACCEPTED state and prior Step Reports:
- accept: the proposal is campaign-specific, evidence-backed, internally consistent, and its claims carry honest verification labels. Substantial, usable content with imperfections should be ACCEPTED, with your concerns recorded as dissent in the rationale and as next checks — do not hold good work hostage to polish;
- return: ONLY when the proposal is unusable without one specific, nameable correction. Most clusters get NO revision round in this runtime — a return usually becomes a permanent gap in the delivered brief, which is a worse outcome for the campaigner than accepted-with-dissent. Never return for tone, depth, or improvements you can record as next checks;
- reject: it is generic, unsupported, fabricated, contradicts accepted state, or presents inference as verified fact.
For every closed step, write a concise Step Report (what was decided and why). PRESERVE DISSENT: if you accept over a real concern, or reject a defensible proposal, record the dissent verbatim in the rationale. Raise consistency flags for any contradiction between the accepted objective, decision route, strategy, tactics, organising, and packs. You never invent facts; you check them.`;

export const SYNTHESIS_REVIEWER_SYSTEM = [
  REVIEWER_ROLE,
  NO_SYNTHETIC_DATA,
  `${JSON_ONLY}\n${describeSchema(REVIEW_SCHEMA)}`,
].join("\n\n");

/** Reviewer user message: the worker packs proposal clusters + accepted state
 *  + prior Step Reports into contextExtracts. */
export function reviewerUserMessage(contextExtracts: string, opts: { isFinal: boolean; step: number }): string {
  const header = opts.isFinal
    ? "FINAL WHOLE-CAMPAIGN REVIEW. Check consistency across every accepted section and pack, then decide any remaining proposals."
    : `Step ${opts.step} review. Decide each proposal below.`;
  return `${header}

${contextExtracts.trim() || "(no proposals or state provided)"}

Return the single JSON object with your decisions, Step Report(s), and consistency flags.`;
}

/** Render proposals for the reviewer prompt (runtime-neutral). The worker calls
 *  this with the full ChangeProposal objects and an optional QA-flag lookup. */
export function formatProposalsForReview(
  proposals: ChangeProposal[],
  flagsFor?: (proposalId: string) => string[],
): string {
  return proposals
    .map((p) => {
      const flags = flagsFor?.(p.id) ?? [];
      const ops = p.ops
        .map((op) => {
          if (op.op === "set_section") return `set_section ${op.step} (claims: ${op.evidenceClaimIds.join(", ") || "none"})\n${safeJson(op.content)}`;
          if (op.op === "merge_section") return `merge_section ${op.step} (claims: ${op.evidenceClaimIds.join(", ") || "none"})\n${safeJson(op.patch)}`;
          if (op.op === "set_pack") return `set_pack ${op.document} (${op.resources.length} resources)\n${safeJson(op.resources)}`;
          if (op.op === "add_next_check") return `add_next_check: ${op.check.description}`;
          return `record_terminal_gap: ${op.description}`;
        })
        .join("\n");
      const parts = [
        `PROPOSAL ${p.id} — ${p.summary} (from agent ${p.agentRunId}, base v${p.baseStateVersion}${p.revisionOfProposalId ? ", REVISION" : ""})`,
        ops,
      ];
      if (p.assumptions.length) parts.push(`assumptions: ${p.assumptions.join("; ")}`);
      if (p.uncertainty) parts.push(`uncertainty: ${p.uncertainty}`);
      if (flags.length) parts.push(`QA flags: ${flags.join("; ")}`);
      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2).slice(0, 4000);
  } catch {
    return String(v);
  }
}

// Registry entry (uniformity for prompts / mock / QA). The real review flow uses
// REVIEW_SCHEMA + parseReview via the worker, not this toResult.
export const synthesisReviewer: AgentContract = {
  key: "synthesis_reviewer",
  schema: REVIEW_SCHEMA,
  structuredOutput: false,
  system: () => SYNTHESIS_REVIEWER_SYSTEM,
  userMessage: (env, ctx) => reviewerUserMessage(ctx, { isFinal: env.journeySteps.includes(10), step: env.journeySteps[0] ?? 0 }),
  toResult: (raw) => ({
    workSummary: asString(raw.workSummary),
    claims: [],
    proposals: [],
    unknowns: [],
    confidence: coerceConfidence(raw.confidence, "medium"),
    handoffs: [],
  }),
};
