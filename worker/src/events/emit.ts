// Event emission. W2 owns identity fields; agents (via ExecutorDeps.emit) supply
// only semantic content. All persistence + the NOTIFY that wakes SSE happen in
// store.appendEvent.
//
// Coalescing (parameters §4): an agent may emit at most two visible `work.update`
// events per second. Tool and state-transition events are NEVER dropped.

import type { Sql } from "../db/pool.js";
import { appendEvent, type AppendEventInput } from "../store/index.js";
import type { Emit, EmitFragment } from "../agents/deps.js";
import { MAX_VISIBLE_WORK_UPDATES_PER_SECOND } from "@web/lib/factory/contracts/core.js";
import type { EventVisibility, FactoryEvent } from "@web/lib/factory/contracts/core.js";

// Run-level emit input: identity (campaignId/batchId) is bound by the Emitter;
// visibility defaults to "public".
export type RunEmitInput = Omit<AppendEventInput, "campaignId" | "batchId" | "visibility"> & {
  visibility?: EventVisibility;
};

const WORK_UPDATE_WINDOW_MS = 1000;

export class Emitter {
  private readonly sql: Sql;
  readonly campaignId: string;
  readonly batchId?: string;
  // rolling timestamps of recent work.update emits, keyed by agentRunId
  private readonly workUpdateTimes = new Map<string, number[]>();

  constructor(sql: Sql, campaignId: string, batchId?: string) {
    this.sql = sql;
    this.campaignId = campaignId;
    this.batchId = batchId;
  }

  // Run-level emit. `campaignId`/`batchId` are bound; visibility defaults public.
  async emit(input: RunEmitInput): Promise<FactoryEvent> {
    return appendEvent(this.sql, {
      visibility: "public",
      ...input,
      campaignId: this.campaignId,
      batchId: this.batchId,
    });
  }

  private throttledWorkUpdate(agentRunId: string): boolean {
    const now = Date.now();
    const times = (this.workUpdateTimes.get(agentRunId) ?? []).filter(
      (t) => now - t < WORK_UPDATE_WINDOW_MS,
    );
    if (times.length >= MAX_VISIBLE_WORK_UPDATES_PER_SECOND) {
      this.workUpdateTimes.set(agentRunId, times);
      return true; // over budget → drop
    }
    times.push(now);
    this.workUpdateTimes.set(agentRunId, times);
    return false;
  }

  // The Emit function handed to a specific agent turn. Pre-binds the agent's
  // identity + default journey step; fragment.journeyStep overrides.
  forAgent(binding: {
    agentRunId: string;
    parentAgentRunId?: string;
    journeyStep?: number;
  }): Emit {
    return async (fragment: EmitFragment): Promise<FactoryEvent> => {
      const journeyStep = fragment.journeyStep ?? binding.journeyStep;
      if (fragment.type === "work.update" && this.throttledWorkUpdate(binding.agentRunId)) {
        // Coalesced away: return a non-persisted echo so the caller resolves.
        return {
          eventId: "coalesced",
          sequence: -1,
          campaignId: this.campaignId,
          batchId: this.batchId,
          agentRunId: binding.agentRunId,
          parentAgentRunId: binding.parentAgentRunId,
          journeyStep,
          type: fragment.type,
          at: new Date().toISOString(),
          visibility: fragment.visibility ?? "public",
          payload: fragment.payload,
        };
      }
      return appendEvent(this.sql, {
        campaignId: this.campaignId,
        batchId: this.batchId,
        agentRunId: binding.agentRunId,
        parentAgentRunId: binding.parentAgentRunId,
        journeyStep,
        type: fragment.type,
        visibility: fragment.visibility ?? "public",
        payload: fragment.payload,
      });
    };
  }
}
