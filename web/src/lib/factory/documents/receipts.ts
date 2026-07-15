// Campaign Completion Receipt + Batch Receipt (parameters §6, ADR 0011).
// PURE and runtime-neutral. Every count is derived from real Factory Events and
// accepted campaign state — NEVER fabricated. Partial and failed work is
// reported honestly (ADR 0011): a partial campaign is a real, useful outcome,
// not a discarded one.
//
// Provenance split (kept honest and explicit):
//  - ACTIVITY counts (agents spawned/completed/partial/failed, sources fetched,
//    claims labelled, judgements, elapsed) come from Factory Events.
//  - ACCEPTED-STATE counts (sections accepted, terminal gaps) come from accepted
//    CampaignState, which is itself produced only by accepted proposals flowing
//    through those same events.
//  - DOCUMENT readiness comes from the authoritative compiler
//    (compileDocuments over that same state + claims) — the same function the
//    finalise node uses — NOT from raw state.documents[] statuses, which only
//    carry the producer packs at their pre-finalisation status.
//  - claims-by-label uses the claim ledger when provided (authoritative); if
//    absent it falls back to labels carried on evidence events, and leaves the
//    breakdown empty rather than inventing one.

import type { BatchId, FactoryEvent, RunStatus } from "../contracts/core";
import type { CampaignState } from "../contracts/state";
import type { Claim } from "../contracts/evidence";
import { JOURNEY_STEPS } from "../contracts/journey";
import { CANONICAL_DOCUMENTS } from "../contracts/documents";
import { compileDocuments } from "./compile";
import { isVerificationLabel, type VerificationLabel } from "../../pipeline/labels";

export interface AgentTally {
  spawned: number;
  completed: number;
  partial: number;
  failed: number;
}

export interface JudgementTally {
  requested: number;
  resolved: number;
  defaulted: number;
  open: number;
}

export interface ClaimTally {
  total: number;
  loadBearing: number;
  unresolvedLoadBearing: number;
  byLabel: Partial<Record<VerificationLabel, number>>;
  labelSource: "claim-ledger" | "events" | "none";
}

export interface CampaignReceipt {
  campaignId: string;
  batchId?: string;
  place?: string;
  problem?: string;
  status: RunStatus;
  partial: boolean;
  agents: AgentTally;
  sourcesFetched: number;
  claims: ClaimTally;
  sections: { accepted: number; total: number };
  documents: { ready: number; needsVerification: number; total: number };
  terminalGaps: number;
  judgements: JudgementTally;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  /** the completed campaign brief opens here in a new tab */
  briefPath: string;
}

const UNRESOLVED: ReadonlySet<VerificationLabel> = new Set<VerificationLabel>([
  "Conflicting evidence",
  "Verification incomplete",
  "External information unavailable",
]);

const RUN_EVENT_TO_STATUS: Partial<Record<string, RunStatus>> = {
  "run.queued": "queued",
  "run.started": "running",
  "run.completed": "completed",
  "run.partial": "partial",
  "run.failed": "failed",
  "run.cancelled": "cancelled",
};

const AGENT_EVENT_TYPES = new Set<string>([
  "agent.queued",
  "agent.started",
  "agent.completed",
  "agent.partial",
  "agent.failed",
  "agent.retry",
  "agent.replaced",
]);

