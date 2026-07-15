// Batches + per-campaign runs: create, read, status transitions, and the
// polling-fallback read model.

import type { BatchId, CampaignId, RunStatus } from "../contracts/core";
import type { RunReadModel } from "../contracts/api";
import type { Db, JsonInput, Row } from "./types";
import { newId, numOrUndef, strOrUndef, toIso, toIsoOrUndef } from "./types";
import { readEvents } from "./events";
import { JOURNEY_STEPS } from "../contracts/journey";

export interface RunRecord {
  campaignId: CampaignId;
  batchId?: BatchId;
  environmentId: string;
  mode: "public" | "presenter";
  status: RunStatus;
  problem: string;
  place: string;
  stateVersion: number;
  lastSequence: number;
  costUsd: number;
  error?: string;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface BatchRecord {
  batchId: BatchId;
  environmentId: string;
  mode: "public" | "presenter";
  status: RunStatus;
  size: number;
  receipt?: unknown;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "partial", "failed", "cancelled"]);

function mapRun(r: Row): RunRecord {
  return {
    campaignId: String(r.campaign_id),
    batchId: strOrUndef(r.batch_id),
    environmentId: String(r.environment_id),
    mode: String(r.mode) as RunRecord["mode"],
    status: String(r.status) as RunStatus,
    problem: String(r.problem),
    place: String(r.place),
    stateVersion: Number(r.state_version),
    lastSequence: Number(r.last_sequence),
    costUsd: Number(r.cost_usd),
    error: strOrUndef(r.error),
    meta: (r.meta as Record<string, unknown>) ?? {},
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    startedAt: toIsoOrUndef(r.started_at),
    completedAt: toIsoOrUndef(r.completed_at),
  };
}

function mapBatch(r: Row): BatchRecord {
  return {
    batchId: String(r.batch_id),
    environmentId: String(r.environment_id),
    mode: String(r.mode) as BatchRecord["mode"],
    status: String(r.status) as RunStatus,
    size: Number(r.size),
    receipt: r.receipt ?? undefined,
    meta: (r.meta as Record<string, unknown>) ?? {},
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    completedAt: toIsoOrUndef(r.completed_at),
  };
}

/* ---- batches ---- */

export interface CreateBatchInput {
  batchId?: BatchId;
  environmentId: string;
  mode?: "public" | "presenter";
  status?: RunStatus;
  size: number;
  meta?: Record<string, unknown>;
}

export async function createBatch(sql: Db, input: CreateBatchInput): Promise<BatchId> {
  const id = input.batchId ?? newId();
  await sql`
    insert into factory.factory_batches (batch_id, environment_id, mode, status, size, meta)
    values (${id}, ${input.environmentId}, ${input.mode ?? "presenter"},
            ${input.status ?? "queued"}, ${input.size}, ${sql.json((input.meta ?? {}) as unknown as JsonInput)})`;
  return id;
}

export async function getBatch(sql: Db, batchId: BatchId): Promise<BatchRecord | null> {
  const rows = await sql<Row[]>`select * from factory.factory_batches where batch_id = ${batchId}`;
  return rows.length ? mapBatch(rows[0]) : null;
}

// Most recent presenter batch for this environment — powers the public
// spectator view at /factory/live (read-only; the viewer gets no tokens).
export async function getLatestPresenterBatch(
  sql: Db,
  environmentId: string,
): Promise<BatchRecord | null> {
  const rows = await sql<Row[]>`
    select * from factory.factory_batches
     where mode = 'presenter' and environment_id = ${environmentId}
     order by created_at desc
     limit 1`;
  return rows.length ? mapBatch(rows[0]) : null;
}

export async function setBatchStatus(
  sql: Db,
  batchId: BatchId,
  status: RunStatus,
): Promise<void> {
  const completed = TERMINAL.has(status);
  await sql`
    update factory.factory_batches
       set status = ${status},
           updated_at = now(),
           completed_at = ${completed ? sql`now()` : sql`completed_at`}
     where batch_id = ${batchId}`;
}

export async function setBatchReceipt(sql: Db, batchId: BatchId, receipt: unknown): Promise<void> {
  await sql`
    update factory.factory_batches
       set receipt = ${sql.json(receipt as unknown as JsonInput)}, updated_at = now()
     where batch_id = ${batchId}`;
}

/* ---- runs ---- */

export interface CreateRunInput {
  campaignId?: CampaignId;
  batchId?: BatchId;
  environmentId: string;
  mode: "public" | "presenter";
  status?: RunStatus;
  problem: string;
  place: string;
  meta?: Record<string, unknown>;
}

export async function createRun(sql: Db, input: CreateRunInput): Promise<CampaignId> {
  const id = input.campaignId ?? newId();
  await sql`
    insert into factory.factory_runs
      (campaign_id, batch_id, environment_id, mode, status, problem, place, meta)
    values
      (${id}, ${input.batchId ?? null}, ${input.environmentId}, ${input.mode},
       ${input.status ?? "queued"}, ${input.problem}, ${input.place},
       ${sql.json((input.meta ?? {}) as unknown as JsonInput)})`;
  return id;
}

