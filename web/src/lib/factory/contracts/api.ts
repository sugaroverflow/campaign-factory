// Web ↔ worker boundary (ADR 0015/0016): signed start/status/judgement/cancel
// plus a reconnectable run-scoped SSE stream. The browser never receives the
// service credential — only a short-lived run-scoped stream token.

import type { BatchId, CampaignId, FactoryEvent, JudgementId, RunStatus } from "./core";

// ---- Environment / configuration names ----

export const ENV = {
  // shared secret for HMAC signing between web and worker
  signingSecret: "FACTORY_SIGNING_SECRET",
  // worker base URL as seen from the web app (server side)
  workerUrl: "FACTORY_WORKER_URL",
  // worker base URL as seen from the browser (SSE); often same as workerUrl
  publicWorkerUrl: "NEXT_PUBLIC_FACTORY_WORKER_URL",
  // direct (unpooled) Postgres URL for the worker; falls back to DATABASE_URL_UNPOOLED
  workerDatabaseUrl: "FACTORY_DATABASE_URL",
  // declared environment identity, e.g. "factory-dev" — fail-closed check (ADR 0014)
  environmentId: "FACTORY_ENV_ID",
  // "mock" (fixture-driven, zero model calls) or "live"
  modelMode: "FACTORY_MODEL_MODE",
  // presenter code, server-side only (ADR 0013)
  presenterCode: "CF_PRESENTER_CODE",
  presenterSpendCeilingUSD: "CF_PRESENTER_SPEND_CEILING_USD",
} as const;

export type ModelMode = "mock" | "live";

// ---- Signing scheme ----
// signature = hex(HMAC_SHA256(secret, `${timestamp}.${method}.${path}.${body}`))
// Reject if |now - timestamp| > 60s. Headers:
export const SIG_HEADER = "x-factory-signature";
export const SIG_TIMESTAMP_HEADER = "x-factory-timestamp";

// Stream tokens (browser → worker SSE): token = `${runId}.${exp}.${hex(HMAC(secret, `${runId}.${exp}`))}`
export const STREAM_TOKEN_TTL_MS = 15 * 60000;

// ---- Worker HTTP surface ----
// POST   /runs                     start one public campaign run
// POST   /batches                  start a presenter batch (1–5 campaigns)
// POST   /runs/:campaignId/cancel
// POST   /runs/:campaignId/judgements/:judgementId   answer/defer a judgement
// GET    /runs/:campaignId/events?after=<seq>&token=<streamToken>   SSE
// GET    /health                   process + config only
// GET    /ready                    DB, queue, checkpoint schema, model config
export const WORKER_PATHS = {
  startRun: "/runs",
  startBatch: "/batches",
  cancel: (id: CampaignId) => `/runs/${id}/cancel`,
  judgement: (id: CampaignId, j: JudgementId) => `/runs/${id}/judgements/${j}`,
  events: (id: CampaignId) => `/runs/${id}/events`,
  health: "/health",
  ready: "/ready",
} as const;

// ---- Payloads ----

export interface CampaignIntake {
  problem: string;
  place: string; // required; no run accepts a blank/ambiguous place
}

export interface StartRunRequest {
  intake: CampaignIntake;
  mode: "public" | "presenter";
  environmentId: string; // must match worker's declared FACTORY_ENV_ID
}

export interface StartBatchRequest {
  intakes: CampaignIntake[]; // length 1–5; a sixth is rejected, not queued
  environmentId: string;
}

export interface StartRunResponse {
  campaignId: CampaignId;
  batchId?: BatchId;
  streamToken: string;
  streamUrl: string; // absolute SSE URL including token + after
}

export interface StartBatchResponse {
  batchId: BatchId;
  campaigns: Array<{ campaignId: CampaignId; streamToken: string; streamUrl: string }>;
}

export interface JudgementAnswerRequest {
  action: "answer" | "defer" | "accept_default";
  answer?: string;
}

// Read model served by the web app's polling fallback (from Postgres, pooled).
export interface RunReadModel {
  campaignId: CampaignId;
  batchId?: BatchId;
  status: RunStatus;
  stateVersion: number;
  lastSequence: number;
  events: FactoryEvent[]; // public visibility only, since `after`
}

// SSE protocol: event name "factory", id = sequence, data = FactoryEvent JSON
// (public visibility only). Heartbeat comment every 15s. Reconnect with
// Last-Event-ID or ?after=<sequence>.
export const SSE_EVENT_NAME = "factory";
export const SSE_HEARTBEAT_MS = 15000;

// Replay (ADR 0001): fixed public backup route; label is permanent.
export const REPLAY_ROUTE = "/factory/replay/conference";
export const replayLabel = (isoDate: string) => `Recorded real run · ${isoDate.slice(0, 10)}`;
