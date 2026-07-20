// Drives one campaign run: build RuntimeContext, invoke the graph with
// thread_id=campaignId, resume from checkpoint on re-delivery, and roll the
// batch up when its last campaign finishes. The graph's finalise node is the
// single writer of the terminal run.* event, so this function only throws on
// SYSTEMIC failure (→ pg-boss retry / dead-letter). Expected agent failures are
// visible Terminal Gaps inside the graph.

import { randomUUID } from "node:crypto";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { RunStatus } from "@web/lib/factory/contracts/core.js";
import type { RunProfile } from "@web/lib/factory/contracts/api.js";
import { agentDef } from "@web/lib/factory/contracts/roster.js";
import { MAX_JUDGEMENT_REQUESTS_PER_RUN } from "@web/lib/factory/contracts/state.js";
// Direct-module import (same pattern as finalise.ts) — the worker store barrel
// does not re-export document reads.
import { listLatestDocuments } from "@web/lib/factory/store/documents.js";
import { config } from "../config.js";
import { isByokBlob, openByok } from "../byok.js";
import type { ModelProvider } from "@web/lib/anthropic.js";
import { sql } from "../db/pool.js";
import type { Sql } from "../db/pool.js";
import { Emitter } from "../events/emit.js";
import { gate } from "../gate.js";
import type { Gate, RecordUsage } from "../agents/deps.js";
import * as store from "../store/index.js";
import { registerRun, releaseRun } from "../runtime/registry.js";
import { getCheckpointer } from "./checkpointer.js";
import { buildCampaignGraph } from "./build.js";
import { withContext, makeJudgementSlots, type RuntimeContext } from "./context.js";
import type { GraphStateType } from "./state.js";
import type { RunJobData, DeadFn, RunFn } from "../queue/boss.js";
import type { RuntimeAgents } from "./executor-loader.js";

const TERMINAL_RUN_EVENTS = ["run.completed", "run.partial", "run.failed", "run.cancelled"];

async function alreadyFinalised(s: Sql, campaignId: string): Promise<boolean> {
  const rows = await s`
    select 1 from factory.factory_events
     where campaign_id = ${campaignId} and type in ${s(TERMINAL_RUN_EVENTS)}
     limit 1`;
  return rows.length > 0;
}

function makeGateAdapter(signal: AbortSignal): Gate {
  return { acquire: (input) => gate.acquire({ ...input, signal }) };
}

function makeRecordUsage(s: Sql): RecordUsage {
  return async (u) => {
    await store.appendCost(s, {
      campaignId: u.campaignId,
      batchId: u.batchId,
      agentRunId: u.agentRunId,
      model: u.model,
      kind: "model_call",
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      searchCount: u.webSearches,
      costUsd: u.costUSD,
    });
  };
}

export function makeRunner(agents: RuntimeAgents): RunFn {
  return async ({ campaignId, batchId, profile: jobProfile }: RunJobData): Promise<void> => {
    const s = sql();
    const run = await store.getRun(s, campaignId);
    if (!run) {
      // Systemic: the run row must be created before enqueue. Let pg-boss retry.
      throw new Error(`runCampaign: no factory_runs row for ${campaignId}`);
    }
    const effectiveBatchId = batchId ?? run.batchId ?? undefined;
    // Profile: job data (fast path) → run.meta (durable; orphan-recovery
    // re-enqueues carry no profile) → "full". Enum-normalised: anything that is
    // not exactly "express" runs the full graph.
    const profile: RunProfile =
      (jobProfile ?? run.meta.profile) === "express" ? "express" : "full";
    if (await alreadyFinalised(s, campaignId)) {
      // Idempotent re-delivery. Still attempt the batch roll-up: a crash in the
      // window between finalising the batch's last campaign and rolling the
      // batch up would otherwise leave the batch un-receipted forever.
      if (effectiveBatchId) await maybeCompleteBatch(s, effectiveBatchId);
      return;
    }
    const handle = registerRun(campaignId);
    if (!handle) {
      // Already executing in this process (duplicate delivery) — let the
      // original execution keep driving the run; this job just completes.
      console.warn(`[run] duplicate delivery for ${campaignId}; already in flight`);
      return;
    }
    const emitter = new Emitter(s, campaignId, effectiveBatchId);

    // BYOK: open the visitor's sealed key for this execution only. A byokRun
    // whose seal is missing or no longer opens (stripped early,
    // FACTORY_BYOK_SECRET changed) is SYSTEMIC — throw so pg-boss retries and
    // dead-letters visibly, never a silent fall-through to the house key.
    let byokKey: string | undefined;
    if (run.meta.byokRun === true) {
      if (!isByokBlob(run.meta.byok)) {
        releaseRun(campaignId);
        throw new Error(`runCampaign: BYOK run ${campaignId} has no sealed key`);
      }
      byokKey = openByok(run.meta.byok);
    }
    // Provider the key belongs to (meta.byokProvider, written at intake).
    // House-key runs are always Anthropic.
    const apiProvider: ModelProvider =
      byokKey && run.meta.byokProvider === "openrouter" ? "openrouter" : "anthropic";

    try {
      const ctx: RuntimeContext = {
        sql: s,
        emitter,
        gate: makeGateAdapter(handle.controller.signal),
        recordUsage: makeRecordUsage(s),
        modelMode: config.modelMode,
        mode: run.mode,
        profile,
        batchId: effectiveBatchId,
        signal: handle.controller.signal,
        apiKey: config.modelMode === "live" ? (byokKey ?? config.anthropicApiKey) : undefined,
        apiProvider,
        executeAgentTurn: agents.executeAgentTurn,
        review: agents.review,
        runQA: agents.runQA,
        judgementSlots: makeJudgementSlots(MAX_JUDGEMENT_REQUESTS_PER_RUN),
      };

      const graph = buildCampaignGraph(getCheckpointer());
      const cfg: RunnableConfig = withContext(ctx);
      cfg.configurable = { ...cfg.configurable, thread_id: campaignId };

      const prior = await graph.getState(cfg);
      const isResume = Boolean((prior?.values as Partial<GraphStateType> | undefined)?.campaignId);

      if (isResume) {
        // Resume from the last checkpoint; state comes from Postgres.
        await graph.invoke(null, cfg);
      } else {
        const reviewerAgentRunId = randomUUID();
        await store.createAgentRun(s, {
          agentRunId: reviewerAgentRunId,
          campaignId,
          batchId: effectiveBatchId,
          agentKey: "synthesis_reviewer",
          displayName: "Campaign Synthesis Reviewer",
          status: "running",
          journeySteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          model: "claude-sonnet-5",
          effort: "high",
        });
        await emitter.emit({
          type: "agent.started",
          agentRunId: reviewerAgentRunId,
          payload: {
            summary: "Campaign Synthesis Reviewer started",
            agentKey: "synthesis_reviewer",
            agentDisplayName: "Campaign Synthesis Reviewer",
            detail: { task: agentDef("synthesis_reviewer").responsibility.slice(0, 200) },
          },
        });
        await store.setRunStatus(s, campaignId, "running", { markStarted: true });
        await emitter.emit({
          type: "run.started",
          payload: {
            summary: `Run started: ${run.problem.slice(0, 80)}`,
            // M4: shared-link/second-device viewers have no localStorage seed —
            // the fold learns problem/place from this detail.
            detail: { problem: run.problem, place: run.place },
          },
        });

        const initial: Partial<GraphStateType> = {
          campaignId,
          batchId: effectiveBatchId,
          mode: run.mode,
          problem: run.problem,
          place: run.place,
          reviewerAgentRunId,
        };
        await graph.invoke(initial, cfg);
      }
    } finally {
      releaseRun(campaignId);
    }

    if (effectiveBatchId) await maybeCompleteBatch(s, effectiveBatchId);
  };
}