function bySequence(events: FactoryEvent[]): FactoryEvent[] {
  return [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

function claimTallyFromClaims(claims: Claim[]): ClaimTally {
  const byLabel: Partial<Record<VerificationLabel, number>> = {};
  let loadBearing = 0;
  let unresolvedLoadBearing = 0;
  for (const c of claims) {
    byLabel[c.status] = (byLabel[c.status] ?? 0) + 1;
    if (c.loadBearing) {
      loadBearing += 1;
      if (UNRESOLVED.has(c.status)) unresolvedLoadBearing += 1;
    }
  }
  return { total: claims.length, loadBearing, unresolvedLoadBearing, byLabel, labelSource: "claim-ledger" };
}

/** Fallback: derive a claim tally from evidence events only. Honest but coarse:
 *  counts distinct claimIds; reads a label from event.payload.detail.label when
 *  present, otherwise leaves the breakdown empty. */
function claimTallyFromEvents(events: FactoryEvent[]): ClaimTally {
  const seen = new Set<string>();
  const byLabel: Partial<Record<VerificationLabel, number>> = {};
  let labelled = false;
  for (const e of events) {
    if (e.type !== "evidence.found" && e.type !== "evidence.conflicted") continue;
    const ids = e.payload?.claimIds ?? [];
    const rawLabel = e.payload?.detail?.["label"];
    const label = isVerificationLabel(rawLabel) ? rawLabel : undefined;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (label) {
        byLabel[label] = (byLabel[label] ?? 0) + 1;
        labelled = true;
      }
    }
    // conflicted events without ids still signal a conflict label
    if (!ids.length && e.type === "evidence.conflicted") {
      byLabel["Conflicting evidence"] = (byLabel["Conflicting evidence"] ?? 0) + 1;
      seen.add(`conflict:${e.eventId ?? e.sequence}`);
      labelled = true;
    }
  }
  return {
    total: seen.size,
    loadBearing: 0,
    unresolvedLoadBearing: 0,
    byLabel,
    labelSource: labelled ? "events" : "none",
  };
}

/**
 * Build the Campaign Completion Receipt from Factory Events + accepted state.
 * `claims` is optional; when provided the claims-by-label breakdown is
 * authoritative, otherwise it is derived from evidence events.
 */
export function buildCampaignReceipt(
  events: FactoryEvent[],
  state: CampaignState,
  claims?: Claim[],
): CampaignReceipt {
  const ordered = bySequence(events);

  // run status: last run.* event wins; else infer running/queued
  let status: RunStatus = "queued";
  let startedAt: string | undefined;
  let completedAt: string | undefined;
  let batchId: BatchId | undefined;
  let place: string | undefined;
  let problem: string | undefined;

  // per-agent final terminal status (retries collapse to the latest terminal)
  const agentFinal = new Map<string, "completed" | "partial" | "failed" | "running">();
  const agentSeen = new Set<string>();
  let sourcesFetched = 0;

  const judgementRequested = new Set<string>();
  const judgementResolved = new Set<string>();
  const judgementDefaulted = new Set<string>();

  for (const e of ordered) {
    if (e.batchId && !batchId) batchId = e.batchId;

    const runStatus = RUN_EVENT_TO_STATUS[e.type];
    if (runStatus) status = runStatus;
    if (e.type === "run.started") {
      startedAt = startedAt ?? e.at;
      problem = (typeof e.payload?.detail?.["problem"] === "string" ? (e.payload.detail["problem"] as string) : undefined) ?? problem;
      place = (typeof e.payload?.detail?.["place"] === "string" ? (e.payload.detail["place"] as string) : undefined) ?? place;
    }
    if (
      e.type === "run.completed" ||
      e.type === "run.partial" ||
      e.type === "run.failed" ||
      e.type === "run.cancelled"
    ) {
      completedAt = e.at;
    }

    if (e.agentRunId && AGENT_EVENT_TYPES.has(e.type)) {
      agentSeen.add(e.agentRunId);
      if (e.type === "agent.completed") agentFinal.set(e.agentRunId, "completed");
      else if (e.type === "agent.partial") agentFinal.set(e.agentRunId, "partial");
      else if (e.type === "agent.failed") agentFinal.set(e.agentRunId, "failed");
      else if (e.type === "agent.started" || e.type === "agent.retry" || e.type === "agent.replaced") {
        if (!agentFinal.has(e.agentRunId)) agentFinal.set(e.agentRunId, "running");
      }
    }

    if (e.type === "source.fetch.completed") sourcesFetched += 1;

    const jid = e.payload?.judgementId;
    if (jid) {
      if (e.type === "judgement.requested") judgementRequested.add(jid);
      else if (e.type === "judgement.resolved") judgementResolved.add(jid);
      else if (e.type === "judgement.defaulted") judgementDefaulted.add(jid);
    }
  }

  // if we saw agent/section activity but no terminal run event, it is running
  if (status === "queued" && (agentSeen.size > 0 || ordered.length > 1)) status = "running";

  const agents: AgentTally = {
    spawned: agentSeen.size,
    completed: 0,
    partial: 0,
    failed: 0,
  };
  for (const s of agentFinal.values()) {
    if (s === "completed") agents.completed += 1;
    else if (s === "partial") agents.partial += 1;
    else if (s === "failed") agents.failed += 1;
  }

  // accepted-state counts (authoritative). Step 10 ("Campaign documents") is
  // compiled from the document statuses, never reviewer-accepted as a section,
  // so the honest denominator is the nine acceptable sections — counting it
  // would cap every receipt at 9/10 forever.
  const acceptableSteps = JOURNEY_STEPS.filter((s) => s.key !== "documents");
  const sectionsAccepted = acceptableSteps.filter(
    (s) => state.sections?.[s.key]?.status === "accepted",
  ).length;
  // Document readiness must come from the AUTHORITATIVE compiler — the same
  // function the finalise node uses to decide the terminal run status — not from
  // raw state.documents[] statuses. state.documents only carries the three
  // producer packs (at their pre-finalisation status) and omits the six
  // section-derived documents, so counting it undercounts readiness and can
  // disagree with the terminal status the run actually reached.
  const compiledDocs = compileDocuments(state, claims ?? []);
  const documentsReady = compiledDocs.filter((d) => d.status === "ready").length;
  const documentsNeedsVerification = compiledDocs.filter(
    (d) => d.status === "needs verification",
  ).length;
  const terminalGaps = (state.terminalGaps ?? []).length;

  const requested = new Set<string>([...judgementRequested, ...judgementResolved, ...judgementDefaulted]);
  const resolved = judgementResolved.size;
  const defaulted = judgementDefaulted.size;

  const claimTally = claims ? claimTallyFromClaims(claims) : claimTallyFromEvents(ordered);

  const elapsedMs =
    startedAt && completedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) : undefined;

  return {
    campaignId: state.campaignId,
    batchId,
    place: place ?? state.place,
    problem: problem ?? state.problem,
    status,
    partial: status === "partial",
    agents,
    sourcesFetched,
    claims: claimTally,
    sections: { accepted: sectionsAccepted, total: acceptableSteps.length },
    documents: {
      ready: documentsReady,
      needsVerification: documentsNeedsVerification,
      total: CANONICAL_DOCUMENTS.length,
    },
    terminalGaps,
    judgements: {
      requested: requested.size,
      resolved,
      defaulted,
      open: Math.max(0, requested.size - resolved - defaulted),
    },
    startedAt,
    completedAt,
    elapsedMs,
    briefPath: `/factory/c/${encodeURIComponent(state.campaignId)}`,
  };
}

