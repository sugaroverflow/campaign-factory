// Versioned Canonical Document renders (docs 1–6 html, packs 7–9 resources).

import type { CampaignId } from "../contracts/core";
import type { CampaignDocumentState } from "../contracts/state";
import type { CanonicalDocumentKey, DocumentStatus, PackResource } from "../contracts/documents";
import type { Db, JsonInput, Row } from "./types";
import { newId } from "./types";

export interface SaveDocumentVersionInput {
  campaignId: CampaignId;
  documentKey: CanonicalDocumentKey;
  version: number;
  status: DocumentStatus;
  html?: string;
  resources?: PackResource[];
  stateVersion?: number;
}

export async function saveDocumentVersion(sql: Db, input: SaveDocumentVersionInput): Promise<void> {
  await sql`
    insert into factory.document_versions
      (id, campaign_id, document_key, version, status, html, resources, state_version)
    values
      (${newId()}, ${input.campaignId}, ${input.documentKey}, ${input.version}, ${input.status},
       ${input.html ?? null},
       ${input.resources ? sql.json(input.resources as unknown as JsonInput) : null},
       ${input.stateVersion ?? null})
    on conflict (campaign_id, document_key, version) do update set
      status = excluded.status,
      html = excluded.html,
      resources = excluded.resources,
      state_version = excluded.state_version`;
}

function mapDocument(r: Row): CampaignDocumentState {
  const doc: CampaignDocumentState = {
    key: String(r.document_key) as CanonicalDocumentKey,
    status: String(r.status) as DocumentStatus,
    version: Number(r.version),
  };
  if (r.html != null) doc.html = String(r.html);
  if (r.resources != null) doc.resources = r.resources as PackResource[];
  return doc;
}

export async function loadLatestDocument(
  sql: Db,
  campaignId: CampaignId,
  documentKey: CanonicalDocumentKey,
): Promise<CampaignDocumentState | null> {
  const rows = await sql<Row[]>`
    select * from factory.document_versions
     where campaign_id = ${campaignId} and document_key = ${documentKey}
     order by version desc
     limit 1`;
  return rows.length ? mapDocument(rows[0]) : null;
}

/** Latest version of every document for a campaign, one row per document_key. */
export async function listLatestDocuments(sql: Db, campaignId: CampaignId): Promise<CampaignDocumentState[]> {
  const rows = await sql<Row[]>`
    select distinct on (document_key) *
      from factory.document_versions
     where campaign_id = ${campaignId}
     order by document_key, version desc`;
  return rows.map(mapDocument);
}
