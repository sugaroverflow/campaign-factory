// Versioned accepted Campaign State: save a new version, load the latest (or a
// specific one), and a never-null accepted-state accessor for agent context.

import type { AgentRunId, CampaignId, ProposalId } from "../contracts/core";
import type { CampaignState } from "../contracts/state";
import { emptyCampaignState } from "../state/reducer";
import type { Db, JsonInput, Row } from "./types";
import { getRun } from "./runs";

export interface SaveStateVersionInput {
  campaignId: CampaignId;
  version: number;
  state: CampaignState;
  createdByAgentRunId?: AgentRunId;
  proposalId?: ProposalId;
}

/**
 * Persist a new accepted-state version. Idempotent on (campaign_id, version):
 * re-saving the same version overwrites its snapshot.
 */
export async function saveStateVersion(sql: Db, input: SaveStateVersionInput): Promise<void> {
  await sql`
    insert into factory.campaign_state_versions
      (campaign_id, version, state, created_by_agent_run_id, proposal_id)
    values
      (${input.campaignId}, ${input.version}, ${sql.json(input.state as unknown as JsonInput)},
       ${input.createdByAgentRunId ?? null}, ${input.proposalId ?? null})
    on conflict (campaign_id, version) do update set
      state = excluded.state,
      created_by_agent_run_id = excluded.created_by_agent_run_id,
      proposal_id = excluded.proposal_id`;
}

export async function loadLatestState(sql: Db, campaignId: CampaignId): Promise<CampaignState | null> {
  const rows = await sql<Row[]>`
    select state from factory.campaign_state_versions
     where campaign_id = ${campaignId}
     order by version desc
     limit 1`;
  return rows.length ? (rows[0].state as CampaignState) : null;
}

export async function loadStateVersion(
  sql: Db,
  campaignId: CampaignId,
  version: number,
): Promise<CampaignState | null> {
  const rows = await sql<Row[]>`
    select state from factory.campaign_state_versions
     where campaign_id = ${campaignId} and version = ${version}`;
  return rows.length ? (rows[0].state as CampaignState) : null;
}

/**
 * Never-null accepted state for assembling agent context. Returns the latest
 * saved version, or an empty state (version 0) built from the run's immutable
 * problem/place when no version has been saved yet.
 */
export async function getAcceptedState(sql: Db, campaignId: CampaignId): Promise<CampaignState> {
  const latest = await loadLatestState(sql, campaignId);
  if (latest) return latest;
  const run = await getRun(sql, campaignId);
  if (!run) throw new Error(`getAcceptedState: no run for campaign ${campaignId}`);
  return emptyCampaignState(campaignId, run.problem, run.place);
}
