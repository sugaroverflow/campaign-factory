// Factory migration runner (parameters §3: versioned SQL migrations replace
// runtime create-table-if-not-exists as the production mechanism).
//
// Reads db/factory/migrations/NNN_name.sql in order, applies each unapplied
// migration inside its own transaction, and records it in
// factory.schema_migrations. Every object created lives inside the `factory`
// schema — this runner never touches the public schema or other schemas.
//
// Run with:  cd worker && npm run migrate
//
// Connection resolution (first defined wins):
//   FACTORY_DATABASE_URL -> DATABASE_URL_UNPOOLED -> DATABASE_URL
// Env is loaded from worker/.env first, then ../web/.env.local (dotenv does not
// override already-set vars, so worker/.env takes precedence).

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", ".."); // worker/src -> repo root
const MIGRATIONS_DIR = join(REPO_ROOT, "db", "factory", "migrations");

function loadEnv(): void {
  const workerEnv = resolve(__dirname, "..", ".env"); // worker/.env
  const webEnv = resolve(REPO_ROOT, "web", ".env.local"); // web/.env.local
  if (existsSync(workerEnv)) dotenv.config({ path: workerEnv });
  if (existsSync(webEnv)) dotenv.config({ path: webEnv });
}

function connectionString(): string {
  const url =
    process.env.FACTORY_DATABASE_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "No database URL. Set FACTORY_DATABASE_URL, DATABASE_URL_UNPOOLED, or DATABASE_URL " +
        "(worker/.env or web/.env.local).",
    );
  }
  return url;
}

function needsSsl(url: string): boolean {
  return /neon\.tech|sslmode=require/.test(url) || process.env.PGSSL === "require";
}

interface MigrationFile {
  version: string; // leading numeric prefix, e.g. "001"
  name: string; // full filename
  path: string;
  sql: string;
}

function listMigrations(): MigrationFile[] {
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => /^\d+/.test(f))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((name) => {
      const version = name.match(/^(\d+)/)![1];
      const path = join(MIGRATIONS_DIR, name);
      return { version, name, path, sql: readFileSync(path, "utf8") };
    });
}

// Apply all unapplied factory migrations. Opens and closes its own pg.Client so
// it is safe to call from the worker boot path (auto-migrate) as well as the
// standalone `npm run migrate` entrypoint.
export async function runMigrations(): Promise<void> {
  loadEnv();
  const url = connectionString();
  const client = new pg.Client({
    connectionString: url,
    ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    // Bootstrap: schema + bookkeeping table must exist before we can read the
    // applied set. Idempotent and identical to what 001 declares.
    await client.query("create schema if not exists factory");
    await client.query(
      `create table if not exists factory.schema_migrations (
         version text primary key,
         name text not null,
         applied_at timestamptz not null default now()
       )`,
    );

    const appliedRes = await client.query<{ version: string }>(
      "select version from factory.schema_migrations",
    );
    const applied = new Set(appliedRes.rows.map((r) => r.version));

    const migrations = listMigrations();
    let count = 0;

    for (const m of migrations) {
      if (applied.has(m.version)) {
        console.log(`= skip ${m.name} (already applied)`);
        continue;
      }
      console.log(`+ apply ${m.name}`);
      try {
        await client.query("BEGIN");
        await client.query(m.sql); // simple protocol: supports multiple statements
        await client.query(
          "insert into factory.schema_migrations (version, name) values ($1, $2)",
          [m.version, m.name],
        );
        await client.query("COMMIT");
        count += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`);
      }
    }

    console.log(
      count === 0
        ? "All factory migrations already applied."
        : `Applied ${count} factory migration(s).`,
    );
  } finally {
    await client.end();
  }
}

// Only run standalone when invoked directly (npm run migrate) — importing this
// module for runMigrations() must not trigger a migration + process.exit.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runMigrations().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
