// Replay manifest body (ADR 0001 / parameters §7). The immutable snapshot that
// promote-replay.mjs writes into factory.replay_manifests.manifest (jsonb) and
// the pinned replay route reads back. Runtime-neutral: no next/* imports.
//
// A manifest is created once and never mutated. Re-promotion writes a NEW
// manifest row (fresh id) and repins the route pointer; the ROUTE never changes.
// Because Factory Events are the single UI transport, the manifest carries the
// full public event log — replay renders ENTIRELY from these stored events
// through the same fold + gallery renderer as a live run.

import type { FactoryEvent, RunStatus } from "../contracts/core";
import { REPLAY_ROUTE, replayLabel } from "../contracts/api";

export const REPLAY_MANIFEST_VERSION = 1 as const;

/** One campaign's header metadata, enough to seed the fold (problem/place) and
 *  order the gallery columns. Mirrors the fields the live gallery derives. */
export interface ReplayCampaignMeta {
  campaignId: string;
  batchId?: string;
  problem: string;
  place: string;
  mode: "public" | "presenter";
  status: RunStatus;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  costUsd?: number;
  lastSequence?: number;
  stateVersion?: number;
}

export interface ReplayBatchMeta {
  batchId: string;
  environmentId: string;
  mode: "public" | "presenter";
  status: RunStatus;
  size: number;
  createdAt?: string;
  completedAt?: string;
  receipt?: unknown;
}

export interface ReplayManifestBody {
  version: typeof REPLAY_MANIFEST_VERSION;
  label: string; // permanent replayLabel() — also stored on the row
  labelDate: string; // ISO date the label is stamped with
  promotedAt: string; // ISO timestamp of promotion
  environmentId: string;
  route: string; // always REPLAY_ROUTE
  source: {
    kind: "batch" | "campaign";
    batchId?: string;
    // campaign_id == run id in this schema; both names kept for the record.
    campaignIds: string[];
    runIds: string[];
  };
  batch?: ReplayBatchMeta;
  campaigns: ReplayCampaignMeta[]; // stable column order (created_at asc)
  events: FactoryEvent[]; // ALL public events across campaigns, global time order
  receipts: {
    batch?: unknown;
    campaigns: Record<string, unknown>; // campaignId -> receipt.campaign detail
  };
  counts: {
    campaigns: number;
    events: number;
    firstEventAt?: string;
    lastEventAt?: string;
  };
}

export { REPLAY_ROUTE, replayLabel };

/** Defensive parse of the jsonb manifest body read back from the store. Returns
 *  null when the shape is unusable so the route can render an honest empty
 *  state instead of throwing. Never fabricates a run. */
export function parseReplayManifest(raw: unknown): ReplayManifestBody | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<ReplayManifestBody>;
  if (!Array.isArray(b.events) || !Array.isArray(b.campaigns)) return null;
  if (b.events.length === 0 || b.campaigns.length === 0) return null;
  return {
    version: REPLAY_MANIFEST_VERSION,
    label: typeof b.label === "string" ? b.label : "",
    labelDate: typeof b.labelDate === "string" ? b.labelDate : "",
    promotedAt: typeof b.promotedAt === "string" ? b.promotedAt : "",
    environmentId: typeof b.environmentId === "string" ? b.environmentId : "",
    route: typeof b.route === "string" ? b.route : REPLAY_ROUTE,
    source:
      b.source && typeof b.source === "object"
        ? {
            kind: b.source.kind === "batch" ? "batch" : "campaign",
            batchId: b.source.batchId,
            campaignIds: Array.isArray(b.source.campaignIds) ? b.source.campaignIds : [],
            runIds: Array.isArray(b.source.runIds) ? b.source.runIds : [],
          }
        : { kind: "campaign", campaignIds: [], runIds: [] },
    batch: b.batch,
    campaigns: b.campaigns as ReplayCampaignMeta[],
    events: b.events as FactoryEvent[],
    receipts:
      b.receipts && typeof b.receipts === "object"
        ? { batch: b.receipts.batch, campaigns: b.receipts.campaigns ?? {} }
        : { campaigns: {} },
    counts:
      b.counts && typeof b.counts === "object"
        ? {
            campaigns: b.counts.campaigns ?? (b.campaigns as unknown[]).length,
            events: b.counts.events ?? (b.events as unknown[]).length,
            firstEventAt: b.counts.firstEventAt,
            lastEventAt: b.counts.lastEventAt,
          }
        : { campaigns: b.campaigns.length, events: b.events.length },
  };
}

/** Group a manifest's global public event log by campaign, preserving order. */
export function eventsByCampaign(body: ReplayManifestBody): Map<string, FactoryEvent[]> {
  const map = new Map<string, FactoryEvent[]>();
  for (const c of body.campaigns) map.set(c.campaignId, []);
  for (const e of body.events) {
    const list = map.get(e.campaignId);
    if (list) list.push(e);
    else map.set(e.campaignId, [e]);
  }
  return map;
}
