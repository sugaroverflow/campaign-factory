// Lazy singleton `postgres` client for WEB use (pooled Vercel connection).
// Same conventions as web/src/lib/db/client.ts, but WITHOUT the legacy
// runtime migrate() — the factory schema is owned by versioned SQL migrations
// (db/factory/migrations, applied via worker/src/migrate.ts).
//
// The worker does NOT use this; it injects its own direct/unpooled client into
// the store functions (all of which take a `Db` as first argument).

import postgres from "postgres";
import type { Db } from "./types";

const g = globalThis as unknown as { __cf_factory_sql?: Db };

function make(): Db {
  // FACTORY_DATABASE_URL lets a preview deployment point factory reads at the
  // factory-dev Neon branch without overriding the platform-managed
  // DATABASE_URL (ADR 0014: no cross-environment fallback the other way).
  const url = process.env.FACTORY_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const needsSsl = /neon\.tech|sslmode=require/.test(url) || process.env.PGSSL === "require";
  return postgres(url, { ssl: needsSsl ? "require" : false, max: 10, idle_timeout: 20 });
}

/** Pooled factory client for web request/response reads and writes. */
export function factorySql(): Db {
  return (g.__cf_factory_sql ??= make());
}
