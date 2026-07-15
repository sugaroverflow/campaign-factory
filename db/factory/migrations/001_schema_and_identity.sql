-- 001_schema_and_identity.sql
-- Factory schema, migration bookkeeping, and the single environment-identity
-- marker row (ADR 0014, parameters §9). Additive only. Never touches the
-- existing public-schema tables (runs, sessions, spend_ledger, ip_usage).

create schema if not exists factory;

-- Versioned-migration bookkeeping. The runner (worker/src/migrate.ts) also
-- bootstraps this table before reading applied versions, so it is safe whether
-- this migration runs first or the runner created it.
create table if not exists factory.schema_migrations (
  version    text primary key,
  name       text not null,
  applied_at timestamptz not null default now()
);

-- Environment Identity Check marker. Exactly one row (id = 1). The declared
-- FACTORY_ENV_ID is compared against environment_id on every run creation; any
-- mismatch or missing row fails closed (web/src/lib/factory/env-identity.ts).
create table if not exists factory.environment_identity (
  id             smallint primary key default 1,
  environment_id text not null,
  created_at     timestamptz not null default now(),
  constraint environment_identity_singleton check (id = 1)
);
