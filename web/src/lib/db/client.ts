import postgres from "postgres";

// Portable Postgres client (works against local Docker and Neon alike — Neon
// takes a standard connection string). Singleton across dev hot-reloads to avoid
// exhausting connections.
const url = process.env.DATABASE_URL;

const g = globalThis as unknown as { __cf_sql?: ReturnType<typeof postgres> };

function make() {
  if (!url) throw new Error("DATABASE_URL is not set");
  const needsSsl = /neon\.tech|sslmode=require/.test(url) || process.env.PGSSL === "require";
  return postgres(url, { ssl: needsSsl ? "require" : false, max: 10, idle_timeout: 20 });
}

export const sql = g.__cf_sql ?? (g.__cf_sql = make());

// Idempotent schema. Run once per process before the first query.
let migrated: Promise<void> | null = null;
export function migrate(): Promise<void> {
  return (migrated ??= (async () => {
    await sql`
      create table if not exists runs (
        id uuid primary key,
        status text not null,
        stages jsonb not null,
        notes jsonb not null,
        campaign jsonb not null,
        cost_usd numeric not null default 0,
        owner_sid text,
        shared boolean not null default false,
        wall_title text,
        hidden boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`;
    // idempotent add for DBs created before owner tracking
    await sql`alter table runs add column if not exists owner_sid text`;
    await sql`create index if not exists runs_wall_idx on runs (shared, hidden, updated_at desc)`;
    await sql`
      create table if not exists spend_ledger (
        day date primary key,
        usd numeric not null default 0
      )`;
    await sql`
      create table if not exists sessions (
        sid text primary key,
        run_count int not null default 0,
        updated_at timestamptz not null default now()
      )`;
    await sql`
      create table if not exists ip_usage (
        ip text primary key,
        run_count int not null default 0,
        updated_at timestamptz not null default now()
      )`;
  })());
}
