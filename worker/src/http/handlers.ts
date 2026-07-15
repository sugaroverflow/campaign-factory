// Business handlers for the signed worker API. Transport, signature
// verification, and SSE live in server.ts; these return { status, json }.

import { randomUUID } from "node:crypto";
import { WORKER_PATHS } from "@web/lib/factory/contracts/api.js";
import type {
  StartRunRequest,
  StartBatchRequest,
  JudgementAnswerRequest,
} from "@web/lib/factory/contracts/api.js";
import { RUNTIME_LIMITS } from "@web/lib/factory/contracts/limits.js";
import { config } from "../config.js";
import { sql } from "../db/pool.js";
import { mintStreamToken } from "./signing.js";
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

  const s = sql();
  const campaignId = await store.createRun(s, {
    environmentId: config.environmentId,
    mode: b.mode,
    problem: b.intake.problem.trim(),
    place: b.intake.place.trim(),
    status: "queued",
  });
  await store.appendEvent(s, {
    campaignId,
    type: "run.queued",
    visibility: "public",
    payload: { summary: "Run queued" },
  });
  await enqueueRun({ campaignId });

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
    });
    await store.appendEvent(s, {
      campaignId,
      batchId,
      type: "run.queued",
      visibility: "public",
      payload: { summary: "Run queued (presenter batch)" },
    });
    await enqueueRun({ campaignId, batchId });
    const { streamToken, streamUrl } = streamUrlFor(campaignId);
    campaigns.push({ campaignId, streamToken, streamUrl });
  }
  return { status: 202, json: { batchId, campaigns } };
}

// POST /runs/:id/cancel
export async function handleCancel(campaignId: string): Promise<HandlerResult> {
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

// POST /runs/:id/judgements/:jid
export async function handleJudgement(
  campaignId: string,
  judgementId: string,
  body: unknown,
): Promise<HandlerResult> {
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
