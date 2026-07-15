// Presentation selection (W5) — NEUTRALISED by the approved "daunting factory
// floor" design: every agent workspace stays open as a full Agent Work Card at
// all times, during the run and after it ends. No pill collapse, no compact
// tier, no expansion caps. The wall of concurrent choices IS the point.
//
// The function and its exports are kept so existing callers (dev previews,
// fixtures) keep compiling; it now maps every card to "expanded".

import type { AgentCardVM, CardPresentation } from "@/components/factory/cards";

// Legacy readable-window constant, retained for API compatibility. Nothing in
// the gallery collapses on completion any more (cards gray out in place).
export const COMPLETION_READABLE_MS = 8000;

export interface PresentationOptions {
  now: number;
  maxExpanded?: number;
  perCampaignCap?: number;
  /** Ignored — kept for API compatibility with condensed replay callers. */
  readableMs?: number;
}

/** Every card renders expanded — always-open agent workspaces. */
export function selectPresentation(
  cards: AgentCardVM[],
  opts: PresentationOptions,
): Map<string, CardPresentation> {
  void opts; // retained for API compatibility; no tiering decisions remain
  const result = new Map<string, CardPresentation>();
  for (const c of cards) result.set(c.agentRunId, "expanded");
  return result;
}
