// Cost + latency ledger metrics (parameters §5, §8; task #9). Consumes W1's
// cost_ledger + factory_events stores — no writes, no model calls. Everything
// here is derived from stored rows so the numbers are auditable against the
// events the UI already showed. Runtime-neutral: no next/* imports.
//
// The four §8 release-threshold latency milestones are derived per campaign
// from the public event log, relative to run start:
//   - first sourced finding   (target: LATENCY_TARGETS.firstSourcedFindingMs)
//   - first accepted section  (target: LATENCY_TARGETS.firstAcceptedSectionMs)
//   - campaign usable         (target: LATENCY_TARGETS.firstCampaignUsableMs)
//   - batch complete          (target: LATENCY_TARGETS.batchSubstantiallyCompleteMs)
//
// "Campaign usable" has no dedicated event in the frozen vocabulary; we use a
// documented proxy (the campaign's first terminal-usable run event, i.e.
// run.completed | run.partial). If W3/W6 later emit an explicit usable marker,
// swap the proxy in usableMilestone() — nothing else changes.

import type { BatchId, CampaignId, FactoryEvent, FactoryEventType } from "../contracts/core";
import { COST_GUARDS, LATENCY_TARGETS } from "../contracts/limits";
import type { Db, Row } from "../store/types";
import { readEvents } from "../store/events";
import { getRun, getBatch, listRunsByBatch, type RunRecord } from "../store/runs";
import { campaignCostBreakdown, batchCostTotal, type CostBreakdown } from "../store/ledger";

export { COST_GUARDS, LATENCY_TARGETS };

// ---- percentiles ----

export interface Percentiles {
  n: number;
  p50?: number;
  p95?: number;
  min?: number;
  max?: number;
}

/** Nearest-rank percentiles over a set of finite values (ms). */
export function percentiles(values: number[]): Percentiles {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0 };
  const at = (p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
  return { n: xs.length, p50: at(50), p95: at(95), min: xs[0], max: xs[xs.length - 1] };
}

// ---- milestones ----

export interface CampaignMilestones {
  campaignId: CampaignId;
  startAt?: string;
  firstSourcedFindingAt?: string;
  firstSourcedFindingMs?: number;
  firstAcceptedSectionAt?: string;
  firstAcceptedSectionMs?: number;
  usableAt?: string;
  usableMs?: number;
  completeAt?: string;
  completeMs?: number;
}

