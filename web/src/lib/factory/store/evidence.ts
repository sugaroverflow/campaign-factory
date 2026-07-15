// Evidence ledger store: sources, retrieval attempts, claims, and the
// claim<->source evidence join. recordSource is idempotent so the gateway can
// re-fetch a URL and still cite a stable source id.

import type { AgentRunId, CampaignId, ClaimId, SourceId } from "../contracts/core";
import type { Claim, ClaimType, RetrievalStatus, Source, SourceTier } from "../contracts/evidence";
import type { VerificationLabel } from "../../pipeline/labels";
import type { Db, JsonInput, Row } from "./types";
import { newId, strOrUndef, toIso, toIsoOrUndef } from "./types";

/* ---- sources ---- */

// Source minus the store-assigned id.
export type SourceInput = Omit<Source, "id"> & { id?: SourceId };

function mapSource(r: Row): Source {
  return {
    id: String(r.id),
    campaignId: String(r.campaign_id),
    url: String(r.url),
    title: String(r.title),
    organisation: String(r.organisation),
    publishedAt: toIsoOrUndef(r.published_at),
    accessedAt: toIso(r.accessed_at),
    tier: String(r.tier) as SourceTier,
    isPrimary: Boolean(r.is_primary),
    mediaType: String(r.media_type),
    contentHash: String(r.content_hash),
    retrievalStatus: String(r.retrieval_status) as RetrievalStatus,
  };
}

/**
 * Idempotent by (campaignId, url): re-recording the same URL for a campaign
 * updates the mutable fields and returns the EXISTING row (with its already
 * assigned id) so agents keep a stable citation id across re-fetches.
 */
export async function recordSource(sql: Db, input: SourceInput): Promise<Source> {
  const id = input.id ?? newId();
  const rows = await sql<Row[]>`
    insert into factory.sources
      (id, campaign_id, url, title, organisation, published_at, accessed_at, tier,
       is_primary, media_type, content_hash, retrieval_status)
    values
      (${id}, ${input.campaignId}, ${input.url}, ${input.title ?? ""},
       ${input.organisation ?? ""}, ${input.publishedAt ?? null}, ${input.accessedAt},
       ${input.tier}, ${input.isPrimary}, ${input.mediaType ?? "html"},
       ${input.contentHash ?? ""}, ${input.retrievalStatus})
    on conflict (campaign_id, url) do update set
      title = excluded.title,
      organisation = excluded.organisation,
      published_at = excluded.published_at,
      accessed_at = excluded.accessed_at,
      tier = excluded.tier,
      is_primary = excluded.is_primary,
      media_type = excluded.media_type,
      content_hash = excluded.content_hash,
      retrieval_status = excluded.retrieval_status,
      updated_at = now()
    returning *`;
  return mapSource(rows[0]);
}

export async function getSources(sql: Db, campaignId: CampaignId, sourceIds?: SourceId[]): Promise<Source[]> {
  const rows =
    sourceIds && sourceIds.length > 0
      ? await sql<Row[]>`
          select * from factory.sources
           where campaign_id = ${campaignId} and id::text = any(${sourceIds})
           order by created_at asc`
      : await sql<Row[]>`
          select * from factory.sources where campaign_id = ${campaignId} order by created_at asc`;
  return rows.map(mapSource);
}

/* ---- source retrievals ---- */

export interface RetrievalInput {
  id?: string;
  sourceId: SourceId;
  campaignId: CampaignId;
  agentRunId?: AgentRunId;
  status: RetrievalStatus;
  httpStatus?: number;
  contentHash?: string;
  extractedChars?: number;
  mediaType?: string;
  excerpt?: string;
  meta?: Record<string, unknown>;
}

export async function recordRetrieval(sql: Db, input: RetrievalInput): Promise<string> {
  const id = input.id ?? newId();
  await sql`
    insert into factory.source_retrievals
      (id, source_id, campaign_id, agent_run_id, status, http_status, content_hash,
       extracted_chars, media_type, excerpt, meta)
    values
      (${id}, ${input.sourceId}, ${input.campaignId}, ${input.agentRunId ?? null},
       ${input.status}, ${input.httpStatus ?? null}, ${input.contentHash ?? null},
       ${input.extractedChars ?? null}, ${input.mediaType ?? null}, ${input.excerpt ?? null},
       ${sql.json((input.meta ?? {}) as unknown as JsonInput)})`;
  return id;
}

/* ---- claims ---- */

// Claim with an optional id (generated if absent).
export type ClaimInput = Omit<Claim, "id"> & { id?: ClaimId };

