// ExecutorDeps — the authoritative interface between W2's LangGraph runtime and
// W3's agent brains. W2 constructs these objects per graph node and passes them
// to executeAgentTurn / runSynthesisReview; W3 owns the shape. Runtime-neutral
// contract types come from the frozen web contracts; node/pg types are fine
// here because this module only ever runs inside the worker package.
//
// Coordination note: W2 pre-binds identity fields (campaignId, batchId,
// agentRunId, parentAgentRunId, stateVersion, sequence, at) inside `emit`,
// `recordUsage`, and the gate — so the agent code only supplies semantic
// content. Accepted-state reads and Source rows go through W1's store functions
// (web/src/lib/factory/store) called with `deps.sql`; no facade is passed.

import type { Sql } from "postgres";
import type {
  AgentDef,
  AgentResult,
  AgentTaskEnvelope,
  BatchId,
  CampaignId,
  EventVisibility,
  FactoryEvent,
  FactoryEventPayload,
  FactoryEventType,
  ModelMode,
} from "@web/lib/factory/contracts/index.js";

// ---- Event emission -------------------------------------------------------
// W2 fills eventId, sequence, campaign/batch/agent ids, parentAgentRunId, `at`,
// and stateVersion. W3 supplies the semantic fields only.
export interface EmitFragment {
  type: FactoryEventType;
  payload: FactoryEventPayload;
  visibility?: EventVisibility; // default "public"
  journeyStep?: number;
}
export type Emit = (fragment: EmitFragment) => Promise<FactoryEvent>;

// ---- Concurrency gate -----------------------------------------------------
// One campaign cannot consume all global model slots (parameters §4). acquire
// resolves when a slot is free and returns the release function for that slot.
export type GateRelease = () => void;
export interface GateAcquireInput {
  campaignId: CampaignId;
  mode: "public" | "presenter";
  kind: "model" | "research"; // research/tool-using calls share the tighter lane
}
export interface Gate {
  acquire: (input: GateAcquireInput) => Promise<GateRelease>;
}

// ---- Usage / cost sink ----------------------------------------------------
export interface RecordUsageInput {
  campaignId: CampaignId;
  batchId?: BatchId;
  agentRunId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUSD: number;
  webSearches?: number; // paid Anthropic web searches spent on this call
}
export type RecordUsage = (input: RecordUsageInput) => Promise<void>;

// ---- Deps passed into every agent turn ------------------------------------
// The agent runtime never reads the raw event log and never mutates campaign
// state directly (ADR 0008): it reads accepted state + referenced artefacts and
// records Source rows through W1's store functions, invoked with `deps.sql`.
export interface ExecutorDeps {
  emit: Emit;
  gate: Gate;
  sql: Sql; // worker's DIRECT (unpooled) connection; passed to W1 store fns
  recordUsage: RecordUsage;
  agentDef: AgentDef;
  modelMode: ModelMode; // "mock" | "live"
  signal: AbortSignal; // run-level cancellation
  apiKey?: string; // optional per-run Anthropic key (BYOK seam); else server env
  now?: () => Date; // injectable clock for deterministic mock pacing / tests
}

export type AgentTurnFn = (
  envelope: AgentTaskEnvelope,
  deps: ExecutorDeps,
) => Promise<AgentResult>;
