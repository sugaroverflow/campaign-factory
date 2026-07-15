// Agent I/O contract (parameters §2). Every agent receives a bounded
// AgentTaskEnvelope and returns a typed AgentResult. Context is assembled from
// accepted state and referenced artefacts — never the complete raw event log.

import type { AgentRunId, BatchId, CampaignId } from "./core";
import type { AgentTerminalStatus } from "./core";
import type { Claim, ClaimDecisionSet } from "./evidence";
import type { ChangeProposal, JudgementRequest } from "./state";
import type { SpecialistKey } from "./roster";

export interface AgentTaskEnvelope {
  batchId?: BatchId;
  campaignId: CampaignId;
  agentRunId: AgentRunId;
  parentAgentRunId?: AgentRunId;
  stateVersion: number;
  journeySteps: number[];
  task: string;
  contextRefs: string[];
  evidenceRefs: string[];
  constraints: string[];
  toolPolicy: string;
  deadlineAt: string;
}

export interface SpecialistRequest {
  specialist: SpecialistKey;
  reason: string; // validated deterministically against catalogue + caps
}

export interface AgentHandoff {
  toAgentKey: string;
  artefact: string; // short description of what is handed off
  refs: string[];
}

export interface AgentConflict {
  withAgentRunId?: AgentRunId;
  description: string;
  claimIds?: string[];
}

// Draft proposals arrive without ids/status; the runtime assigns those.
export type ChangeProposalDraft = Omit<ChangeProposal, "id" | "status" | "agentRunId">;
export type JudgementRequestDraft = Omit<
  JudgementRequest,
  "id" | "status" | "agentRunId" | "answer" | "answeredAt"
>;
export type ClaimDraft = Omit<Claim, "id" | "authorAgentRunId" | "stateVersion" | "adjudicatedBy">;

export interface AgentResult {
  agentRunId: AgentRunId;
  status: AgentTerminalStatus; // "complete" | "partial" | "failed"
  workSummary: string; // concise, public, sans-serif prose
  claims: ClaimDraft[];
  claimDecisions?: ClaimDecisionSet; // Evidence Adjudicator only
  proposals: ChangeProposalDraft[];
  unknowns: string[];
  confidence: "high" | "medium" | "low";
  handoffs: AgentHandoff[];
  specialistRequest?: SpecialistRequest; // at most one per turn
  conflict?: AgentConflict;
  judgementRequest?: JudgementRequestDraft;
}
