// Replay manifests (ADR 0001). A pinned manifest at a fixed route is the
// permanent conference backup.

import type { BatchId, CampaignId } from "../contracts/core";
import type { Db, JsonInput, Row } from "./types";
import { newId, strOrUndef, toIso } from "./types";

export interface ReplayManifestInput {
  id?: string;
  label: string;
  environmentId: string;
  route?: string;
  batchId?: BatchId;
  campaignIds: CampaignId[];
  manifest?: Record<string, unknown>;
  pinned?: boolean;
}

export interface ReplayManifestRecord {
  id: string;
  label: string;
  environmentId: string;
  route?: string;
  batchId?: BatchId;
  campaignIds: CampaignId[];
  manifest: Record<string, unknown>;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapManifest(r: Row): ReplayManifestRecord {
  return {
    id: String(r.id),
    label: String(r.label),
    environmentId: String(r.environment_id),
    route: strOrUndef(r.route),
    batchId: strOrUndef(r.batch_id),
    campaignIds: (r.campaign_ids as CampaignId[]) ?? [],
    manifest: (r.manifest as Record<string, unknown>) ?? {},
    pinned: Boolean(r.pinned),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function saveReplayManifest(sql: Db, input: ReplayManifestInput): Promise<string> {
  const id = input.id ?? newId();
  await sql`
    insert into factory.replay_manifests
      (id, label, environment_id, route, batch_id, campaign_ids, manifest, pinned)
    values
      (${id}, ${input.label}, ${input.environmentId}, ${input.route ?? null},
       ${input.batchId ?? null}, ${sql.json(input.campaignIds as unknown as JsonInput)},
       ${sql.json((input.manifest ?? {}) as unknown as JsonInput)}, ${input.pinned ?? false})
    on conflict (id) do update set
      label = excluded.label,
      environment_id = excluded.environment_id,
      route = excluded.route,
      batch_id = excluded.batch_id,
      campaign_ids = excluded.campaign_ids,
      manifest = excluded.manifest,
      pinned = excluded.pinned,
      updated_at = now()`;
  return id;
}

export async function getReplayManifest(sql: Db, id: string): Promise<ReplayManifestRecord | null> {
  const rows = await sql<Row[]>`select * from factory.replay_manifests where id = ${id}`;
  return rows.length ? mapManifest(rows[0]) : null;
}

/** The pinned manifest for a route (the permanent public replay). */
export async function getPinnedReplay(sql: Db, route: string): Promise<ReplayManifestRecord | null> {
  const rows = await sql<Row[]>`
    select * from factory.replay_manifests where route = ${route} and pinned = true limit 1`;
  return rows.length ? mapManifest(rows[0]) : null;
}

/** Pin one manifest for a route, unpinning any other for the same route. */
export async function pinReplay(sql: Db, id: string): Promise<void> {
  await sql.begin(async (tx) => {
    const rows = await tx<{ route: string | null }[]>`
      select route from factory.replay_manifests where id = ${id}`;
    const route = rows[0]?.route ?? null;
    if (route != null) {
      await tx`
        update factory.replay_manifests
           set pinned = false, updated_at = now()
         where route = ${route} and id <> ${id} and pinned = true`;
    }
    await tx`update factory.replay_manifests set pinned = true, updated_at = now() where id = ${id}`;
  });
}
