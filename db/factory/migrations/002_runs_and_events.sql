-- 002_runs_and_events.sql
-- Batches, per-campaign runs, agent runs, and the append-only Factory Event
-- log (parameters §3 "State and provenance storage", §4 "Factory Event
-- parameters"). One campaign == one run, keyed by campaign_id.
--
-- Column names are reconciled with the W2 worker seam so both the store
-- functions and any transitional raw SQL address the same shape. Foreign keys
-- are kept minimal (only runs.batch_id -> batches) to avoid insert-ordering
-- coupling between parallel workstreams; the rest are plain uuid columns.

-- Presenter batch (1–5 campaigns) or a synthetic single-campaign holder.
create table if not exists factory.factory_batches (
  batch_id       uuid primary key,
  environment_id text not null,
  mode           text not null default 'presenter',      -- 'public' | 'presenter'
  status         text not null,                           -- RunStatus
  size           integer not null default 0,              -- number of campaigns
  receipt        jsonb,                                   -- batch receipt payload when produced
  meta           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);

-- One row per campaign run. state_version and last_sequence are the durable
-- cursors read by the polling fallback (RunReadModel) and SSE resume.
-- last_sequence is the authoritative per-campaign event counter (see
-- appendEvent): UPDATE ... last_sequence = last_sequence + 1 RETURNING under
-- the row lock serialises sequence allocation per campaign.
create table if not exists factory.factory_runs (
  campaign_id    uuid primary key,
  batch_id       uuid references factory.factory_batches(batch_id),
  environment_id text not null,
  mode           text not null,                           -- 'public' | 'presenter'
  status         text not null,                           -- RunStatus
  problem        text not null,
  place          text not null,
  state_version  integer not null default 0,
  last_sequence  bigint not null default 0,
  cost_usd       numeric not null default 0,
  error          text,
  meta           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz
);

create index if not exists factory_runs_batch_idx on factory.factory_runs (batch_id);
create index if not exists factory_runs_status_idx on factory.factory_runs (status);
create index if not exists factory_runs_cleanup_idx on factory.factory_runs (completed_at);

-- One row per invoked Runtime Agent (durable agent identity, ADR 0004).
create table if not exists factory.agent_runs (
  agent_run_id        uuid primary key,
  campaign_id         uuid not null,
  batch_id            uuid,
  agent_key           text not null,                      -- roster key
  display_name        text,
  parent_agent_run_id uuid,
  status              text not null,                      -- AgentRunStatus
  journey_steps       integer[] not null default '{}',    -- steps this agent serves
  model               text,
  effort              text,
  attempt             integer not null default 1,
  work_summary        text,
  confidence          text,
  error               text,
  meta                jsonb not null default '{}'::jsonb,
  queued_at           timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists agent_runs_campaign_idx on factory.agent_runs (campaign_id);
create index if not exists agent_runs_batch_idx on factory.agent_runs (batch_id);

-- Append-only semantic Factory Events. `sequence` is monotonic per campaign and
-- is the SSE reconnection cursor. payload is jsonb with no size assumptions —
-- acceptance/judgement/document/receipt events carry full content in
-- payload.detail (a few KB is expected). Raw provider data is never stored.
create table if not exists factory.factory_events (
  event_id            uuid primary key,
  campaign_id         uuid not null,
  sequence            bigint not null,
  batch_id            uuid,
  agent_run_id        uuid,
  parent_agent_run_id uuid,
  journey_step        integer,                            -- 1–10
  type                text not null,                      -- FactoryEventType
  at                  timestamptz not null,               -- semantic event time
  state_version       integer,
  visibility          text not null,                      -- 'public' | 'internal'
  payload             jsonb not null,
  created_at          timestamptz not null default now(), -- wall-clock, for retention cleanup
  constraint factory_events_campaign_sequence_uniq unique (campaign_id, sequence)
);

-- Read path: ordered per-campaign history (the unique constraint already
-- provides the (campaign_id, sequence) btree used by full-history and resume
-- reads; this partial index optimises the public late-joiner / replay scan).
create index if not exists factory_events_public_idx
  on factory.factory_events (campaign_id, sequence)
  where visibility = 'public';

-- Wall-clock cleanup (retention: non-promoted events 30d after terminal state).
create index if not exists factory_events_cleanup_idx on factory.factory_events (created_at);
