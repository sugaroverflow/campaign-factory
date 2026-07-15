// Generic artefact store: agent handoffs and bounded context extracts keyed by
// a stable ref. resolveContextExtracts turns an envelope's contextRefs into the
// stored artefact content for assembling bounded agent context (W3 gateway).

import type { AgentRunId, CampaignId } from "../contracts/core";
import type { Db, JsonInput, Row } from "./types";
import { newId, strOrUndef, toIso } from "./types";

export interface ArtefactInput {
  id?: string;
  campaignId: CampaignId;
  agentRunId?: AgentRunId;
  kind: string; // 'handoff' | 'context_extract' | ...
  ref: string; // stable reference string (unique per campaign)
  title?: string;
  content?: unknown;
}

export interface ArtefactRecord {
  id: string;
  campaignId: CampaignId;
  agentRunId?: AgentRunId;
  kind: string;
  ref: string;
  title?: string;
  content?: unknown;
  createdAt: string;
  updatedAt: string;
}

function mapArtefact(r: Row): ArtefactRecord {
  return {
    id: String(r.id),
    campaignId: String(r.campaign_id),
    agentRunId: strOrUndef(r.agent_run_id),
    kind: String(r.kind),
    ref: String(r.ref),
    title: strOrUndef(r.title),
    content: r.content ?? undefined,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

/** Upsert an artefact by (campaignId, ref). */
export async function recordArtefact(sql: Db, input: ArtefactInput): Promise<string> {
  const id = input.id ?? newId();
  await sql`
    insert into factory.artefacts (id, campaign_id, agent_run_id, kind, ref, title, content)
    values (${id}, ${input.campaignId}, ${input.agentRunId ?? null}, ${input.kind},
            ${input.ref}, ${input.title ?? null},
            ${input.content === undefined ? null : sql.json(input.content as unknown as JsonInput)})
    on conflict (campaign_id, ref) do update set
      agent_run_id = excluded.agent_run_id,
      kind = excluded.kind,
      title = excluded.title,
      content = excluded.content,
      updated_at = now()`;
  return id;
}

export async function getArtefact(sql: Db, campaignId: CampaignId, ref: string): Promise<ArtefactRecord | null> {
  const rows = await sql<Row[]>`
    select * from factory.artefacts where campaign_id = ${campaignId} and ref = ${ref}`;
  return rows.length ? mapArtefact(rows[0]) : null;
}

export async function listArtefacts(sql: Db, campaignId: CampaignId): Promise<ArtefactRecord[]> {
  const rows = await sql<Row[]>`
    select * from factory.artefacts where campaign_id = ${campaignId} order by created_at asc`;
  return rows.map(mapArtefact);
}

/**
 * Resolve a set of context refs (from an AgentTaskEnvelope) into their stored
 * artefacts, preserving the requested order and dropping refs with no artefact.
 * Bounded context assembly for agent invocation (W3 evidence/context gateway).
 */
export async function resolveContextExtracts(
  sql: Db,
  campaignId: CampaignId,
  refs: string[],
): Promise<ArtefactRecord[]> {
  if (refs.length === 0) return [];
  const rows = await sql<Row[]>`
    select * from factory.artefacts
     where campaign_id = ${campaignId} and ref = any(${refs})`;
  const byRef = new Map(rows.map((r) => [String(r.ref), mapArtefact(r)]));
  return refs.map((ref) => byRef.get(ref)).filter((a): a is ArtefactRecord => a !== undefined);
}
