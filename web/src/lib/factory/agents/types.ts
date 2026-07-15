// The AgentContract: every runtime agent's brain expressed as data — a system
// prompt, a user-message builder over the bounded envelope, a hand-built output
// schema, and a deterministic mapper from validated model JSON to the frozen
// AgentResult body. The executor (worker) owns identity + terminal status;
// contracts own everything domain-specific. Runtime-neutral.

import type { AgentDef, AgentKey } from "../contracts/roster";
import type { AgentResult, AgentTaskEnvelope } from "../contracts/envelope";
import type { JSchema } from "./schema";

/** AgentResult minus the fields the executor assigns (identity + status). */
export type AgentResultBody = Omit<AgentResult, "agentRunId" | "status">;

export interface AgentParseContext {
  envelope: AgentTaskEnvelope;
  def: AgentDef;
}

export interface AgentContract {
  key: AgentKey;
  /** System prompt; may vary language on the def's tool policy. */
  system: (def: AgentDef) => string;
  /** User message from the bounded envelope + assembled accepted-state extracts. */
  userMessage: (envelope: AgentTaskEnvelope, contextExtracts: string) => string;
  /** Hand-built JSON schema for the structured output (also serialised into the prompt). */
  schema: JSchema;
  /**
   * Request API-level structured output (grammar) for this agent. Default is
   * undefined/false: prompt-specified JSON + tolerant parse, the RESEARCH-stage
   * precedent that is robust to grammar-compilation limits. The coordinator can
   * flip individual agents on once verified against the live API.
   */
  structuredOutput?: boolean;
  /** Deterministically map validated raw model JSON → AgentResult body. */
  toResult: (raw: Record<string, unknown>, ctx: AgentParseContext) => AgentResultBody;
}
