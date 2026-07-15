// Gallery view model helpers (W5). Pure projections over W4's per-campaign
// RunVM. The gallery renderer is a pure function of GalleryCampaign[] + now, so
// W7 replay reuses it by folding stored events into RunVMs and passing them in —
// no fetching inside render components.

import type { RunVM } from "@/lib/factory/client/fold";
import { foldAgentToCardVM } from "@/components/factory/cards";
import type { AgentCardVM, CampaignHueIndex } from "@/components/factory/cards";

export interface GalleryCampaign {
  run: RunVM;
  hue: CampaignHueIndex;
  shortName: string; // legible-from-the-back campaign label
}

// Live counts for the Agent Factory Ledger — derived ONLY from events (via
// RunVM). Spend is the worker's cost-guard dollar total; never token counts
// (parameters §6, task rules).
export interface LedgerCounts {
  activeAgents: number;
  sourcesFetched: number;
  sectionsAccepted: number;
  campaignsActive: number;
  campaignsComplete: number;
  /** Documents whose canonical status has reached "ready", across campaigns. */
  docsReady: number;
  /** Sum of per-campaign running spend in USD (cost.update events). */
  spendUsd: number;
}

// A logical connector edge (parent → child). Endpoints are measured at layout
// time by the ConnectorLayer; the VM only supplies which cards are linked.
export interface ConnectorEdge {
  id: string;
  campaignId: string;
  hue: CampaignHueIndex;
  parentAgentRunId: string;
  childAgentRunId: string;
}

const ACTIVE = new Set(["queued", "running"]);

/** Short campaign label from the place (fallback to problem, then index). */
export function deriveShortName(run: RunVM, index: number): string {
  const place = (run.place || "").split(",")[0]?.trim();
  if (place) return place.length > 18 ? `${place.slice(0, 17)}…` : place;
  const prob = (run.problem || "").trim();
  if (prob) {
    const words = prob.split(/\s+/).slice(0, 3).join(" ");
    return words.length > 18 ? `${words.slice(0, 17)}…` : words;
  }
  return `Campaign ${index + 1}`;
}

export function buildLedger(campaigns: GalleryCampaign[]): LedgerCounts {
  let activeAgents = 0;
  let sourcesFetched = 0;
  let sectionsAccepted = 0;
  let campaignsActive = 0;
  let campaignsComplete = 0;
  let docsReady = 0;
  let spendUsd = 0;
  for (const { run } of campaigns) {
    for (const a of run.agents) {
      if (ACTIVE.has(a.status)) activeAgents += 1;
      sourcesFetched += a.sourceCount;
    }
    for (const key of Object.keys(run.sections) as Array<keyof typeof run.sections>) {
      if (run.sections[key].status === "accepted") sectionsAccepted += 1;
    }
    for (const d of run.documents) {
      if (d.status === "ready") docsReady += 1;
    }
    spendUsd += run.spendUsd ?? 0;
    if (run.status === "running" || run.status === "queued") campaignsActive += 1;
    if (run.status === "completed" || run.status === "partial") campaignsComplete += 1;
  }
  return {
    activeAgents,
    sourcesFetched,
    sectionsAccepted,
    campaignsActive,
    campaignsComplete,
    docsReady,
    spendUsd,
  };
}

/** Map one campaign's fold agents onto W5 card VMs, resolving parent short names. */
export function campaignCards(c: GalleryCampaign): AgentCardVM[] {
  const shortByRunId = new Map(c.run.agents.map((a) => [a.agentRunId, a.shortName]));
  return c.run.agents.map((a) =>
    foldAgentToCardVM(a, {
      campaignId: c.run.campaignId,
      hue: c.hue,
      campaignShortName: c.shortName,
      parentShortName: a.parentAgentRunId ? shortByRunId.get(a.parentAgentRunId) : undefined,
    }),
  );
}

/** Parent → child connector edges for a campaign (structural spawn/handoff lines). */
export function campaignEdges(c: GalleryCampaign): ConnectorEdge[] {
  const present = new Set(c.run.agents.map((a) => a.agentRunId));
  const edges: ConnectorEdge[] = [];
  for (const a of c.run.agents) {
    if (a.parentAgentRunId && present.has(a.parentAgentRunId)) {
      edges.push({
        id: `${a.parentAgentRunId}->${a.agentRunId}`,
        campaignId: c.run.campaignId,
        hue: c.hue,
        parentAgentRunId: a.parentAgentRunId,
        childAgentRunId: a.agentRunId,
      });
    }
  }
  return edges;
}