// Roll up the presenter batch when its last campaign reaches a terminal state.
async function maybeCompleteBatch(s: Sql, batchId: string): Promise<void> {
  const batch = await store.getBatch(s, batchId);
  if (!batch) return;
  const terminal = new Set<RunStatus>(["completed", "partial", "failed", "cancelled"]);
  if (terminal.has(batch.status)) return; // already rolled up

  const runs = await store.listRunsByBatch(s, batchId);
  if (runs.length === 0 || !runs.every((r) => terminal.has(r.status))) return;

  const completed = runs.filter((r) => r.status === "completed").length;

  // "Usable" is the PRODUCT definition (receipts.ts isSubstantiallyUsable):
  // at least one document reached "ready" — read from the document statuses
  // finalise persisted, NOT from run status (a partial run with zero ready
  // documents is not usable; counting it was flattering the receipt).
  const usableByCampaign = new Map<string, boolean>();
  for (const r of runs) {
    const docs = await listLatestDocuments(s, r.campaignId);
    usableByCampaign.set(r.campaignId, docs.some((d) => d.status === "ready"));
  }
  const usable = runs.filter((r) => usableByCampaign.get(r.campaignId)).length;
  const status: RunStatus =
    completed === runs.length ? "completed" : usable === 0 ? "failed" : "partial";

  // Atomic roll-up claim: the batch's last two campaigns can finalise
  // concurrently and both reach this point. Only the caller whose UPDATE
  // transitions the batch OUT of a non-terminal status writes the receipt and
  // emits receipt.batch — the loser's UPDATE matches zero rows.
  const claimed = await s`
    update factory.factory_batches
       set status = ${status}, updated_at = now(), completed_at = now()
     where batch_id = ${batchId}
       and status not in ${s([...terminal])}
    returning batch_id`;
  if (claimed.length === 0) return; // another finaliser rolled the batch up

  const receipt = {
    batchId,
    size: runs.length,
    completed,
    usable,
    campaigns: runs.map((r) => ({
      campaignId: r.campaignId,
      status: r.status,
      costUsd: r.costUsd,
      usable: usableByCampaign.get(r.campaignId) ?? false,
    })),
    totalCostUsd: runs.reduce((a, r) => a + r.costUsd, 0),
  };
  await store.setBatchReceipt(s, batchId, receipt);

  // Emit on the last campaign's stream (any campaign in the batch works).
  const last = runs[runs.length - 1];
  await new Emitter(s, last.campaignId, batchId).emit({
    type: "receipt.batch",
    payload: { summary: `Batch ${status}: ${usable}/${runs.length} campaigns usable`, detail: receipt },
  });
}

// Dead-letter handler: a give-up becomes a visible Terminal Gap + failed run,
// never a hidden queue item.
export const deadHandler: DeadFn = async ({ campaignId, batchId }, reason) => {
  const s = sql();
  const run = await store.getRun(s, campaignId);
  if (!run) return;
  if (await alreadyFinalised(s, campaignId)) return;
  const emitter = new Emitter(s, campaignId, batchId ?? run.batchId ?? undefined);
  await emitter.emit({ type: "gap.terminal", payload: { summary: `Run abandoned: ${reason}` } });
  await store.setRunStatus(s, campaignId, "failed", { error: reason });
  await emitter.emit({ type: "run.failed", payload: { summary: "Run failed (dead-lettered)", detail: { reason } } });
  // Dead-lettered runs bypass finalise — strip any sealed BYOK key here too.
  await store.stripRunByok(s, campaignId);
};
