// Append-only cost & latency ledger, with per-campaign and per-batch totals.

import type { AgentRunId, BatchId, CampaignId } from "../contracts/core";
import type { Db, JsonInput } from "./types";

export interface CostEntry {
  campaignId?: CampaignId;
  batchId?: BatchId;
  agentRunId?: AgentRunId;
  model?: string;
  kind?: string; // 'model_call' | 'search' | ...
  inputTokens?: number;
  outputTokens?: number;
  searchCount?: number;
  costUsd: number;
  latencyMs?: number;
  meta?: Record<string, unknown>;
}

export async function appendCost(sql: Db, entry: CostEntry): Promise<void> {
  await sql`
    insert into factory.cost_ledger
      (campaign_id, batch_id, agent_run_id, model, kind, input_tokens, output_tokens,
       search_count, cost_usd, latency_ms, meta)
    values
      (${entry.campaignId ?? null}, ${entry.batchId ?? null}, ${entry.agentRunId ?? null},
       ${entry.model ?? null}, ${entry.kind ?? "model_call"}, ${entry.inputTokens ?? null},
       ${entry.outputTokens ?? null}, ${entry.searchCount ?? null}, ${entry.costUsd},
       ${entry.latencyMs ?? null}, ${sql.json((entry.meta ?? {}) as unknown as JsonInput)})`;
}

export async function campaignCostTotal(sql: Db, campaignId: CampaignId): Promise<number> {
  const rows = await sql<{ total: string }[]>`
    select coalesce(sum(cost_usd), 0) as total from factory.cost_ledger where campaign_id = ${campaignId}`;
  return Number(rows[0]?.total ?? 0);
}

export async function batchCostTotal(sql: Db, batchId: BatchId): Promise<number> {
  const rows = await sql<{ total: string }[]>`
    select coalesce(sum(cost_usd), 0) as total from factory.cost_ledger where batch_id = ${batchId}`;
  return Number(rows[0]?.total ?? 0);
}

export interface CostBreakdown {
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSearches: number;
  entries: number;
}

export async function campaignCostBreakdown(sql: Db, campaignId: CampaignId): Promise<CostBreakdown> {
  const rows = await sql<
    { total: string; inp: string; out: string; searches: string; n: string }[]
  >`
    select coalesce(sum(cost_usd), 0) as total,
           coalesce(sum(input_tokens), 0) as inp,
           coalesce(sum(output_tokens), 0) as out,
           coalesce(sum(search_count), 0) as searches,
           count(*) as n
      from factory.cost_ledger
     where campaign_id = ${campaignId}`;
  const r = rows[0];
  return {
    totalUsd: Number(r?.total ?? 0),
    totalInputTokens: Number(r?.inp ?? 0),
    totalOutputTokens: Number(r?.out ?? 0),
    totalSearches: Number(r?.searches ?? 0),
    entries: Number(r?.n ?? 0),
  };
}
