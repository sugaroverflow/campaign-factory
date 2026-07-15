// Evidence architecture (parameters §3). The seven verification labels come
// from the existing pipeline and remain the integrity spine.

import { type VerificationLabel } from "../../pipeline/labels";
import type { AgentRunId, ClaimId, SourceId } from "./core";

export { VERIFICATION_LABELS, isVerificationLabel, coerceLabel } from "../../pipeline/labels";
export type { VerificationLabel } from "../../pipeline/labels";

export type SourceTier = "A" | "B" | "C" | "D";

export type RetrievalStatus =
  | "fetched"
  | "partial_extraction"
  | "blocked"
  | "paywalled"
  | "stale_cache"
  | "failed";

export interface Source {
  id: SourceId;
  campaignId: string;
  url: string;
  title: string;
  organisation: string;
  publishedAt?: string; // ISO, or absent when explicitly unknown
  accessedAt: string; // ISO
  tier: SourceTier;
  isPrimary: boolean;
  mediaType: string; // "html" | "pdf" | ...
  contentHash: string;
  retrievalStatus: RetrievalStatus;
}

export type ClaimType =
  | "authority"
  | "process"
  | "deadline"
  | "officeholder"
  | "policy"
  | "stakeholder_position"
  | "number"
  | "context"
  | "other";

export interface Claim {
  id: ClaimId;
  campaignId: string;
  text: string; // canonical claim text
  type: ClaimType;
  status: VerificationLabel;
  loadBearing: boolean;
  confidence: "high" | "medium" | "low"; // separate from verification status
  sourceIds: SourceId[];
  excerpt?: string; // short evidentiary excerpt or paraphrase
  authorAgentRunId: AgentRunId;
  adjudicatedBy?: AgentRunId;
  stateVersion: number;
  affectedOutputs?: string[]; // section keys / document keys
  contradictsClaimIds?: ClaimId[];
  supersedesClaimIds?: ClaimId[];
  staleOfClaimId?: ClaimId;
}

// The Evidence Adjudicator's immutable output (parameters §2).
export type ClaimDecision = "confirmed" | "qualified" | "conflicted" | "not_found" | "stale";

export interface ClaimDecisionSet {
  agentRunId: AgentRunId;
  decisions: Array<{
    claimId: ClaimId;
    decision: ClaimDecision;
    rationale: string;
    resultingLabel: VerificationLabel;
  }>;
  gaps: string[];
  reSearchRequests: string[];
}

// A "next check" entry in Evidence and Next Checks (ADR 0006).
export interface NextCheck {
  id: string;
  description: string;
  reason: string;
  affectedSections: string[]; // JourneyStepKey[]
  claimIds?: ClaimId[];
}
