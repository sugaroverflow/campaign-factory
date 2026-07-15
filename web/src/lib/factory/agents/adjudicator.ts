// Step 2: Evidence Adjudicator (Sonnet 5 high; adjudication ≤2 targeted
// searches + re-fetches). Emits the immutable ClaimDecisionSet: for each
// referenced claim a decision (confirmed / qualified / conflicted / not_found /
// stale) mapped to a verification label, plus gaps and re-search requests.

import { coerceLabel, VERIFICATION_LABELS } from "../../pipeline/labels";
import type { ClaimDecision, ClaimDecisionSet } from "../contracts/evidence";
import { A, enumStr, S, str, strA } from "./schema";
import {
  EVIDENCE_RULES,
  NO_SYNTHETIC_DATA,
  TOOL_USE,
  UNTRUSTED_SOURCES,
  agentOutputSchema,
  asString,
  asStrArray,
  baseBody,
  systemPrompt,
  userMessageHeader,
} from "./shared";
import type { AgentContract } from "./types";

const CLAIM_DECISIONS: readonly ClaimDecision[] = [
  "confirmed",
  "qualified",
  "conflicted",
  "not_found",
  "stale",
];
const DECISION_SET = new Set<string>(CLAIM_DECISIONS);
const coerceDecision = (v: unknown): ClaimDecision =>
  typeof v === "string" && DECISION_SET.has(v) ? (v as ClaimDecision) : "not_found";

const decisionItem = S({
  claimId: str,
  decision: enumStr(CLAIM_DECISIONS),
  rationale: str,
  resultingLabel: enumStr(VERIFICATION_LABELS),
});

const schema = agentOutputSchema(
  { claimDecisions: A(decisionItem), gaps: strA, reSearchRequests: strA },
  ["claimDecisions", "gaps", "reSearchRequests"],
);

const role = `You are the Evidence Adjudicator for Campaign Factory. You receive the campaign's claims and their sources. For EACH referenced claim, decide its status honestly:
- confirmed → a current Tier A/B source you verified supports it → "Verified public information";
- qualified → true only with a caveat you must state → usually "Supported inference";
- conflicted → credible sources disagree → "Conflicting evidence";
- not_found → no adequate public source → "Verification incomplete" or "External information unavailable";
- stale → was true but the source is out of date → "Verification incomplete".
Set resultingLabel to the verification label that follows from your decision. You may run at most two targeted searches and re-fetch specific URLs to resolve a conflict or fill a critical gap — fetch before you rely on anything. You may add corroborating claims (with sources) for facts you newly verify. List remaining gaps and specific re-search requests. Change a load-bearing claim to "Verified public information" ONLY on a current Tier A/B source. Never invent a source to close a gap.`;

export const evidenceAdjudicator: AgentContract = {
  key: "evidence_adjudicator",
  schema,
  structuredOutput: false,
  system: () => systemPrompt(role, [NO_SYNTHETIC_DATA, UNTRUSTED_SOURCES, EVIDENCE_RULES, TOOL_USE], schema),
  userMessage: (env, ctx) => userMessageHeader(env, ctx),
  toResult: (raw, ctx) => {
    const env = ctx.envelope;
    const body = baseBody(raw, ctx);
    const decisionsRaw = Array.isArray(raw.claimDecisions) ? raw.claimDecisions : [];
    const decisions = decisionsRaw
      .map((d) => {
        const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
        return {
          claimId: asString(o.claimId),
          decision: coerceDecision(o.decision),
          rationale: asString(o.rationale),
          resultingLabel: coerceLabel(o.resultingLabel),
        };
      })
      .filter((d) => d.claimId.length > 0);
    const decisionSet: ClaimDecisionSet = {
      agentRunId: env.agentRunId,
      decisions,
      gaps: asStrArray(raw.gaps),
      reSearchRequests: asStrArray(raw.reSearchRequests),
    };
    body.claimDecisions = decisionSet;
    return body;
  },
};
