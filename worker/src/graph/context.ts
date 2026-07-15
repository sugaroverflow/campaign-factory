// RuntimeContext: the non-serialisable per-run dependencies passed to graph
// nodes via config.configurable (NOT checkpointed). On resume after a restart,
// run.ts rebuilds a fresh context; state comes from the checkpoint.

import type { RunnableConfig } from "@langchain/core/runnables";
import type { RunProfile } from "@web/lib/factory/contracts/api.js";
import type { Sql } from "../db/pool.js";
import type { Emitter } from "../events/emit.js";
import type { Gate, RecordUsage, AgentTurnFn } from "../agents/deps.js";
import type { ModelMode } from "../config.js";
import type { ReviewFn, QAFn } from "./review-contract.js";

export interface RuntimeContext {
  sql: Sql;
  emitter: Emitter;
  gate: Gate;
  recordUsage: RecordUsage;
  modelMode: ModelMode;
  mode: "public" | "presenter";
  profile: RunProfile; // "full" | "express" — drives roster overrides + limits
  batchId?: string;
  signal: AbortSignal;
  apiKey?: string;
  executeAgentTurn: AgentTurnFn;
  review: ReviewFn;
  runQA: QAFn;
  judgementSlots: JudgementSlots;
}

// Per-run judgement-cap guard. Clusters run agents under Promise.all, so a
// read-then-insert against the DB can exceed the cap (two agents both count 3,
// both insert a 4th and 5th). Runs execute within ONE process, so a serialised
// in-process counter is sufficient; the DB count is loaded lazily ONCE so a
// resume after a restart re-counts what earlier attempts already inserted.
export interface JudgementSlots {
  /** Atomically reserve one judgement slot. `load` supplies the persisted
   *  count on first use. Returns false when the cap is already reached. */
  reserve(load: () => Promise<number>): Promise<boolean>;
}

export function makeJudgementSlots(cap: number): JudgementSlots {
  let count: number | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    reserve(load: () => Promise<number>): Promise<boolean> {
      const next = chain.then(async () => {
        if (count === null) count = await load();
        if (count >= cap) return false;
        count += 1;
        return true;
      });
      // Keep the chain alive even if a reservation rejects (load failure).
      chain = next.catch(() => undefined);
      return next;
    },
  };
}

const KEY = "factoryContext";

export function withContext(ctx: RuntimeContext): RunnableConfig {
  return { configurable: { [KEY]: ctx }, recursionLimit: 100 };
}

export function contextFrom(config: RunnableConfig | undefined): RuntimeContext {
  const ctx = config?.configurable?.[KEY] as RuntimeContext | undefined;
  if (!ctx) throw new Error("RuntimeContext missing from graph config.configurable");
  return ctx;
}