function mapClaim(r: Row): Claim {
  return {
    id: String(r.id),
    campaignId: String(r.campaign_id),
    text: String(r.text),
    type: String(r.type) as ClaimType,
    status: String(r.status) as VerificationLabel,
    loadBearing: Boolean(r.load_bearing),
    confidence: String(r.confidence) as Claim["confidence"],
    sourceIds: (r.source_ids as SourceId[]) ?? [],
    excerpt: strOrUndef(r.excerpt),
    authorAgentRunId: String(r.author_agent_run_id),
    adjudicatedBy: strOrUndef(r.adjudicated_by),
    stateVersion: Number(r.state_version),
    affectedOutputs: (r.affected_outputs as string[]) ?? [],
    contradictsClaimIds: (r.contradicts_claim_ids as ClaimId[]) ?? [],
    supersedesClaimIds: (r.supersedes_claim_ids as ClaimId[]) ?? [],
    staleOfClaimId: strOrUndef(r.stale_of_claim_id),
  };
}

/** Insert or update a claim (conflict on id). Returns the stored claim. */
export async function upsertClaim(sql: Db, input: ClaimInput): Promise<Claim> {
  const id = input.id ?? newId();
  const rows = await sql<Row[]>`
    insert into factory.claims
      (id, campaign_id, text, type, status, load_bearing, confidence, source_ids, excerpt,
       author_agent_run_id, adjudicated_by, state_version, affected_outputs,
       contradicts_claim_ids, supersedes_claim_ids, stale_of_claim_id)
    values
      (${id}, ${input.campaignId}, ${input.text}, ${input.type}, ${input.status},
       ${input.loadBearing}, ${input.confidence}, ${sql.json((input.sourceIds ?? []) as unknown as JsonInput)},
       ${input.excerpt ?? null}, ${input.authorAgentRunId}, ${input.adjudicatedBy ?? null},
       ${input.stateVersion}, ${sql.json((input.affectedOutputs ?? []) as unknown as JsonInput)},
       ${sql.json((input.contradictsClaimIds ?? []) as unknown as JsonInput)},
       ${sql.json((input.supersedesClaimIds ?? []) as unknown as JsonInput)},
       ${input.staleOfClaimId ?? null})
    on conflict (id) do update set
      text = excluded.text,
      type = excluded.type,
      status = excluded.status,
      load_bearing = excluded.load_bearing,
      confidence = excluded.confidence,
      source_ids = excluded.source_ids,
      excerpt = excluded.excerpt,
      adjudicated_by = excluded.adjudicated_by,
      state_version = excluded.state_version,
      affected_outputs = excluded.affected_outputs,
      contradicts_claim_ids = excluded.contradicts_claim_ids,
      supersedes_claim_ids = excluded.supersedes_claim_ids,
      stale_of_claim_id = excluded.stale_of_claim_id,
      updated_at = now()
    returning *`;
  return mapClaim(rows[0]);
}

export async function getClaims(sql: Db, campaignId: CampaignId, claimIds?: ClaimId[]): Promise<Claim[]> {
  const rows =
    claimIds && claimIds.length > 0
      ? await sql<Row[]>`
          select * from factory.claims
           where campaign_id = ${campaignId} and id::text = any(${claimIds})
           order by created_at asc`
      : await sql<Row[]>`
          select * from factory.claims where campaign_id = ${campaignId} order by created_at asc`;
  return rows.map(mapClaim);
}

/* ---- claim <-> source evidence join ---- */

export interface ClaimEvidenceInput {
  id?: string;
  claimId: ClaimId;
  sourceId: SourceId;
  campaignId: CampaignId;
  excerpt?: string;
  note?: string;
}

export async function linkClaimEvidence(sql: Db, input: ClaimEvidenceInput): Promise<void> {
  await sql`
    insert into factory.claim_evidence (id, claim_id, source_id, campaign_id, excerpt, note)
    values (${input.id ?? newId()}, ${input.claimId}, ${input.sourceId}, ${input.campaignId},
            ${input.excerpt ?? null}, ${input.note ?? null})
    on conflict (claim_id, source_id) do update set
      excerpt = excluded.excerpt,
      note = excluded.note`;
}

export interface ClaimEvidenceRow {
  claimId: ClaimId;
  sourceId: SourceId;
  campaignId: CampaignId;
  excerpt?: string;
  note?: string;
}

export async function getClaimEvidence(sql: Db, claimId: ClaimId): Promise<ClaimEvidenceRow[]> {
  const rows = await sql<Row[]>`
    select * from factory.claim_evidence where claim_id = ${claimId} order by created_at asc`;
  return rows.map((r) => ({
    claimId: String(r.claim_id),
    sourceId: String(r.source_id),
    campaignId: String(r.campaign_id),
    excerpt: strOrUndef(r.excerpt),
    note: strOrUndef(r.note),
  }));
}