export async function getRun(sql: Db, campaignId: CampaignId): Promise<RunRecord | null> {
  const rows = await sql<Row[]>`select * from factory.factory_runs where campaign_id = ${campaignId}`;
  return rows.length ? mapRun(rows[0]) : null;
}

export async function listRunsByBatch(sql: Db, batchId: BatchId): Promise<RunRecord[]> {
  const rows = await sql<Row[]>`
    select * from factory.factory_runs where batch_id = ${batchId} order by created_at asc`;
  return rows.map(mapRun);
}

// Finished presenter-batch campaigns for this environment, newest first —
// surfaces the on-stage demo runs as individual cards in the public /gallery.
// Presenter runs only: public self-serve runs stay private by default.
// cost_usd > 0.5 excludes mock/test batches (zero model spend): the shared dev
// DB carries Playwright fixture runs whose sections all "accept", and showing
// synthetic campaigns as real would break the no-synthetic-data principle.
export async function listFinishedPresenterRuns(
  sql: Db,
  environmentId: string,
  limit = 60,
): Promise<RunRecord[]> {
  const rows = await sql<Row[]>`
    select * from factory.factory_runs
     where mode = 'presenter' and environment_id = ${environmentId}
       and status in ('completed', 'partial')
       and cost_usd > 0.5
     order by completed_at desc nulls last
     limit ${limit}`;
  return rows.map(mapRun);
}

// Accepted-section counts for a set of finished campaigns, in ONE batched
// query. Source: the latest accepted CampaignState per campaign
// (factory.campaign_state_versions) — the same authoritative derivation the
// Campaign Completion Receipt uses (documents/receipts.ts): sections with
// status "accepted" over the nine acceptable journey steps, never counting the
// compiled "documents" step. Stored receipt.campaign events are deliberately
// NOT used here: receipts written before the denominator fix recorded N/10
// (documents step included), so grading them raw would misreport finished
// campaigns. The count stays in SQL because section content is large.
// Campaigns without a saved state version are absent from the result.
export interface RunSectionCounts {
  acceptedSections: number;
  totalSections: number;
}

const ACCEPTABLE_SECTION_TOTAL = JOURNEY_STEPS.filter((s) => s.key !== "documents").length;

export async function getRunSectionCounts(
  sql: Db,
  campaignIds: CampaignId[],
): Promise<Map<CampaignId, RunSectionCounts>> {
  const counts = new Map<CampaignId, RunSectionCounts>();
  if (campaignIds.length === 0) return counts;
  const rows = await sql<Row[]>`
    select distinct on (v.campaign_id)
           v.campaign_id,
           (select count(*)::int
              from jsonb_each(v.state -> 'sections') as s
             where s.key <> 'documents'
               and s.value ->> 'status' = 'accepted') as accepted
      from factory.campaign_state_versions v
     where v.campaign_id::text = any(${campaignIds})
     order by v.campaign_id, v.version desc`;
  for (const r of rows) {
    const accepted = Number(r.accepted);
    if (Number.isFinite(accepted)) {
      counts.set(String(r.campaign_id), {
        acceptedSections: accepted,
        totalSections: ACCEPTABLE_SECTION_TOTAL,
      });
    }
  }
  return counts;
}

export interface SetRunStatusOpts {
  error?: string;
  markStarted?: boolean;
}

export async function setRunStatus(
  sql: Db,
  campaignId: CampaignId,
  status: RunStatus,
  opts: SetRunStatusOpts = {},
): Promise<void> {
  const completed = TERMINAL.has(status);
  await sql`
    update factory.factory_runs
       set status = ${status},
           error = ${opts.error ?? null},
           updated_at = now(),
           started_at = ${opts.markStarted || status === "running" ? sql`coalesce(started_at, now())` : sql`started_at`},
           completed_at = ${completed ? sql`now()` : sql`completed_at`}
     where campaign_id = ${campaignId}`;
}

/** Update the accepted-state version cursor after a reducer application. */
export async function setRunStateVersion(
  sql: Db,
  campaignId: CampaignId,
  version: number,
): Promise<void> {
  await sql`
    update factory.factory_runs
       set state_version = ${version}, updated_at = now()
     where campaign_id = ${campaignId}`;
}

/** Set the run's rolled-up cost (kill-switch accounting mirror of the ledger). */
export async function setRunCost(sql: Db, campaignId: CampaignId, costUsd: number): Promise<void> {
  await sql`
    update factory.factory_runs
       set cost_usd = ${costUsd}, updated_at = now()
     where campaign_id = ${campaignId}`;
}

/** Polling-fallback read model: run header + public events since `afterSeq`. */
export async function getRunReadModel(
  sql: Db,
  campaignId: CampaignId,
  afterSeq = 0,
): Promise<RunReadModel | null> {
  const run = await getRun(sql, campaignId);
  if (!run) return null;
  const events = await readEvents(sql, campaignId, afterSeq, "public");
  return {
    campaignId: run.campaignId,
    batchId: run.batchId,
    status: run.status,
    stateVersion: run.stateVersion,
    lastSequence: run.lastSequence,
    events,
  };
}
