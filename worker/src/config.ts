// Worker configuration and environment loading.
//
// Env file precedence (per W2 brief): worker/.env wins, then ../web/.env.local
// fills gaps. Real process.env (Railway) wins over both because dotenv never
// overrides an already-set variable.
//
// DB URL resolution (direct/unpooled — the worker needs a session connection
// for LISTEN and pg-boss/PostgresSaver):
//   FACTORY_DATABASE_URL → DATABASE_URL_UNPOOLED → DATABASE_URL
//
// ENV names are the contract in web/src/lib/factory/contracts/api.ts.

import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { COST_GUARDS } from "@web/lib/factory/contracts/limits.js";

// worker/src/config.ts → dirname = worker/src → resolve(..) = worker/
const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // .../worker

// worker/.env first (wins), then ../web/.env.local (fills gaps). Neither
// overrides variables already present in the real environment.
dotenv.config({ path: path.join(WORKER_DIR, ".env") });
dotenv.config({ path: path.join(WORKER_DIR, "..", "web", ".env.local") });

function str(name: string): string | undefined {
  const v = process.env[name];
  return v != null && v.trim() !== "" ? v.trim() : undefined;
}
function num(name: string, fallback: number): number {
  const v = str(name);
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function bool(name: string, fallback: boolean): boolean {
  const v = str(name);
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export type ModelMode = "mock" | "live";

function resolveDbUrl(): string | undefined {
  return str("FACTORY_DATABASE_URL") ?? str("DATABASE_URL_UNPOOLED") ?? str("DATABASE_URL");
}

// Fail-loud (C2): a typo or unset FACTORY_MODEL_MODE must never silently select
// mock — that shipped a live show against the mock executor. Accept exactly
// "live" or "mock"; anything else crashes at boot.
const modelModeRaw = str("FACTORY_MODEL_MODE")?.toLowerCase();
if (modelModeRaw !== "live" && modelModeRaw !== "mock") {
  throw new Error(
    `FACTORY_MODEL_MODE must be exactly "live" or "mock" (got ${
      modelModeRaw === undefined ? "unset" : JSON.stringify(modelModeRaw)
    }).`,
  );
}
const modelMode: ModelMode = modelModeRaw;

const port = num("PORT", 8787);

// Browser-facing base URL used to build SSE stream URLs handed back to clients.
const publicWorkerUrl =
  str("NEXT_PUBLIC_FACTORY_WORKER_URL") ?? str("FACTORY_WORKER_URL") ?? `http://localhost:${port}`;

export const config = {
  port,
  // HMAC service secret shared with the web app for signed endpoints.
  signingSecret: str("FACTORY_SIGNING_SECRET"),
  // Worker base URL as seen from the web app (server-side).
  workerUrl: str("FACTORY_WORKER_URL") ?? `http://localhost:${port}`,
  // Browser-facing base URL for SSE (may equal workerUrl).
  publicWorkerUrl,
  // Browser origins allowed to open the cross-origin SSE stream (site on
  // vercel.app → worker on railway.app). Comma-separated allowlist. UNSET →
  // wildcard "*" (prior behavior: any origin may open a stream, which is still
  // gated by the run-scoped stream token). When set, only listed origins are
  // reflected back.
  corsOrigins: (str("FACTORY_CORS_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl: resolveDbUrl(),
  // Declared environment identity; fail-closed check (ADR 0014).
  environmentId: str("FACTORY_ENV_ID") ?? "factory-dev",
  modelMode,
  // Presenter secrets (owned by w5's presenter auth; documented here per api.ts).
  presenterCode: str("CF_PRESENTER_CODE"),
  // Defaults from the one authoritative batch ceiling in contracts/limits.ts;
  // the env var remains an operational override.
  presenterSpendCeilingUSD: num("CF_PRESENTER_SPEND_CEILING_USD", COST_GUARDS.presenterBatchHardStopUSD),
  // Live-mode model key. Presence is checked by /ready without spending tokens.
  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  // Secret sealing visitors' BYOK Anthropic keys at rest (worker/src/byok.ts).
  // Unset ⇒ the worker rejects runs that carry a key rather than store plaintext.
  byokSecret: str("FACTORY_BYOK_SECRET"),
  // Apply w1-db's db/factory/migrations on boot (dev convenience). In a managed
  // deploy, run `npm run migrate` in the release step and set this to 0.
  autoMigrate: bool("FACTORY_AUTO_MIGRATE", true),
  // postgres.js pool ceiling for the worker's own store/LISTEN connections.
  dbPoolMax: num("FACTORY_DB_POOL_MAX", 5),
} as const;

// w1-db's assertEnvironmentIdentity reads FACTORY_ENV_ID from process.env
// directly. Reflect the resolved value (including the factory-dev default) back
// so the boot-time seed + assert agree with config.environmentId.
if (!process.env.FACTORY_ENV_ID) process.env.FACTORY_ENV_ID = config.environmentId;

export function requireDatabaseUrl(): string {
  if (!config.databaseUrl) {
    throw new Error(
      "No worker database URL. Set FACTORY_DATABASE_URL, DATABASE_URL_UNPOOLED, or DATABASE_URL.",
    );
  }
  return config.databaseUrl;
}

// Re-exported so existing worker imports keep working; the predicate itself
// lives with the other DB plumbing in the shared web lib.
export { needsSsl } from "@web/lib/db/ssl.js";
