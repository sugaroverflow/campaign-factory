-- 004_state_and_proposals.sql
-- Versioned accepted Campaign State, typed Change Proposals, reviews,
-- conflicts, and Judgement Requests (ADR 0005, ADR 0008, parameters §3).
-- Agents never mutate state: they submit proposals against an explicit base
-- version; the Synthesis Reviewer decides; typed reducers apply allow-listed
-- ops. A stale proposal is re-reviewed, never applied.

-- Full accepted CampaignState snapshot per version (state jsonb). Load latest
-- by (campaign_id, version desc).
create table if not exists factory.campaign_state_versions (
  campaign_id             uuid not null,
  version                 integer not null,
  state                   jsonb not null,
  created_by_agent_run_id uuid,
  proposal_id             uuid,                    -- proposal that produced this version
  created_at              timestamptz not null default now(),
  constraint campaign_state_versions_pk primary key (campaign_id, version)
);

create index if not exists campaign_state_versions_latest_idx
  on factory.campaign_state_versions (campaign_id, version desc);

-- Typed Change Proposals. ops is the allow-listed ProposalOp[] (validated by
-- the reducer). base_state_version pins the version the proposal was authored
-- against; applied_at_version records where it landed.
create table if not exists factory.campaign_change_proposals (
  id                      uuid primary key,
  campaign_id             uuid not null,
  agent_run_id            uuid not null,
  base_state_version      integer not null,
  summary                 text not null default '',
  ops                     jsonb not null default '[]'::jsonb,   -- ProposalOp[]
  assumptions             jsonb not null default '[]'::jsonb,   -- string[]
  uncertainty             text,
  depends_on_proposal_ids jsonb not null default '[]'::jsonb,   -- ProposalId[]
  status                  text not null,                        -- ProposalStatus
  revision_of_proposal_id uuid,
  applied_at_version      integer,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists proposals_campaign_idx on factory.campaign_change_proposals (campaign_id);
create index if not exists proposals_status_idx on factory.campaign_change_proposals (campaign_id, status);

-- Reviewer decisions (preserved dissent lives in rationale).
create table if not exists factory.proposal_reviews (
  id                     uuid primary key,
  proposal_id            uuid not null,
  campaign_id            uuid not null,
  reviewer_agent_run_id  uuid not null,
  decision               text not null,           -- accept|return|reject
  rationale              text not null default '',
  at                     timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create index if not exists proposal_reviews_proposal_idx on factory.proposal_reviews (proposal_id);

-- Recorded conflicts between agents / proposals (visible dissent, ADR 0008).
create table if not exists factory.proposal_conflicts (
  id                 uuid primary key,
  campaign_id        uuid not null,
  proposal_id        uuid,
  with_agent_run_id  uuid,
  description        text not null default '',
  claim_ids          jsonb not null default '[]'::jsonb,   -- ClaimId[]
  resolved           boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists proposal_conflicts_campaign_idx on factory.proposal_conflicts (campaign_id);

-- Judgement Requests (ADR 0005): conditional, non-blocking. options and
-- affected_outputs are jsonb string[].
create table if not exists factory.judgements (
  id                uuid primary key,
  campaign_id       uuid not null,
  agent_run_id      uuid not null,
  kind              text not null,                 -- JudgementKind
  question          text not null,
  options           jsonb not null default '[]'::jsonb,    -- string[]
  provisional_default text not null,
  rationale         text not null default '',
  affected_outputs  jsonb not null default '[]'::jsonb,    -- string[]
  status            text not null,                 -- open|defaulted|resolved
  answer            text,
  answered_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists judgements_campaign_idx on factory.judgements (campaign_id, status);
