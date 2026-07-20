// Business handlers for the signed worker API. Transport, signature
// verification, and SSE live in server.ts; these return { status, json }.

import { randomUUID } from "node:crypto";
import { WORKER_PATHS } from "@web/lib/factory/contracts/api.js";
import type {
  StartRunRequest,
  StartBatchRequest,
  JudgementAnswerRequest,
  RunProfile,
} from "@web/lib/factory/contracts/api.js";
import { RUNTIME_LIMITS } from "@web/lib/factory/contracts/limits.js";
import { config } from "../config.js";
import { byokEnabled, sealByok } from "../byok.js";
import { sql } from "../db/pool.js";
import { mintStreamToken, verifyStreamToken } from "./signing.js";
import { enqueueRun, cancelQueuedRun } from "../queue/boss.js";
import { gate } from "../gate.js";
import { transportMode } from "../events/hub.js";
import { abortRun } from "../runtime/registry.js";
import * as store from "../store/index.js";

export interface HandlerResult {
  status: number;
  json: unknown;
}

function bad(status: number, error: string, extra?: Record<string, unknown>): HandlerResult {
  return { status, json: { error, ...extra } };
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function streamUrlFor(campaignId: string): { streamToken: string; streamUrl: string } {
  const streamToken = mintStreamToken(config.signingSecret ?? "", campaignId);
  const streamUrl = `${config.publicWorkerUrl}${WORKER_PATHS.events(campaignId)}?after=0&token=${encodeURIComponent(streamToken)}`;
  return { streamToken, streamUrl };
}

// POST /runs
export async function handleStartRun(body: unknown): Promise<HandlerResult> {
  const b = body as Partial<StartRunRequest>;
  if (!b || (b.mode !== "public" && b.mode !== "presenter")) {
    return bad(400, "mode must be 'public' or 'presenter'");
  }
  if (b.environmentId !== config.environmentId) {
    return bad(400, `environment mismatch: expected '${config.environmentId}'`);
  }
  if (!b.intake || !nonEmpty(b.intake.problem) || !nonEmpty(b.intake.place)) {
    return bad(400, "intake.problem and intake.place are both required and must be non-empty");
  }
  // Enum-validated run profile; absent → "full".
  if (b.profile !== undefined && b.profile !== "full" && b.profile !== "express") {
    return bad(400, "profile must be 'full' or 'express'");
  }
  const profile: RunProfile = b.profile ?? "full";

  // BYOK: seal the visitor's key before it touches the database. Policy (the
  // key being REQUIRED for non-admin public runs) lives in the web gate; the
  // worker's job is to never store or log the plaintext. byokRun and
  // byokProvider survive the terminal strip — spend accounting reads the
  // former, client construction the latter.
  let byokMeta: Record<string, unknown> = {};
  const rawByokKey =
    typeof b.byokKey === "string" && b.byokKey.trim() !== ""
      ? b.byokKey.trim()
      : typeof b.byokAnthropicKey === "string" && b.byokAnthropicKey.trim() !== ""
        ? b.byokAnthropicKey.trim() // legacy field: always an Anthropic key
        : undefined;
  if (rawByokKey) {
    const provider = b.byokProvider === "openrouter" ? "openrouter" : "anthropic";
    const prefixOk = provider === "openrouter" ? /^sk-or-/.test(rawByokKey) : /^sk-ant-/.test(rawByokKey);
    if (!prefixOk) {
      return bad(400, `byok key does not match the declared provider (${provider})`);
    }
    if (!byokEnabled()) {
      return bad(503, "BYOK is not configured on this worker (FACTORY_BYOK_SECRET unset)");
    }
    byokMeta = { byokRun: true, byokProvider: provider, byok: sealByok(rawByokKey) };
  }

  const s = sql();
  const campaignId = await store.createRun(s, {
    environmentId: config.environmentId,
    mode: b.mode,
    problem: b.intake.problem.trim(),
    place: b.intake.place.trim(),
    status: "queued",
    // Durable: orphan-recovery re-enqueues carry no job data, so the runner
    // falls back to run.meta.profile.
    meta: { profile, ...byokMeta },
  });
  await store.appendEvent(s, {
    campaignId,
    type: "run.queued",
    visibility: "public",
    payload: { summary: `Run queued (${profile})`, detail: { profile } },
  });
  await enqueueRun({ campaignId, profile });

  const { streamToken, streamUrl } = streamUrlFor(campaignId);
  return { status: 202, json: { campaignId, streamToken, streamUrl } };
}

// POST /batches  (1–5 intakes; a 6th is rejected, not queued)
export async function handleStartBatch(body: unknown): Promise<HandlerResult> {
  const b = body as Partial<StartBatchRequest>;
  if (b?.environmentId !== config.environmentId) {
    return bad(400, `environment mismatch: expected '${config.environmentId}'`);
  }
  const intakes = Array.isArray(b?.intakes) ? b.intakes : [];
  const max = RUNTIME_LIMITS.campaignsPerPresenterBatch;
  if (intakes.length < 1 || intakes.length > max) {
    return bad(
      400,
      `A presenter batch accepts 1–${max} campaigns; received ${intakes.length}. The sixth is rejected, not queued.`,
    );
  }
  for (const [i, intake] of intakes.entries()) {
    if (!nonEmpty(intake?.problem) || !nonEmpty(intake?.place)) {
      return bad(400, `intake[${i}] requires non-empty problem and place`);
    }
  }
  const profile = b.profile ?? "full";
  if (profile !== "full" && profile !== "express") {
    return bad(400, `unknown profile '${String(b.profile)}'`);
  }

  const s = sql();
  const batchId = await store.createBatch(s, {
    environmentId: config.environmentId,
    mode: "presenter",
    status: "queued",
    size: intakes.length,
  });

  const campaigns: Array<{ campaignId: string; streamToken: string; streamUrl: string }> = [];
  for (const intake of intakes) {
    const campaignId = await store.createRun(s, {
      batchId,
      environmentId: config.environmentId,
      mode: "presenter",
      problem: intake.problem.trim(),
      place: intake.place.trim(),
      status: "queued",
      meta: { profile },
    });
    await store.appendEvent(s, {
      campaignId,
      batchId,
      type: "run.queued",
      visibility: "public",
      payload: { summary: "Run queued (presenter batch)", detail: { profile } },
    });
    await enqueueRun({ campaignId, batchId, profile });
    const { streamToken, streamUrl } = streamUrlFor(campaignId);
    campaigns.push({ campaignId, streamToken, streamUrl });
  }
  return { status: 202, json: { batchId, campaigns } };
}

// Run-scoped auth for mutations (cancel, judgement resolve). The web signature
// only proves the request came through the web app; these two mutate a
// SPECIFIC run, so the caller must also present that run's stream token
// (header `x-factory-stream-token`, forwarded by the web route). Returns null
// when authorised, else the 401/500 to send.
function requireRunToken(campaignId: string, streamToken: string | undefined): HandlerResult | null {
  if (!config.signingSecret) {
    return bad(500, "worker misconfigured: FACTORY_SIGNING_SECRET unset");
  }
  if (!nonEmpty(streamToken)) return bad(401, "unauthorized: missing stream token");
  const check = verifyStreamToken(config.signingSecret, streamToken, campaignId);
  if (!check.ok) return bad(401, `unauthorized: ${check.reason}`);
  return null;
}

// POST /runs/:id/cancel — requires the run's stream token, OR body
// `presenter: true` on the signed request (the web route sets that flag only
// after its own presenter-cookie check; the browser never signs requests).
export async function handleCancel(
  campaignId: string,
  body: unknown,
  streamToken: string | undefined,
): Promise<HandlerResult> {
  const presenter = (body as { presenter?: unknown } | undefined)?.presenter === true;
  if (!presenter) {
    const denied = requireRunToken(campaignId, streamToken);
    if (denied) return denied;
  }
  const s = sql();
  const run = await store.getRun(s, campaignId);
  if (!run) return bad(404, "unknown campaign");
  if (run.status === "completed" || run.status === "partial" || run.status === "failed") {
    return { status: 200, json: { campaignId, status: run.status, note: "already terminal" } };
  }
  // Durable cancel signal (graph guard reads this) + in-flight abort. The graph
  // finalise node is the single writer of run.cancelled. Best-effort: also
  // cancel a still-queued job so it is not pointlessly picked up.
  await store.setRunStatus(s, campaignId, "cancelled");
  abortRun(campaignId);
  await cancelQueuedRun(campaignId);
  return { status: 202, json: { campaignId, status: "cancelled" } };
}

// POST /runs/:id/judgements/:jid — requires the run's stream token.
export async function handleJudgement(
  campaignId: string,
  judgementId: string,
  body: unknown,
  streamToken: string | undefined,
): Promise<HandlerResult> {
  const denied = requireRunToken(campaignId, streamToken);
  if (denied) return denied;
  const b = (body ?? {}) as Partial<JudgementAnswerRequest>;
  const s = sql();
  const j = await store.getJudgement(s, judgementId);
  if (!j || j.campaignId !== campaignId) return bad(404, "unknown judgement");

  if (b.action === "defer") {
    return { status: 200, json: { ok: true, judgementId, status: j.status } };
  }
  const answer = b.action === "accept_default" ? j.provisionalDefault : b.answer;
  if (b.action === "answer" && !nonEmpty(answer)) {
    return bad(400, "answer is required for action 'answer'");
  }
  await store.resolveJudgement(s, judgementId, { status: "resolved", answer: answer ?? undefined });
  await store.appendEvent(s, {
    campaignId,
    type: "judgement.resolved",
    visibility: "public",
    payload: {
      summary: `Judgement resolved${answer ? `: ${answer}` : ""}`,
      judgementId,
      detail: { judgementId, answer },
    },
  });
  return { status: 200, json: { ok: true, judgementId, status: "resolved", answer } };
}

// GET /health — process + config only, no DB.
export function handleHealth(): HandlerResult {
  return {
    status: 200,
    json: {
      status: "ok",
      environmentId: config.environmentId,
      modelMode: config.modelMode,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      eventTransport: transportMode(),
      gate: gate.snapshot(),
    },
  };
}

// GET /ready — DB, queue, checkpoint schema, model config; no token spend.
export async function handleReady(): Promise<HandlerResult> {
  const checks: Record<string, boolean> = {
    signingSecret: Boolean(config.signingSecret),
    databaseUrl: Boolean(config.databaseUrl),
    modelConfig: config.modelMode === "mock" ? true : Boolean(config.anthropicApiKey),
  };
  const s = sql();
  try {
    await store.pingDb(s);
    checks.database = true;
    checks.factorySchema = await store.factorySchemaReady(s);
    checks.checkpointSchema = await store.checkpointSchemaReady(s);
    checks.queueSchema = await store.queueSchemaReady(s);
  } catch (err) {
    checks.database = false;
    return { status: 503, json: { ready: false, checks, error: (err as Error).message } };
  }
  const ready = Object.values(checks).every(Boolean);
  return { status: ready ? 200 : 503, json: { ready, checks } };
}
