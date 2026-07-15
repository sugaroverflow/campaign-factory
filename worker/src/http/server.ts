// Worker HTTP surface (contracts/api.ts WORKER_PATHS). All non-SSE endpoints
// require the HMAC signature (timestamp skew ≤ 60s). SSE authenticates via the
// run-scoped stream token ONLY — the service secret is never accepted from a
// browser. /health and /ready are unauthenticated (process/readiness probes).

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config.js";
import { sql } from "../db/pool.js";
import { verifyRequest, verifyStreamToken } from "./signing.js";
import { handleSse } from "./sse.js";
import * as handlers from "./handlers.js";

const RE_EVENTS = /^\/runs\/([^/]+)\/events$/;
const RE_CANCEL = /^\/runs\/([^/]+)\/cancel$/;
const RE_JUDGEMENT = /^\/runs\/([^/]+)\/judgements\/([^/]+)$/;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req: IncomingMessage, limitBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Verify the HMAC over `${ts}.${METHOD}.${path}.${rawBody}`. Returns null if OK,
// else a { status, json } error to send.
function verifySigned(
  req: IncomingMessage,
  path: string,
  rawBody: string,
): { status: number; json: unknown } | null {
  if (!config.signingSecret) {
    return { status: 500, json: { error: "worker misconfigured: FACTORY_SIGNING_SECRET unset" } };
  }
  const result = verifyRequest(
    config.signingSecret,
    req.method ?? "",
    path,
    rawBody,
    header(req, "x-factory-timestamp"),
    header(req, "x-factory-signature"),
  );
  if (!result.ok) return { status: 401, json: { error: `unauthorized: ${result.reason}` } };
  return null;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function parseJson(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-factory-signature, x-factory-timestamp",
    });
    res.end();
    return;
  }

  // ---- Unauthenticated probes ----
  if (method === "GET" && path === "/health") return sendJson(res, ...toArgs(handlers.handleHealth()));
  if (method === "GET" && path === "/ready") return sendJson(res, ...toArgs(await handlers.handleReady()));

  // ---- SSE: run-scoped stream-token auth only ----
  const mEvents = RE_EVENTS.exec(path);
  if (method === "GET" && mEvents) {
    const campaignId = decodeURIComponent(mEvents[1]);
    const token = url.searchParams.get("token") ?? "";
    if (!config.signingSecret) return sendJson(res, 500, { error: "worker misconfigured" });
    const check = verifyStreamToken(config.signingSecret, token, campaignId);
    if (!check.ok) return sendJson(res, 401, { error: `unauthorized: ${check.reason}` });
    const after = resolveAfter(url.searchParams.get("after"), header(req, "last-event-id"));
    handleSse(res, { sql: sql(), campaignId, afterSequence: after });
    return;
  }

  // ---- Signed POST endpoints ----
  if (method === "POST") {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      return sendJson(res, 413, { error: (err as Error).message });
    }
    const sigError = verifySigned(req, path, raw);
    if (sigError) return sendJson(res, sigError.status, sigError.json);

    const body = parseJson(raw);
    if (body === undefined) return sendJson(res, 400, { error: "invalid JSON body" });

    if (path === "/runs") return sendJson(res, ...toArgs(await handlers.handleStartRun(body)));
    if (path === "/batches") return sendJson(res, ...toArgs(await handlers.handleStartBatch(body)));

    // Run-scoped mutations additionally carry the run's stream token (or, for
    // presenter cancels, body `presenter: true`) — enforced in handlers.ts.
    const streamToken = header(req, "x-factory-stream-token");

    const mCancel = RE_CANCEL.exec(path);
    if (mCancel) {
      return sendJson(
        res,
        ...toArgs(await handlers.handleCancel(decodeURIComponent(mCancel[1]), body, streamToken)),
      );
    }

    const mJudge = RE_JUDGEMENT.exec(path);
    if (mJudge) {
      return sendJson(
        res,
        ...toArgs(
          await handlers.handleJudgement(
            decodeURIComponent(mJudge[1]),
            decodeURIComponent(mJudge[2]),
            body,
            streamToken,
          ),
        ),
      );
    }
    return sendJson(res, 404, { error: "not found" });
  }

  sendJson(res, 404, { error: "not found" });
}

function toArgs(r: handlers.HandlerResult): [number, unknown] {
  return [r.status, r.json];
}

function resolveAfter(afterParam: string | null, lastEventId: string | undefined): number {
  const a = afterParam != null ? Number(afterParam) : lastEventId != null ? Number(lastEventId) : 0;
  return Number.isFinite(a) && a >= 0 ? a : 0;
}

export function createHttpServer(): http.Server {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[http] unhandled error:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.end();
    });
  });
}
