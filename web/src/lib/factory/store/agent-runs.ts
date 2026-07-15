// Agent-run lifecycle: durable per-agent identity rows (ADR 0004).

import type { AgentRunId, AgentRunStatus, BatchId, CampaignId } from "../contracts/core";
import type { Db, JsonInput, Row } from "./types";
import { newId, strOrUndef, toIso, toIsoOrUndef } from "./types";

export interface AgentRunRecord {
  agentRunId: AgentRunId;
  campaignId: CampaignId;
  batchId?: BatchId;
  agentKey: string;
  displayName?: string;
  parentAgentRunId?: AgentRunId;
  status: AgentRunStatus;
  journeySteps: number[];
  model?: string;
  effort?: string;
  attempt: number;
  workSummary?: string;
  confidence?: string;
  error?: string;
  meta: Record<string, unknown>;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
}

function mapAgentRun(r: Row): AgentRunRecord {
  return {
    agentRunId: String(r.agent_run_id),
    campaignId: String(r.campaign_id),
    batchId: strOrUndef(r.batch_id),
    agentKey: String(r.agent_key),
    displayName: strOrUndef(r.display_name),
    parentAgentRunId: strOrUndef(r.parent_agent_run_id),
    status: String(r.status) as AgentRunStatus,
    journeySteps: (r.journey_steps as number[]) ?? [],
    model: strOrUndef(r.model),
    effort: strOrUndef(r.effort),
    attempt: Number(r.attempt),
    workSummary: strOrUndef(r.work_summary),
    confidence: strOrUndef(r.confidence),
    error: strOrUndef(r.error),
    meta: (r.meta as Record<string, unknown>) ?? {},
    queuedAt: toIso(r.queued_at),
    startedAt: toIsoOrUndef(r.started_at),
    completedAt: toIsoOrUndef(r.completed_at),
  };
}

export interface CreateAgentRunInput {
  agentRunId?: AgentRunId;
  campaignId: CampaignId;
  batchId?: BatchId;
  agentKey: string;
  displayName?: string;
  parentAgentRunId?: AgentRunId;
  status?: AgentRunStatus;
  journeySteps?: number[];
  model?: string;
  effort?: string;
  attempt?: number;
  meta?: Record<string, unknown>;
}

export async function createAgentRun(sql: Db, input: CreateAgentRunInput): Promise<AgentRunId> {
  const id = input.agentRunId ?? newId();
  await sql`
    insert into factory.agent_runs
      (agent_run_id, campaign_id, batch_id, agent_key, display_name, parent_agent_run_id,
       status, journey_steps, model, effort, attempt, meta)
    values
      (${id}, ${input.campaignId}, ${input.batchId ?? null}, ${input.agentKey},
       ${input.displayName ?? null}, ${input.parentAgentRunId ?? null},
       ${input.status ?? "queued"}, ${input.journeySteps ?? []}::int[], ${input.model ?? null},
       ${input.effort ?? null}, ${input.attempt ?? 1}, ${sql.json((input.meta ?? {}) as unknown as JsonInput)})`;
  return id;
}

export interface SetAgentRunStatusOpts {
  workSummary?: string;
  confidence?: string;
  error?: string;
  markStarted?: boolean;
}

export async function setAgentRunStatus(
  sql: Db,
  agentRunId: AgentRunId,
  status: AgentRunStatus,
  opts: SetAgentRunStatusOpts = {},
): Promise<void> {
  const terminal = status === "complete" || status === "partial" || status === "failed";
  await sql`
    update factory.agent_runs
       set status = ${status},
           work_summary = coalesce(${opts.workSummary ?? null}, work_summary),
           confidence = coalesce(${opts.confidence ?? null}, confidence),
           error = ${opts.error ?? null},
           updated_at = now(),
           started_at = ${opts.markStarted || status === "running" ? sql`coalesce(started_at, now())` : sql`started_at`},
           completed_at = ${terminal ? sql`now()` : sql`completed_at`}
     where agent_run_id = ${agentRunId}`;
}

export async function getAgentRun(sql: Db, agentRunId: AgentRunId): Promise<AgentRunRecord | null> {
  const rows = await sql<Row[]>`select * from factory.agent_runs where agent_run_id = ${agentRunId}`;
  return rows.length ? mapAgentRun(rows[0]) : null;
}

export async function listAgentRuns(sql: Db, campaignId: CampaignId): Promise<AgentRunRecord[]> {
  const rows = await sql<Row[]>`
    select * from factory.agent_runs where campaign_id = ${campaignId} order by queued_at asc`;
  return rows.map(mapAgentRun);
}
