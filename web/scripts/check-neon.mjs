// One-off: verify the DB layer connects to Neon and the schema is creatable.
// Reads DATABASE_URL from .env.local (pulled by `vercel install neon`).
import postgres from "postgres";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
if (!m) throw new Error("DATABASE_URL not found in .env.local");
const url = m[1].trim().replace(/^["']|["']$/g, "");
const needsSsl = /neon\.tech|sslmode=require/.test(url);

const sql = postgres(url, { ssl: needsSsl ? "require" : false });

const v = await sql`select version()`;
console.log("connected:", v[0].version.slice(0, 40), "| ssl:", needsSsl);

await sql`create table if not exists runs (id uuid primary key, status text not null, stages jsonb not null, notes jsonb not null, campaign jsonb not null, cost_usd numeric not null default 0, owner_sid text, shared boolean not null default false, wall_title text, hidden boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
await sql`create table if not exists spend_ledger (day date primary key, usd numeric not null default 0)`;
await sql`create table if not exists sessions (sid text primary key, run_count int not null default 0, updated_at timestamptz not null default now())`;

const [{ count: runs }] = await sql`select count(*)::int as count from runs`;
const [{ count: ledger }] = await sql`select count(*)::int as count from spend_ledger`;
console.log("schema ok — runs:", runs, "ledger rows:", ledger);
await sql.end();
