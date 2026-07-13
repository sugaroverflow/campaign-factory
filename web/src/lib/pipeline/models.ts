// Per-stage model routing (Fable-designed, adopted 13 Jul 2026).
//
//   A Research  → Sonnet 5,  effort high    — web search; labels auditable downstream
//   B Plan      → Opus 4.8,  effort high    — NEVER downgrade: plan coherence is un-lintable
//   C Drafts    → Sonnet 5,  effort medium  — 3 grouped parallel calls
//   Lint        → Haiku 4.5                 — cheap consistency/label check overlapping C
//
// No Fable 5 anywhere: 2x price, longer turns, refusal classifiers on a public
// surface, 30-day retention requirement — nothing here needs beyond-Opus reasoning.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const MODELS = {
  research: { model: "claude-sonnet-5", effort: "high" as Effort },
  plan: { model: "claude-opus-4-8", effort: "high" as Effort },
  drafts: { model: "claude-sonnet-5", effort: "medium" as Effort },
  lint: { model: "claude-haiku-4-5" },
} as const;

// The `web_search_20260209` tool (dynamic filtering) is supported on Sonnet 5
// and Opus 4.8. Stage A caps searches per the prototype's stage-time budget.
export const WEB_SEARCH_MAX_USES = 4;
