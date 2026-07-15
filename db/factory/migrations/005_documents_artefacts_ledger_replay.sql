-- 005_documents_artefacts_ledger_replay.sql
-- Versioned compiled documents, generic artefacts (agent handoffs / bounded
-- context refs), the cost & latency ledger, and replay manifests
-- (parameters §3, §5; ADR 0001, ADR 0007).

-- Versioned Canonical Document renders. Docs 1–6 carry compiled html; packs
-- 7–9 carry resources jsonb (PackResource[]). Load latest by
-- (campaign_id, document_key, version desc).
create table if not exists factory.document_versions (
  id            uuid primary key,
  campaign_id   uuid not null,
  document_key  text not null,                     -- CanonicalDocumentKey
  version       integer not null,
  status        text not null,                     -- DocumentStatus (exact product strings)
  html          text,
  resources     jsonb,                             -- PackResource[] for packs 7–9
  state_version integer,                            -- campaign state version compiled from
  created_at    timestamptz not null default now(),
  constraint document_versions_uniq unique (campaign_id, document_key, version)
);

create index if not exists document_versions_latest_idx
  on factory.document_versions (campaign_id, document_key, version desc);

-- Generic artefact store: agent handoffs and bounded context extracts keyed by
-- a stable ref (contextRefs/evidenceRefs resolution for agent envelopes).
create table if not exists factory.artefacts (
  id           uuid primary key,
  campaign_id  uuid not null,
  agent_run_id uuid,
  kind         text not null,                      -- e.g. 'handoff' | 'context_extract'
  ref          text not null,                      -- stable reference string
  title        text,
  content      jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint artefacts_campaign_ref_uniq unique (campaign_id, ref)
);

create index if not exists artefacts_campaign_idx on factory.artefacts (campaign_id);

-- Append-only cost & latency ledger. Per-campaign and per-batch totals are
-- aggregates over this table.
create table if not exists factory.cost_ledger (
  id            bigint generated always as identity primary key,
  campaign_id   uuid,
  batch_id      uuid,
  agent_run_id  uuid,
  model         text,
  kind          text not null default 'model_call',  -- 'model_call' | 'search' | ...
  input_tokens  integer,
  output_tokens integer,
  search_count  integer,
  cost_usd      numeric not null default 0,
  latency_ms    integer,
  meta          jsonb not null default '{}'::jsonb,
  at            timestamptz not null default now()
);

create index if not exists cost_ledger_campaign_idx on factory.cost_ledger (campaign_id);
create index if not exists cost_ledger_batch_idx on factory.cost_ledger (batch_id);
create index if not exists cost_ledger_at_idx on factory.cost_ledger (at);

-- Replay manifests (ADR 0001). A pinned manifest at a fixed route is the
-- permanent conference backup. manifest jsonb holds the full replay descriptor
-- (campaign ids, event ranges, labels); campaign_ids is a jsonb id list.
create table if not exists factory.replay_manifests (
  id             uuid primary key,
  label          text not null,
  environment_id text not null,
  route          text,
  batch_id       uuid,
  campaign_ids   jsonb not null default '[]'::jsonb,   -- CampaignId[]
  manifest       jsonb not null default '{}'::jsonb,
  pinned         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists replay_manifests_route_idx on factory.replay_manifests (route);
create unique index if not exists replay_manifests_pinned_route_uniq
  on factory.replay_manifests (route)
  where pinned;
