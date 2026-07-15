// Accepted Campaign State, Campaign Change Proposals, reviews, judgements
// (ADR 0008, ADR 0005). Agents never mutate state: they submit proposals
// against an explicit base version; the recurring Synthesis Reviewer decides;
// typed reducers apply only the allow-listed operations below. No arbitrary
// JSON Patch paths from models. Stale proposals are re-reviewed, not applied.

import type { AgentRunId, CampaignId, JudgementId, ProposalId } from "./core";
import type { JourneyStepKey, SectionStatus } from "./journey";
import type { CanonicalDocumentKey, DocumentStatus, PackResource } from "./documents";
import type { NextCheck } from "./evidence";

export interface CampaignSectionState {
  status: SectionStatus;
  // Structured section content. Shape per section is validated by the reducer
  // (W1) against the per-section schemas in ./sections.
  content: unknown;
  evidenceClaimIds: string[];
  acceptedAtVersion?: number;
  stepReport?: string; // reviewer's Step Report, written on acceptance
}

export interface CampaignDocumentState {
  key: CanonicalDocumentKey;
  status: DocumentStatus;
  html?: string; // compiled render (docs 1–6) — deterministic compiler output
  resources?: PackResource[]; // packs 7–9
  version: number;
}

export interface TerminalGap {
  id: string;
  description: string;
  agentRunId?: AgentRunId;
  step?: number;
  at: string;
}

export interface CampaignState {
  campaignId: CampaignId;
  version: number; // monotonic; every accepted application bumps it
  problem: string; // the user's input, immutable
  place: string; // required named place, immutable
  sections: Record<JourneyStepKey, CampaignSectionState>;
  documents: CampaignDocumentState[];
  nextChecks: NextCheck[];
  terminalGaps: TerminalGap[];
}

// ---- Allow-listed proposal operations ----

export type ProposalOp =
  | {
      op: "set_section";
      step: JourneyStepKey;
      content: unknown;
      evidenceClaimIds: string[];
    }
  | {
      op: "merge_section";
      step: JourneyStepKey;
      patch: Record<string, unknown>; // shallow merge into section content
      evidenceClaimIds: string[];
    }
  | {
      op: "set_pack";
      document: Extract<CanonicalDocumentKey, "lobbying_pack" | "media_pack" | "digital_pack">;
      resources: PackResource[];
      evidenceClaimIds: string[];
    }
  | { op: "add_next_check"; check: Omit<NextCheck, "id"> }
  | { op: "record_terminal_gap"; description: string; step?: number };

export type ProposalStatus =
  | "submitted"
  | "accepted"
  | "returned" // one bounded revision loop (ADR 0008)
  | "rejected"
  | "applied"
  | "stale"; // base version moved; goes back to review, never auto-applied

export interface ChangeProposal {
  id: ProposalId;
  campaignId: CampaignId;
  agentRunId: AgentRunId;
  baseStateVersion: number;
  summary: string;
  ops: ProposalOp[];
  assumptions: string[];
  uncertainty?: string;
  dependsOnProposalIds?: ProposalId[];
  status: ProposalStatus;
  revisionOfProposalId?: ProposalId;
}

export type ReviewDecision = "accept" | "return" | "reject";

export interface ProposalReview {
  proposalId: ProposalId;
  reviewerAgentRunId: AgentRunId;
  decision: ReviewDecision;
  rationale: string; // preserved dissent lives here
  at: string;
}

// ---- Judgement Requests (ADR 0005): conditional, nonblocking ----

export type JudgementKind =
  | "scope_ambiguity"
  | "evidence_conflict"
  | "strategy_choice"
  | "local_knowledge";

export type JudgementStatus = "open" | "defaulted" | "resolved";

export interface JudgementRequest {
  id: JudgementId;
  campaignId: CampaignId;
  agentRunId: AgentRunId;
  kind: JudgementKind;
  question: string;
  options: string[];
  provisionalDefault: string; // must be one of options
  rationale: string;
  affectedOutputs: string[]; // section/document keys
  status: JudgementStatus;
  answer?: string; // human answer, or the default once applied
  answeredAt?: string;
}

export const MAX_JUDGEMENT_REQUESTS_PER_RUN = 4;