// ---- Batch Receipt (ADR 0011: includes partial + failed work honestly) ----

export interface BatchReceiptCampaignInput {
  events: FactoryEvent[];
  state: CampaignState;
  claims?: Claim[];
}

export interface BatchReceiptTotals {
  agentsSpawned: number;
  agentsCompleted: number;
  agentsPartial: number;
  agentsFailed: number;
  sourcesFetched: number;
  sectionsAccepted: number;
  documentsReady: number;
  terminalGaps: number;
}

export interface BatchReceipt {
  batchId?: string;
  campaignCount: number;
  campaigns: CampaignReceipt[];
  totals: BatchReceiptTotals;
  statuses: Partial<Record<RunStatus, number>>;
  /** honest heuristic: at least one document reached "ready" */
  substantiallyUsable: number;
}

/** True when a campaign has produced at least one ready document — the honest
 *  bar for "substantially usable" in the batch summary. */
export function isSubstantiallyUsable(r: CampaignReceipt): boolean {
  return r.documents.ready >= 1;
}

export function buildBatchReceipt(
  inputs: BatchReceiptCampaignInput[],
  meta?: { batchId?: string },
): BatchReceipt {
  const campaigns = inputs.map((c) => buildCampaignReceipt(c.events, c.state, c.claims));
  const batchId =
    meta?.batchId ?? campaigns.find((c) => c.batchId)?.batchId ?? undefined;

  const totals: BatchReceiptTotals = {
    agentsSpawned: 0,
    agentsCompleted: 0,
    agentsPartial: 0,
    agentsFailed: 0,
    sourcesFetched: 0,
    sectionsAccepted: 0,
    documentsReady: 0,
    terminalGaps: 0,
  };
  const statuses: Partial<Record<RunStatus, number>> = {};
  let usable = 0;

  for (const c of campaigns) {
    totals.agentsSpawned += c.agents.spawned;
    totals.agentsCompleted += c.agents.completed;
    totals.agentsPartial += c.agents.partial;
    totals.agentsFailed += c.agents.failed;
    totals.sourcesFetched += c.sourcesFetched;
    totals.sectionsAccepted += c.sections.accepted;
    totals.documentsReady += c.documents.ready;
    totals.terminalGaps += c.terminalGaps;
    statuses[c.status] = (statuses[c.status] ?? 0) + 1;
    if (isSubstantiallyUsable(c)) usable += 1;
  }

  return {
    batchId,
    campaignCount: campaigns.length,
    campaigns,
    totals,
    statuses,
    substantiallyUsable: usable,
  };
}
