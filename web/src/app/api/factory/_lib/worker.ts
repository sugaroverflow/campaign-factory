// Shared helpers for the thin factory gate/proxy routes. No business logic
// beyond signing + forwarding + a pooled read client.
//
// Signing scheme mirrors the worker (contracts/api.ts):
//   signature = hex(HMAC_SHA256(secret, `${ts}.${METHOD}.${path}.${body}`))
// The browser NEVER sees the service secret — only the run-scoped stream token
// the worker returns.
//
// The read client is a route-local pooled `postgres` client (interim, pending
// w1-db's factorySql()). It deliberately does NOT use @/lib/db/client, which
// would trigger the legacy create-table migrate() — factory reads must never
// couple to that path.

import crypto from "node:crypto";
import postgres from "postgres";
import {
  SIG_HEADER,
  SIG_TIMESTAMP_HEADER,
} from "@/lib/factory/contracts/api";

export function factoryEnvId(): string {
  return (process.env.FACTORY_ENV_ID || "").trim() || "factory-dev";
}

function workerBaseUrl(): string {
  return (process.env.FACTORY_WORKER_URL || "").trim() || "http://localhost:8787";
}

function signingSecret(): string {
  return (process.env.FACTORY_SIGNING_SECRET || "").trim();
}

export interface ForwardResult {
  status: number;
  body: unknown;
}

// Sign and forward to the worker. `path` is the worker path (e.g. "/runs",
// `/runs/${id}/cancel`) and is part of the signature — it must equal the path
// the worker sees. `bodyObj` undefined ⇒ empty body (signed as "").
// `extraHeaders` ride alongside the signature (e.g. the caller's run-scoped
// stream token, which the worker verifies itself).
export async function forwardSigned(
  method: "POST" | "GET",
  path: string,
  bodyObj?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<ForwardResult> {
  const secret = signingSecret();
  if (!secret) {
    return { status: 500, body: { error: "server misconfigured: FACTORY_SIGNING_SECRET unset" } };
  }
  const body = bodyObj === undefined ? "" : JSON.stringify(bodyObj);
  const ts = Date.now();
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${method.toUpperCase()}.${path}.${body}`)
    .digest("hex");

  try {
    const res = await fetch(`${workerBaseUrl()}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        [SIG_TIMESTAMP_HEADER]: String(ts),
        [SIG_HEADER]: sig,
        ...extraHeaders,
      },
      body: method === "GET" ? undefined : body,
      cache: "no-store",
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    // Log the cause server-side only — internal hostnames/ports must not leak.
    console.error(`factory worker unreachable (${method} ${path}):`, err);
    return {
      status: 502,
      body: { error: "factory worker unreachable" },
    };
  }
}

// Run-scoped stream token presented by the run creator's client, accepted as
// `Authorization: Bearer <token>` or `x-factory-stream-token`. Mutation routes
// require it and forward it to the worker, which verifies it against the run.
export const STREAM_TOKEN_HEADER = "x-factory-stream-token";

export function streamTokenFrom(req: Request): string | undefined {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1].trim()) return m[1].trim();
  const header = (req.headers.get(STREAM_TOKEN_HEADER) || "").trim();
  return header || undefined;
}

let readSql: ReturnType<typeof postgres> | null = null;

// Pooled read client for the polling fallback (RunReadModel). Interim — swap to
// w1-db's factorySql() when reconciling.
export function factoryReadSql(): ReturnType<typeof postgres> {
  if (readSql) return readSql;
  // Same precedence as store/client.ts: preview deployments point factory
  // reads at the factory-dev branch via FACTORY_DATABASE_URL.
  const url = process.env.FACTORY_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const needsSsl = /neon\.tech|sslmode=require/.test(url) || process.env.PGSSL === "require";
  readSql = postgres(url, { ssl: needsSsl ? "require" : false, max: 5, idle_timeout: 20 });
  return readSql;
}

// Parse a single cookie value from a raw Cookie header.
export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}
