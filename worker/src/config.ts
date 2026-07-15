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

const modelModeRaw = (str("FACTORY_MODEL_MODE") ?? "mock").toLowerCase();
const modelMode: ModelMode = modelModeRaw === "live" ? "live" : "mock";

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
  databaseUrl: resolveDbUrl(),
  // Declared environment identity; fail-closed check (ADR 0014).
  environmentId: str("FACTORY_ENV_ID") ?? "factory-dev",
  modelMode,
  // Presenter secrets (owned by w5's presenter auth; documented here per api.ts).
  presenterCode: str("CF_PRESENTER_CODE"),
  presenterSpendCeilingUSD: num("CF_PRESENTER_SPEND_CEILING_USD", 35),
  // Live-mode model key. Presence is checked by /ready without spending tokens.
  anthropicApiKey: str("ANTHROPIC_API_KEY"),
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

export function needsSsl(url: string): boolean {
  return /neon\.tech|sslmode=require/.test(url) || (str("PGSSL") ?? "") === "require";
}
