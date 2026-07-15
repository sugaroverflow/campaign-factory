-- 003_evidence.sql
-- Evidence ledger (parameters §3 "Evidence architecture"): sources, their
-- retrieval attempts, adjudicated claims, and the claim<->source evidence join.
-- List/id columns are stored as jsonb (parsed back to JS arrays by the driver)
-- to keep upserts simple and avoid array-type inference at bind time.

create table if not exists factory.sources (
  id               uuid primary key,
  campaign_id      uuid not null,
  url              text not null,
  title            text not null default '',
  organisation     text not null default '',
  published_at     timestamptz,                    -- absent when explicitly unknown
  accessed_at      timestamptz not null default now(),
  tier             text not null,                  -- SourceTier A|B|C|D
  is_primary       boolean not null default false,
  media_type       text not null default 'html',
  content_hash     text not null default '',
  retrieval_status text not null,                  -- RetrievalStatus
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sources_campaign_url_uniq unique (campaign_id, url)
);

create index if not exists sources_campaign_idx on factory.sources (campaign_id);

-- One row per fetch/extraction attempt against a source (retrieval provenance).
create table if not exists factory.source_retrievals (
  id              uuid primary key,
  source_id       uuid not null,
  campaign_id     uuid not null,
  agent_run_id    uuid,
  status          text not null,                   -- RetrievalStatus
  http_status     integer,
  content_hash    text,
  extracted_chars integer,
  media_type      text,
  excerpt         text,                            -- short evidentiary excerpt only
  meta            jsonb not null default '{}'::jsonb,
  fetched_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists source_retrievals_source_idx on factory.source_retrievals (source_id);
create index if not exists source_retrievals_campaign_idx on factory.source_retrievals (campaign_id);

-- Adjudicated claims. status carries one of the seven verification labels.
create table if not exists factory.claims (
  id                    uuid primary key,
  campaign_id           uuid not null,
  text                  text not null,
  type                  text not null,             -- ClaimType
  status                text not null,             -- VerificationLabel
  load_bearing          boolean not null default false,
  confidence            text not null,             -- high|medium|low
  source_ids            jsonb not null default '[]'::jsonb,  -- SourceId[]
  excerpt               text,
  author_agent_run_id   uuid,
  adjudicated_by        uuid,
  state_version         integer not null default 0,
  affected_outputs      jsonb not null default '[]'::jsonb,  -- (section|document) keys
  contradicts_claim_ids jsonb not null default '[]'::jsonb,  -- ClaimId[]
  supersedes_claim_ids  jsonb not null default '[]'::jsonb,  -- ClaimId[]
  stale_of_claim_id     uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists claims_campaign_idx on factory.claims (campaign_id);
create index if not exists claims_status_idx on factory.claims (campaign_id, status);

-- Claim <-> source evidence join (which source substantiates which claim,
-- with the specific excerpt/paraphrase used).
create table if not exists factory.claim_evidence (
  id          uuid primary key,
  claim_id    uuid not null,
  source_id   uuid not null,
  campaign_id uuid not null,
  excerpt     text,
  note        text,
  created_at  timestamptz not null default now(),
  constraint claim_evidence_claim_source_uniq unique (claim_id, source_id)
);

create index if not exists claim_evidence_claim_idx on factory.claim_evidence (claim_id);
create index if not exists claim_evidence_campaign_idx on factory.claim_evidence (campaign_id);
