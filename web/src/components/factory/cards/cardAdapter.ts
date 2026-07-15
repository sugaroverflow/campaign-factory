// Card-state adapter — the single seam between W4-assembly's fold (RunVM /
// its AgentCardVM in web/src/lib/factory/client/fold.ts) and the AgentCardVM the
// W5 card components render. If W4's fold shape changes, only this file changes;
// the card components and gallery renderer do not.

import type {
  AgentCardVM as FoldAgentVM,
  BackscrollRow as FoldRow,
} from "@/lib/factory/client/fold";
import type { FactoryEventType } from "@/lib/factory/contracts";
import type {
  AgentCardVM,
  BackscrollRow,
  CampaignHueIndex,
  CardActivity,
  CardProposalState,
} from "./types";

export interface CardAdaptContext {
  campaignId: string;
  hue: CampaignHueIndex;
  campaignShortName: string;
  parentShortName?: string; // resolved by the caller from the campaign's agents
}

const PROPOSAL_TYPES: FactoryEventType[] = [
  "proposal.submitted",
  "proposal.accepted",
  "proposal.returned",
  "proposal.rejected",
  "proposal.applied",
];

function toRow(r: FoldRow): BackscrollRow {
  return { eventId: r.key, at: r.at, verb: r.verb, summary: r.summary, type: r.type };
}

function lastOfTypes(rows: FoldRow[], types: FactoryEventType[]): FoldRow | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (types.includes(rows[i].type)) return rows[i];
  }
  return undefined;
}

function deriveActivity(a: FoldAgentVM): CardActivity | undefined {
  const last = a.lastEvent;
  if (a.status === "running" && !last) return { kind: "analysis", sinceAt: a.startedAt };
  if (!last) return undefined;
  if (last.type.startsWith("source.")) {
    return { kind: "source", label: last.summary, sinceAt: last.at };
  }
  if (last.type === "artefact.handoff") return { kind: "handoff", label: last.summary };
  if (last.type.startsWith("proposal.")) return { kind: "review", label: last.summary };
  if (last.type.startsWith("evidence.")) return { kind: "tool", label: last.summary };
  if (last.type === "work.update") {
    // Real work verbs + content-bearing summaries (reading/writing/thinking…).
    // Carry the summary as the label so the cards render the actual work, not a
    // generic "Analysis in progress" placeholder.
    return { kind: "analysis", label: last.summary || undefined, sinceAt: last.at };
  }
  if (a.status === "running") {
    // Running but the last semantic event is old-ish → a silent model turn.
    return { kind: "analysis", label: last.summary, sinceAt: a.lastEventAt ?? a.startedAt };
  }
  return { kind: "tool", label: last.summary };
}

function deriveProposal(a: FoldAgentVM): {
  proposal?: CardProposalState;
  awaitingReview: boolean;
} {
  const last = lastOfTypes(a.backscroll, PROPOSAL_TYPES);
  if (!last) return { awaitingReview: false };
  switch (last.type) {
    case "proposal.submitted":
      return { proposal: { label: "Proposal under review", tone: "pending" }, awaitingReview: true };
    case "proposal.returned":
      return { proposal: { label: "Returned once", tone: "returned" }, awaitingReview: true };
    case "proposal.accepted":
      return { proposal: { label: "Accepted", tone: "accepted" }, awaitingReview: false };
    case "proposal.rejected":
      return { proposal: { label: "Rejected", tone: "rejected" }, awaitingReview: false };
    case "proposal.applied":
      return { proposal: { label: "Applied", tone: "applied" }, awaitingReview: false };
    default:
      return { awaitingReview: false };
  }
}

/** Map one W4 fold agent projection onto the W5 card view model. */
export function foldAgentToCardVM(a: FoldAgentVM, ctx: CardAdaptContext): AgentCardVM {
  const backscroll = a.backscroll.map(toRow);
  // Real bounded task from agent.started detail.task (new recordings); fall back
  // to the roster responsibility, then the started/queued summary (old
  // recordings emit a near-useless "<name> started" — keep it last).
  const assignment =
    a.task ??
    a.responsibility ??
    a.backscroll.find((r) => r.type === "agent.started" || r.type === "agent.queued")?.summary ??
    "";
  const { proposal, awaitingReview } = deriveProposal(a);
  const lastEventAt = a.lastEventAt ?? a.startedAt ?? backscroll[backscroll.length - 1]?.at ?? new Date(0).toISOString();

  return {
    agentRunId: a.agentRunId,
    campaignId: ctx.campaignId,
    hue: ctx.hue,
    campaignShortName: ctx.campaignShortName,
    agentKey: a.agentKey,
    displayName: a.displayName,
    shortName: a.shortName,
    responsibility: a.responsibility ?? "",
    kind: a.kind ?? "fixed",
    parentAgentRunId: a.parentAgentRunId,
    parentShortName: ctx.parentShortName,
    status: a.status,
    assignment,
    verb: a.currentVerb,
    backscroll,
    activity: deriveActivity(a),
    latestFinding: a.lastFinding?.summary,
    proposal,
    startedAt: a.startedAt,
    lastEventAt,
    completedAt: a.completedAt,
    isFailing: a.status === "failed",
    isHandingOff: a.lastEvent?.type === "artefact.handoff",
    isAwaitingReview: awaitingReview,
    spawnSequence: a.order,
  };
}

// Defensive normaliser for callers that build an AgentCardVM directly from a
// partial upstream shape (used by any non-fold source). Fills safe defaults.
export type AgentCardVMInput = Partial<AgentCardVM> &
  Pick<AgentCardVM, "agentRunId" | "campaignId" | "hue" | "campaignShortName" | "displayName">;

export function adaptAgentCardVM(input: AgentCardVMInput): AgentCardVM {
  const backscroll = input.backscroll ?? [];
  return {
    agentRunId: input.agentRunId,
    campaignId: input.campaignId,
    hue: input.hue,
    campaignShortName: input.campaignShortName,
    agentKey: input.agentKey,
    displayName: input.displayName,
    shortName: input.shortName ?? input.displayName,
    responsibility: input.responsibility ?? "",
    kind: input.kind ?? "fixed",
    parentAgentRunId: input.parentAgentRunId,
    parentShortName: input.parentShortName,
    status: input.status ?? "queued",
    assignment: input.assignment ?? "",
    verb: input.verb,
    backscroll,
    activity: input.activity,
    latestFinding: input.latestFinding,
    proposal: input.proposal,
    startedAt: input.startedAt,
    lastEventAt: input.lastEventAt ?? backscroll[backscroll.length - 1]?.at ?? input.startedAt ?? new Date(0).toISOString(),
    completedAt: input.completedAt,
    isFailing: input.isFailing ?? input.status === "failed",
    isHandingOff: input.isHandingOff ?? false,
    isAwaitingReview: input.isAwaitingReview ?? false,
    spawnSequence: input.spawnSequence ?? 0,
  };
}
