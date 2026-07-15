// Agent Work Card view model — the card-props contract (W5 ⇄ W4).
//
// This is the ONLY shape the card components read. It is a pure projection of
// FactoryEvents for a single agent run: no fetching, no live clocks, no raw
// provider data. W4-assembly's fold in web/src/lib/factory/client/ should emit
// this shape (or an adapter maps its view model onto it — see cardAdapter.ts).
//
// Styling rule this shape encodes (parameters §6): monospace is ONLY for
// timestamps, verbs, source counts, and state versions (carried on the *.mono
// fields / BackscrollRow.at + verb); everything else is human sans prose. Never
// token counts, raw JSON, stack traces, or provider error bodies.

import type {
  AgentKey,
  AgentRunId,
  AgentRunStatus,
  CampaignId,
  EventId,
  FactoryEventType,
} from "@/lib/factory/contracts";

// Which of the five existing-palette hues a campaign owns. Index 0–4 map to
// CAMPAIGN_HUES in hues.ts; agents and connectors inherit their campaign's hue.
export type CampaignHueIndex = 0 | 1 | 2 | 3 | 4;

// How a card is currently drawn. The fold does NOT decide this — the gallery's
// selectPresentation() does, from expansion-priority rules (≤10 expanded, ≤3
// per campaign). Completed → pill only after the readable window elapses, which
// the live layer tracks with a timer, never the fold.
export type CardPresentation = "expanded" | "compact" | "pill";

// One semantic Work Backscroll row. summary renders verbatim (sans); at + verb
// render monospace.
export interface BackscrollRow {
  eventId: EventId;
  at: string; // ISO 8601 — rendered as a monospace HH:MM:SS timestamp
  verb?: string; // short present-tense verb, monospace (e.g. "fetched", "found")
  summary: string; // human sans prose, rendered verbatim
  type: FactoryEventType; // lets the card tint source/evidence/proposal rows
}

// Current source / tool / handoff / analysis state line (card region 4).
export interface CardActivity {
  kind: "source" | "tool" | "handoff" | "analysis" | "review";
  label?: string; // sans summary, e.g. "Fetching Leicester City Council minutes"
  // For long silent model turns the live layer supplies elapsedMs so the card
  // can render "Analysis in progress · MM:SS" (monospace clock) instead of
  // inventing intermediate thoughts. Absent = no live clock.
  sinceAt?: string; // ISO; the card computes elapsed against a supplied `now`
}

// Proposal / review status + elapsed (card region 6).
export interface CardProposalState {
  label: string; // e.g. "Proposal under review", "Accepted", "Returned once"
  tone: "pending" | "accepted" | "returned" | "rejected" | "applied";
}

// The full per-agent card view model.
export interface AgentCardVM {
  agentRunId: AgentRunId;
  campaignId: CampaignId;
  hue: CampaignHueIndex;
  campaignShortName: string;

  // Identity (from roster metadata, resolved by the fold).
  agentKey?: AgentKey; // absent only for an unknown/forward-compat agent
  displayName: string;
  shortName: string;
  responsibility: string; // one line
  kind: "fixed" | "specialist";

  // Parent relationship (region: "spawned by …"). Present for specialists and
  // any agent handed work by another.
  parentAgentRunId?: AgentRunId;
  parentShortName?: string;

  // Live status.
  status: AgentRunStatus; // queued | running | complete | partial | failed
  assignment: string; // bounded one-line task
  verb?: string; // current public work verb, monospace in the header

  backscroll: BackscrollRow[]; // chronological; card shows the last 6–10
  activity?: CardActivity; // current source/tool/handoff state
  latestFinding?: string; // latest useful finding OR uncertainty (sans)
  proposal?: CardProposalState;

  startedAt?: string; // ISO
  lastEventAt: string; // ISO — last meaningful event (drives priority + clock)
  completedAt?: string; // ISO — set on agent.completed/partial/failed

  // Priority signals (drive expansion order in selectPresentation()).
  isFailing: boolean;
  isHandingOff: boolean;
  isAwaitingReview: boolean;
  spawnSequence: number; // monotonic per gallery; higher = more recently spawned
}

// Props the card components accept. `now` is the single live-time input so the
// components stay pure/deterministic for snapshot rendering and replay.
// (Per-campaign cancel lives on the campaign anchor, not the agent card.)
export interface AgentCardProps {
  vm: AgentCardVM;
  now: number; // Date.now() supplied by the live layer (or a fixed value in replay/fixtures)
  /** Fill mode (gallery wall): stretch to the container's full width with a
   *  taller backscroll so the work stream dominates. Default false keeps the
   *  legacy fixed footprint (assembly inline workspaces). */
  fill?: boolean;
}
