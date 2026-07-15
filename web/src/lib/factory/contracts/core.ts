// Factory core identifiers, enums, and the neutral Factory Event schema.
// This file is the framework-neutral boundary required by ADR 0003: LangGraph
// (or anything else) must translate into these types before events reach the
// database, SSE, or UI. Runtime-neutral: no next/*, no node-only imports.

export type BatchId = string; // uuid
export type CampaignId = string; // uuid
export type AgentRunId = string; // uuid
export type EventId = string; // uuid
export type ProposalId = string; // uuid
export type JudgementId = string; // uuid
export type SourceId = string; // uuid
export type ClaimId = string; // uuid

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

// Terminal statuses an agent may report (parameters §2).
export type AgentTerminalStatus = "complete" | "partial" | "failed";

export type AgentRunStatus = "queued" | "running" | AgentTerminalStatus;

export type EventVisibility = "public" | "internal";

// Semantic event vocabulary (parameters §4). Persist these only — never token
// deltas, raw prompts, raw provider responses, or private reasoning.
export const FACTORY_EVENT_TYPES = [
  "run.queued",
  "run.started",
  "run.completed",
  "run.partial",
  "run.failed",
  "run.cancelled",
  "agent.queued",
  "agent.started",
  "agent.completed",
  "agent.partial",
  "agent.failed",
  "agent.retry",
  "agent.replaced",
  "specialist.requested",
  "specialist.approved",
  "specialist.rejected",
  "specialist.spawned",
  "source.search.started",
  "source.search.completed",
  "source.search.failed",
  "source.fetch.started",
  "source.fetch.completed",
  "source.fetch.failed",
  "evidence.found",
  "evidence.conflicted",
  "evidence.gap",
  "artefact.handoff",
  "proposal.submitted",
  "proposal.accepted",
  "proposal.returned",
  "proposal.rejected",
  "proposal.applied",
  "judgement.requested",
  "judgement.defaulted",
  "judgement.resolved",
  "work.update",
  "section.status",
  "document.status",
  "gap.terminal",
  "receipt.campaign",
  "receipt.batch",
  "cost.update",
] as const;

export type FactoryEventType = (typeof FACTORY_EVENT_TYPES)[number];

// Every event a campaign emits. `sequence` is monotonic per campaign and is
// the SSE reconnection cursor (Last-Event-ID / ?after=).
export interface FactoryEvent<P = FactoryEventPayload> {
  eventId: EventId;
  sequence: number;
  batchId?: BatchId;
  campaignId: CampaignId;
  agentRunId?: AgentRunId;
  parentAgentRunId?: AgentRunId;
  journeyStep?: number; // 1–10
  type: FactoryEventType;
  at: string; // ISO 8601 with timezone
  stateVersion?: number;
  visibility: EventVisibility;
  payload: P;
}

// Payloads stay human-legible: short sans-serif summaries plus refs. The UI
// renders payload.summary verbatim in Work Backscroll rows.
export interface FactoryEventPayload {
  summary: string; // e.g. "Fetched Leicester City Council cabinet minutes"
  verb?: string; // short present-tense verb for the card header, e.g. "fetching"
  agentKey?: string; // roster key, present on agent.* and work.update
  agentDisplayName?: string;
  sourceIds?: SourceId[];
  claimIds?: ClaimId[];
  proposalId?: ProposalId;
  judgementId?: JudgementId;
  handoffToAgentRunId?: AgentRunId;
  sectionStep?: number;
  sectionStatus?: string;
  documentKey?: string;
  documentStatus?: string;
  detail?: Record<string, unknown>; // typed per event type, small, no raw provider data
}

// Cap on visible work.update chatter (parameters §4).
export const MAX_VISIBLE_WORK_UPDATES_PER_SECOND = 2;
