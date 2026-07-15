// Bridge: W4 RunVM → W6's canonical CampaignReceipt shape.
//
// W6's buildCampaignReceipt(events, state) is the authoritative builder, but the
// gallery renderer is deliberately a pure function of the folded RunVM (so W7
// replay can reuse it) and does not retain the raw event array or a full
// CampaignState. The RunVM is itself event-derived, so this mapper produces the
// same counts against the same spec'd definitions (agents by final status,
// sources fetched, sections accepted, documents ready/needs-verification,
// terminal gaps, judgements). Claims-by-label is not carried in the RunVM, so
// the tally is left empty (labelSource "none") — the compact gallery tile does
// not render claim labels; the authoritative claim breakdown lives on the brief
// page's full receipt.

import type { RunVM } from "@/lib/factory/client/fold";
import { CANONICAL_DOCUMENTS, JOURNEY_STEPS } from "@/lib/factory/contracts";
import type { CampaignReceipt } from "@/lib/factory/documents";

export function runVmToCampaignReceipt(run: RunVM): CampaignReceipt {
  const agents = { spawned: run.agents.length, completed: 0, partial: 0, failed: 0 };
  let sourcesFetched = 0;
  for (const a of run.agents) {
    sourcesFetched += a.sourceCount;
    if (a.status === "complete") agents.completed += 1;
    else if (a.status === "partial") agents.partial += 1;
    else if (a.status === "failed") agents.failed += 1;
  }

  const sectionsAccepted = Object.values(run.sections).filter((s) => s.status === "accepted").length;
  const documentsReady = run.documents.filter((d) => d.status === "ready").length;
  const documentsNeedsVerification = run.documents.filter((d) => d.status === "needs verification").length;

  const judgements = { requested: 0, resolved: 0, defaulted: 0, open: 0 };
  for (const j of run.judgements) {
    judgements.requested += 1;
    if (j.status === "resolved") judgements.resolved += 1;
    else if (j.status === "defaulted") judgements.defaulted += 1;
    else judgements.open += 1;
  }

  const completedAt = run.receiptAt;
  const elapsedMs =
    run.startedAt && completedAt
      ? Math.max(0, Date.parse(completedAt) - Date.parse(run.startedAt))
      : undefined;

  return {
    campaignId: run.campaignId,
    batchId: run.batchId,
    place: run.place,
    problem: run.problem,
    status: run.status,
    partial: run.status === "partial",
    agents,
    sourcesFetched,
    claims: { total: 0, loadBearing: 0, unresolvedLoadBearing: 0, byLabel: {}, labelSource: "none" },
    sections: { accepted: sectionsAccepted, total: JOURNEY_STEPS.length },
    documents: {
      ready: documentsReady,
      needsVerification: documentsNeedsVerification,
      total: CANONICAL_DOCUMENTS.length,
    },
    terminalGaps: run.terminalGaps.length,
    judgements,
    startedAt: run.startedAt,
    completedAt,
    elapsedMs,
    briefPath: `/factory/c/${encodeURIComponent(run.campaignId)}`,
  };
}
