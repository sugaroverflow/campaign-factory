// Completed-campaign read path (W4 ← W2/W6). Coordinator ruling 15 Jul 2026:
// terminal runs get a durable W2 read route,
//   GET /api/factory/runs/[campaignId]/documents
// returning { documents: CompiledDocument[], evidence: EvidenceAndNextChecks },
// built server-side from W6's compiler over persisted state + claims. The live
// view stays events-only; this fetch upgrades a FINISHED brief to full document
// bodies plus the evidence ledger. Returns null — and the UI keeps its honest
// status-only surfaces — when the route isn't deployed yet, the run isn't
// terminal, or the body doesn't match the ruled shape. Never throws.

import type { CompiledDocument, EvidenceAndNextChecks } from "../documents";

export interface CompiledCampaignBundle {
  documents: CompiledDocument[];
  evidence: EvidenceAndNextChecks;
}

export async function fetchCompiledCampaign(campaignId: string): Promise<CompiledCampaignBundle | null> {
  try {
    const res = await fetch(`/api/factory/runs/${encodeURIComponent(campaignId)}/documents`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<CompiledCampaignBundle> | null;
    if (
      !body ||
      !Array.isArray(body.documents) ||
      !body.evidence ||
      !Array.isArray(body.evidence.groups) ||
      !body.evidence.totals
    ) {
      return null;
    }
    return { documents: body.documents, evidence: body.evidence };
  } catch {
    return null;
  }
}
