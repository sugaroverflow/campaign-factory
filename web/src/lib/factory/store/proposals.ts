// Typed Change Proposals, reviewer decisions, and recorded conflicts.

import type { AgentRunId, CampaignId, ClaimId, ProposalId } from "../contracts/core";
import type {
  ChangeProposal,
  ProposalOp,
  ProposalReview,
  ProposalStatus,
  ReviewDecision,
} from "../contracts/state";
import type { Db, JsonInput, Row } from "./types";
import { newId, strOrUndef, toIso } from "./types";

/* ---- proposals ---- */

export type ProposalInput = Omit<ChangeProposal, "id" | "status"> & {
  id?: ProposalId;
  status?: ProposalStatus;
};

function mapProposal(r: Row): ChangeProposal {
  return {
    id: String(r.id),
    campaignId: String(r.campaign_id),
    agentRunId: String(r.agent_run_id),
    baseStateVersion: Number(r.base_state_version),
    summary: String(r.summary),
    ops: (r.ops as ProposalOp[]) ?? [],
    assumptions: (r.assumptions as string[]) ?? [],
    uncertainty: strOrUndef(r.uncertainty),
    dependsOnProposalIds: (r.depends_on_proposal_ids as ProposalId[]) ?? [],
    status: String(r.status) as ProposalStatus,
    revisionOfProposalId: strOrUndef(r.revision_of_proposal_id),
  };
}

export async function insertProposal(sql: Db, input: ProposalInput): Promise<ProposalId> {
  const id = input.id ?? newId();
  await sql`
    insert into factory.campaign_change_proposals
      (id, campaign_id, agent_run_id, base_state_version, summary, ops, assumptions,
       uncertainty, depends_on_proposal_ids, status, revision_of_proposal_id)
    values
      (${id}, ${input.campaignId}, ${input.agentRunId}, ${input.baseStateVersion},
       ${input.summary ?? ""}, ${sql.json((input.ops ?? []) as unknown as JsonInput)},
       ${sql.json((input.assumptions ?? []) as unknown as JsonInput)}, ${input.uncertainty ?? null},
       ${sql.json((input.dependsOnProposalIds ?? []) as unknown as JsonInput)},
       ${input.status ?? "submitted"}, ${input.revisionOfProposalId ?? null})`;
  return id;
}

export interface SetProposalStatusOpts {
  appliedAtVersion?: number;
}

export async function setProposalStatus(
  sql: Db,
  proposalId: ProposalId,
  status: ProposalStatus,
  opts: SetProposalStatusOpts = {},
): Promise<void> {
  await sql`
    update factory.campaign_change_proposals
       set status = ${status},
           applied_at_version = coalesce(${opts.appliedAtVersion ?? null}, applied_at_version),
           updated_at = now()
     where id = ${proposalId}`;
}

export async function getProposal(sql: Db, proposalId: ProposalId): Promise<ChangeProposal | null> {
  const rows = await sql<Row[]>`select * from factory.campaign_change_proposals where id = ${proposalId}`;
  return rows.length ? mapProposal(rows[0]) : null;
}

export async function listProposals(
  sql: Db,
  campaignId: CampaignId,
  status?: ProposalStatus,
): Promise<ChangeProposal[]> {
  const rows = status
    ? await sql<Row[]>`
        select * from factory.campaign_change_proposals
         where campaign_id = ${campaignId} and status = ${status}
         order by created_at asc`
    : await sql<Row[]>`
        select * from factory.campaign_change_proposals
         where campaign_id = ${campaignId} order by created_at asc`;
  return rows.map(mapProposal);
}

/* ---- reviews ---- */

export type ReviewInput = ProposalReview & { campaignId: CampaignId };

export async function insertReview(sql: Db, input: ReviewInput): Promise<void> {
  await sql`
    insert into factory.proposal_reviews
      (id, proposal_id, campaign_id, reviewer_agent_run_id, decision, rationale, at)
    values
      (${newId()}, ${input.proposalId}, ${input.campaignId}, ${input.reviewerAgentRunId},
       ${input.decision}, ${input.rationale ?? ""}, ${input.at ?? new Date().toISOString()})`;
}

export async function listReviews(sql: Db, proposalId: ProposalId): Promise<ProposalReview[]> {
  const rows = await sql<Row[]>`
    select * from factory.proposal_reviews where proposal_id = ${proposalId} order by at asc`;
  return rows.map((r) => ({
    proposalId: String(r.proposal_id),
    reviewerAgentRunId: String(r.reviewer_agent_run_id),
    decision: String(r.decision) as ReviewDecision,
    rationale: String(r.rationale),
    at: toIso(r.at),
  }));
}

/* ---- conflicts ---- */

export interface ConflictInput {
  id?: string;
  campaignId: CampaignId;
  proposalId?: ProposalId;
  withAgentRunId?: AgentRunId;
  description: string;
  claimIds?: ClaimId[];
}

export interface ConflictRecord extends ConflictInput {
  id: string;
  resolved: boolean;
  createdAt: string;
}

export async function insertConflict(sql: Db, input: ConflictInput): Promise<string> {
  const id = input.id ?? newId();
  await sql`
    insert into factory.proposal_conflicts
      (id, campaign_id, proposal_id, with_agent_run_id, description, claim_ids)
    values
      (${id}, ${input.campaignId}, ${input.proposalId ?? null}, ${input.withAgentRunId ?? null},
       ${input.description ?? ""}, ${sql.json((input.claimIds ?? []) as unknown as JsonInput)})`;
  return id;
}

export async function setConflictResolved(sql: Db, id: string, resolved: boolean): Promise<void> {
  await sql`update factory.proposal_conflicts set resolved = ${resolved} where id = ${id}`;
}

export async function listConflicts(sql: Db, campaignId: CampaignId): Promise<ConflictRecord[]> {
  const rows = await sql<Row[]>`
    select * from factory.proposal_conflicts where campaign_id = ${campaignId} order by created_at asc`;
  return rows.map((r) => ({
    id: String(r.id),
    campaignId: String(r.campaign_id),
    proposalId: strOrUndef(r.proposal_id),
    withAgentRunId: strOrUndef(r.with_agent_run_id),
    description: String(r.description),
    claimIds: (r.claim_ids as ClaimId[]) ?? [],
    resolved: Boolean(r.resolved),
    createdAt: toIso(r.created_at),
  }));
}
