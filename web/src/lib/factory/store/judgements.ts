// Judgement Requests (ADR 0005): conditional, non-blocking; default-applied
// unless a human answers.

import type { CampaignId, JudgementId } from "../contracts/core";
import type { JudgementKind, JudgementRequest, JudgementStatus } from "../contracts/state";
import type { Db, JsonInput, Row } from "./types";
import { newId, strOrUndef, toIsoOrUndef } from "./types";

export type JudgementInput = Omit<JudgementRequest, "id" | "status"> & {
  id?: JudgementId;
  status?: JudgementStatus;
};

function mapJudgement(r: Row): JudgementRequest {
  return {
    id: String(r.id),
    campaignId: String(r.campaign_id),
    agentRunId: String(r.agent_run_id),
    kind: String(r.kind) as JudgementKind,
    question: String(r.question),
    options: (r.options as string[]) ?? [],
    provisionalDefault: String(r.provisional_default),
    rationale: String(r.rationale),
    affectedOutputs: (r.affected_outputs as string[]) ?? [],
    status: String(r.status) as JudgementStatus,
    answer: strOrUndef(r.answer),
    answeredAt: toIsoOrUndef(r.answered_at),
  };
}

export async function insertJudgement(sql: Db, input: JudgementInput): Promise<JudgementId> {
  const id = input.id ?? newId();
  await sql`
    insert into factory.judgements
      (id, campaign_id, agent_run_id, kind, question, options, provisional_default,
       rationale, affected_outputs, status)
    values
      (${id}, ${input.campaignId}, ${input.agentRunId}, ${input.kind}, ${input.question},
       ${sql.json((input.options ?? []) as unknown as JsonInput)}, ${input.provisionalDefault},
       ${input.rationale ?? ""}, ${sql.json((input.affectedOutputs ?? []) as unknown as JsonInput)},
       ${input.status ?? "open"})`;
  return id;
}

export async function getJudgement(sql: Db, id: JudgementId): Promise<JudgementRequest | null> {
  const rows = await sql<Row[]>`select * from factory.judgements where id = ${id}`;
  return rows.length ? mapJudgement(rows[0]) : null;
}

export async function listJudgements(
  sql: Db,
  campaignId: CampaignId,
  status?: JudgementStatus,
): Promise<JudgementRequest[]> {
  const rows = status
    ? await sql<Row[]>`
        select * from factory.judgements
         where campaign_id = ${campaignId} and status = ${status}
         order by created_at asc`
    : await sql<Row[]>`
        select * from factory.judgements where campaign_id = ${campaignId} order by created_at asc`;
  return rows.map(mapJudgement);
}

export interface ResolveJudgementInput {
  status: JudgementStatus; // "defaulted" | "resolved"
  answer?: string;
}

/** Record an answer or the applied default. */
export async function resolveJudgement(
  sql: Db,
  id: JudgementId,
  input: ResolveJudgementInput,
): Promise<void> {
  await sql`
    update factory.judgements
       set status = ${input.status},
           answer = ${input.answer ?? null},
           answered_at = now(),
           updated_at = now()
     where id = ${id}`;
}
