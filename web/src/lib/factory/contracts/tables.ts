// Factory persistence names (parameters §3). App tables live in the `factory`
// schema; LangGraph checkpoints in `lg`; pg-boss in its default `pgboss`
// schema. Versioned SQL migrations in db/factory/migrations own the DDL —
// runtime create-table-if-not-exists is not the mechanism for factory tables.

export const FACTORY_SCHEMA = "factory";
export const CHECKPOINT_SCHEMA = "lg";
export const QUEUE_SCHEMA = "pgboss";

export const T = {
  batches: `${FACTORY_SCHEMA}.factory_batches`,
  runs: `${FACTORY_SCHEMA}.factory_runs`,
  agentRuns: `${FACTORY_SCHEMA}.agent_runs`,
  events: `${FACTORY_SCHEMA}.factory_events`,
  sources: `${FACTORY_SCHEMA}.sources`,
  sourceRetrievals: `${FACTORY_SCHEMA}.source_retrievals`,
  claims: `${FACTORY_SCHEMA}.claims`,
  claimEvidence: `${FACTORY_SCHEMA}.claim_evidence`,
  stateVersions: `${FACTORY_SCHEMA}.campaign_state_versions`,
  proposals: `${FACTORY_SCHEMA}.campaign_change_proposals`,
  proposalReviews: `${FACTORY_SCHEMA}.proposal_reviews`,
  proposalConflicts: `${FACTORY_SCHEMA}.proposal_conflicts`,
  judgements: `${FACTORY_SCHEMA}.judgements`,
  documentVersions: `${FACTORY_SCHEMA}.document_versions`,
  artefacts: `${FACTORY_SCHEMA}.artefacts`,
  replayManifests: `${FACTORY_SCHEMA}.replay_manifests`,
  ledger: `${FACTORY_SCHEMA}.cost_ledger`,
  environmentIdentity: `${FACTORY_SCHEMA}.environment_identity`, // single marker row (ADR 0014)
  migrations: `${FACTORY_SCHEMA}.schema_migrations`,
} as const;
