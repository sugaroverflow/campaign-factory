// Worker store barrel. The factory persistence layer is OWNED by w1-db
// (web/src/lib/factory/store/** + state/reducer.ts, schema in
// db/factory/migrations). The worker injects its own DIRECT/unpooled `sql`
// client into these functions. This barrel re-exports exactly what the worker
// runtime uses, plus worker-only helpers (environment-identity assertion and
// cheap readiness probes) that have no web-side equivalent yet.

export {
  createBatch,
  getBatch,
  setBatchStatus,
  setBatchReceipt,
  createRun,
  getRun,
  listRunsByBatch,
  setRunStatus,
  setRunStateVersion,
  setRunCost,
  getRunReadModel,
  type RunRecord,
  type BatchRecord,
  type CreateRunInput,
  type CreateBatchInput,
  type SetRunStatusOpts,
} from "@web/lib/factory/store/runs.js";

export {
  appendEvent,
  readEvents,
  latestSequence,
  NOTIFY_CHANNEL,
  notifyPayload,
  type AppendEventInput,
} from "@web/lib/factory/store/events.js";

export {
  createAgentRun,
  setAgentRunStatus,
  getAgentRun,
  listAgentRuns,
  type CreateAgentRunInput,
  type SetAgentRunStatusOpts,
  type AgentRunRecord,
} from "@web/lib/factory/store/agent-runs.js";

export {
  recordSource,
  getSources,
  recordRetrieval,
  upsertClaim,
  getClaims,
  linkClaimEvidence,
  type SourceInput as StoreSourceInput,
  type ClaimInput,
} from "@web/lib/factory/store/evidence.js";

export {
  saveStateVersion,
  loadLatestState,
  loadStateVersion,
  getAcceptedState,
  type SaveStateVersionInput,
} from "@web/lib/factory/store/state-versions.js";

export {
  insertJudgement,
  getJudgement,
  listJudgements,
  resolveJudgement,
  type JudgementInput,
  type ResolveJudgementInput,
} from "@web/lib/factory/store/judgements.js";

export {
  appendCost,
  campaignCostTotal,
  batchCostTotal,
  campaignCostBreakdown,
  type CostEntry,
} from "@web/lib/factory/store/ledger.js";

export {
  saveDocumentVersion,
  type SaveDocumentVersionInput,
} from "@web/lib/factory/store/documents.js";

export {
  emptyCampaignState,
  applyProposal,
  resolveEvidenceRefs,
} from "@web/lib/factory/state/reducer.js";

// Environment Identity Check (ADR 0014) — w1-db's authoritative fail-closed
// implementation. assertEnvironmentIdentity reads FACTORY_ENV_ID from env.
export {
  assertEnvironmentIdentity,
  seedEnvironmentIdentity,
  getEnvironmentIdentity,
} from "@web/lib/factory/env-identity.js";

// ---- Worker-only readiness probes ----

import type { Sql } from "../db/pool.js";
import { FACTORY_SCHEMA } from "@web/lib/factory/contracts/tables.js";

export async function pingDb(sql: Sql): Promise<void> {
  await sql`select 1`;
}
export async function factorySchemaReady(sql: Sql): Promise<boolean> {
  const rows = await sql<{ reg: string | null }[]>`select to_regclass(${`${FACTORY_SCHEMA}.factory_events`}) as reg`;
  return rows[0]?.reg != null;
}
export async function checkpointSchemaReady(sql: Sql): Promise<boolean> {
  const rows = await sql<{ reg: string | null }[]>`select to_regclass('lg.checkpoints') as reg`;
  return rows[0]?.reg != null;
}
export async function queueSchemaReady(sql: Sql): Promise<boolean> {
  const rows = await sql<{ reg: string | null }[]>`select to_regclass('pgboss.job') as reg`;
  return rows[0]?.reg != null;
}