function ms(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

function earliestOf(events: FactoryEvent[], pred: (e: FactoryEvent) => boolean): string | undefined {
  let best: string | undefined;
  let bestT = Infinity;
  for (const e of events) {
    if (!pred(e)) continue;
    const t = ms(e.at);
    if (t != null && t < bestT) {
      bestT = t;
      best = e.at;
    }
  }
  return best;
}

const TERMINAL_USABLE = new Set<FactoryEventType>(["run.completed", "run.partial"]);
const TERMINAL_ANY = new Set<FactoryEventType>([
  "run.completed",
  "run.partial",
  "run.failed",
  "run.cancelled",
]);

/** First "sourced finding": an evidence.found (a claim backed by a source);
 *  falls back to the first completed source fetch when none was emitted. */
function sourcedFinding(events: FactoryEvent[]): string | undefined {
  return (
    earliestOf(events, (e) => e.type === "evidence.found") ??
    earliestOf(events, (e) => e.type === "source.fetch.completed")
  );
}

/** First accepted section: a section.status (or proposal.applied) that reached
 *  "accepted", or an explicit proposal.accepted. */
function acceptedSection(events: FactoryEvent[]): string | undefined {
  return (
    earliestOf(events, (e) => e.payload?.sectionStatus === "accepted") ??
    earliestOf(events, (e) => e.type === "proposal.accepted")
  );
}

/** Campaign usable — documented proxy (see file header). */
function usableMilestone(events: FactoryEvent[], run: RunRecord | null): string | undefined {
  return earliestOf(events, (e) => TERMINAL_USABLE.has(e.type)) ?? run?.completedAt;
}

export async function campaignMilestones(sql: Db, campaignId: CampaignId): Promise<CampaignMilestones> {
  const [run, events] = await Promise.all([
    getRun(sql, campaignId),
    readEvents(sql, campaignId, 0, "public"),
  ]);
  const startAt = run?.startedAt ?? earliestOf(events, () => true) ?? run?.createdAt;
  const startMs = ms(startAt);
  const rel = (at?: string): number | undefined => {
    const t = ms(at);
    if (t == null || startMs == null) return undefined;
    return Math.max(0, t - startMs);
  };

  const sf = sourcedFinding(events);
  const as = acceptedSection(events);
  const usable = usableMilestone(events, run);
  const complete = earliestOf(events, (e) => TERMINAL_ANY.has(e.type)) ?? run?.completedAt;

  return {
    campaignId,
    startAt,
    firstSourcedFindingAt: sf,
    firstSourcedFindingMs: rel(sf),
    firstAcceptedSectionAt: as,
    firstAcceptedSectionMs: rel(as),
    usableAt: usable,
    usableMs: rel(usable),
    completeAt: complete,
    completeMs: rel(complete),
  };
}

// ---- cache tokens (best-effort; only if W3 records them in ledger meta) ----

export interface CacheTokens {
  read: number;
  write: number;
  recorded: boolean;
}

const CACHE_READ_KEYS = [
  "cacheReadInputTokens",
  "cache_read_input_tokens",
  "cacheReadTokens",
  "cachedInputTokens",
  "cache_read",
];
const CACHE_WRITE_KEYS = [
  "cacheCreationInputTokens",
  "cache_creation_input_tokens",
  "cacheWriteTokens",
  "cacheCreationTokens",
  "cache_write",
];

function pickNum(meta: Record<string, unknown> | undefined, keys: string[]): number {
  if (!meta) return 0;
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

async function cacheTokens(sql: Db, where: "campaign" | "batch", id: string): Promise<CacheTokens> {
  const rows =
    where === "campaign"
      ? await sql<Row[]>`select meta from factory.cost_ledger where campaign_id = ${id}`
      : await sql<Row[]>`select meta from factory.cost_ledger where batch_id = ${id}`;
  let read = 0;
  let write = 0;
  let recorded = false;
  for (const r of rows) {
    const meta = (r.meta as Record<string, unknown>) ?? {};
    const rd = pickNum(meta, CACHE_READ_KEYS);
    const wr = pickNum(meta, CACHE_WRITE_KEYS);
    if (rd || wr || CACHE_READ_KEYS.some((k) => k in meta) || CACHE_WRITE_KEYS.some((k) => k in meta)) {
      recorded = true;
    }
    read += rd;
    write += wr;
  }
  return { read, write, recorded };
}

// ---- per-campaign ledger ----

export interface CampaignLedger {
  campaignId: CampaignId;
  batchId?: BatchId;
  problem?: string;
  place?: string;
  status?: string;
  cost: CostBreakdown;
  cache: CacheTokens;
  overWarning: boolean; // >= $4
  overHardStop: boolean; // >= $8
  milestones: CampaignMilestones;
}

export async function campaignLedger(sql: Db, campaignId: CampaignId): Promise<CampaignLedger> {
  const [run, cost, cache, milestones] = await Promise.all([
    getRun(sql, campaignId),
    campaignCostBreakdown(sql, campaignId),
    cacheTokens(sql, "campaign", campaignId),
    campaignMilestones(sql, campaignId),
  ]);
  return {
    campaignId,
    batchId: run?.batchId,
    problem: run?.problem,
    place: run?.place,
    status: run?.status,
    cost,
    cache,
    overWarning: cost.totalUsd >= COST_GUARDS.perCampaignWarningUSD,
    overHardStop: cost.totalUsd >= COST_GUARDS.perCampaignHardStopUSD,
    milestones,
  };
}

// ---- per-batch ledger ----

export interface BatchLatency {
  firstSourcedFinding: Percentiles;
  firstAcceptedSection: Percentiles;
  usable: Percentiles;
  firstCampaignUsableMs?: number; // batch-relative: min campaign usable time
  batchCompleteMs?: number; // batch-relative: batch terminal time
}

export interface BatchLedger {
  batchId: BatchId;
  status?: string;
  size?: number;
  totalUsd: number;
  overWarning: boolean; // >= $20
  overHardStop: boolean; // >= $35
  cache: CacheTokens;
  campaigns: CampaignLedger[];
  latency: BatchLatency;
}

export async function batchLedger(sql: Db, batchId: BatchId): Promise<BatchLedger> {
  const [batch, runs, total, cache] = await Promise.all([
    getBatch(sql, batchId),
    listRunsByBatch(sql, batchId),
    batchCostTotal(sql, batchId),
    cacheTokens(sql, "batch", batchId),
  ]);
  const campaigns = await Promise.all(runs.map((r) => campaignLedger(sql, r.campaignId)));

  const sf = campaigns.map((c) => c.milestones.firstSourcedFindingMs).filter((v): v is number => v != null);
  const as = campaigns.map((c) => c.milestones.firstAcceptedSectionMs).filter((v): v is number => v != null);
  const us = campaigns.map((c) => c.milestones.usableMs).filter((v): v is number => v != null);

  // Batch-relative aggregates use the earliest campaign start as the batch t0.
  const batchStartMs = Math.min(
    ...campaigns.map((c) => Date.parse(c.milestones.startAt ?? "")).filter((t) => Number.isFinite(t)),
  );
  const usableAbs = campaigns
    .map((c) => Date.parse(c.milestones.usableAt ?? ""))
    .filter((t) => Number.isFinite(t));
  const firstCampaignUsableMs =
    Number.isFinite(batchStartMs) && usableAbs.length
      ? Math.max(0, Math.min(...usableAbs) - batchStartMs)
      : undefined;
  const completeMs = batch?.completedAt ? Date.parse(batch.completedAt) : NaN;
  const batchCompleteMs =
    Number.isFinite(batchStartMs) && Number.isFinite(completeMs)
      ? Math.max(0, completeMs - batchStartMs)
      : undefined;

  return {
    batchId,
    status: batch?.status,
    size: batch?.size,
    totalUsd: total,
    overWarning: total >= COST_GUARDS.presenterBatchWarningUSD,
    overHardStop: total >= COST_GUARDS.presenterBatchHardStopUSD,
    cache,
    campaigns,
    latency: {
      firstSourcedFinding: percentiles(sf),
      firstAcceptedSection: percentiles(as),
      usable: percentiles(us),
      firstCampaignUsableMs,
      batchCompleteMs,
    },
  };
}

// ---- enumeration for the internal admin surface ----
// Read-only listing queries. The W1 store has no list-all helpers and is frozen,
// so these minimal SELECTs live here; they touch the same rows the store maps.

export async function listRecentCampaignIds(sql: Db, limit = 50): Promise<CampaignId[]> {
  const rows = await sql<{ campaign_id: string }[]>`
    select campaign_id from factory.factory_runs
     order by created_at desc
     limit ${limit}`;
  return rows.map((r) => String(r.campaign_id));
}

export async function listRecentBatchIds(sql: Db, limit = 25): Promise<BatchId[]> {
  const rows = await sql<{ batch_id: string }[]>`
    select batch_id from factory.factory_batches
     order by created_at desc
     limit ${limit}`;
  return rows.map((r) => String(r.batch_id));
}

export interface LedgerOverview {
  campaigns: CampaignLedger[];
  batches: BatchLedger[];
  latency: {
    firstSourcedFinding: Percentiles;
    firstAcceptedSection: Percentiles;
    usable: Percentiles;
  };
  totals: {
    campaignCount: number;
    batchCount: number;
    campaignSpendUsd: number;
  };
}

/** Everything the internal costs page needs, in one call. */
export async function ledgerOverview(sql: Db, opts: { campaignLimit?: number; batchLimit?: number } = {}): Promise<LedgerOverview> {
  const [campaignIds, batchIds] = await Promise.all([
    listRecentCampaignIds(sql, opts.campaignLimit ?? 50),
    listRecentBatchIds(sql, opts.batchLimit ?? 25),
  ]);
  const campaigns = await Promise.all(campaignIds.map((id) => campaignLedger(sql, id)));
  const batches = await Promise.all(batchIds.map((id) => batchLedger(sql, id)));

  const sf = campaigns.map((c) => c.milestones.firstSourcedFindingMs).filter((v): v is number => v != null);
  const as = campaigns.map((c) => c.milestones.firstAcceptedSectionMs).filter((v): v is number => v != null);
  const us = campaigns.map((c) => c.milestones.usableMs).filter((v): v is number => v != null);

  return {
    campaigns,
    batches,
    latency: {
      firstSourcedFinding: percentiles(sf),
      firstAcceptedSection: percentiles(as),
      usable: percentiles(us),
    },
    totals: {
      campaignCount: campaigns.length,
      batchCount: batches.length,
      campaignSpendUsd: campaigns.reduce((s, c) => s + c.cost.totalUsd, 0),
    },
  };
}
