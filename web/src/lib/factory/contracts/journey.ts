// The ten-step Campaign Brief. Step keys align with the existing Journey
// sections (problem → … → documents); Evidence and Next Checks plus the source
// ledger render alongside but are not steps. Steps may reach accepted state
// out of order (ADR 0003); the Progress Rail reflects real per-section state.

export interface JourneyStepDef {
  step: number; // 1–10
  key: JourneyStepKey;
  title: string;
}

export const JOURNEY_STEPS = [
  { step: 1, key: "problem", title: "The problem" },
  { step: 2, key: "evidence", title: "Research and evidence" },
  { step: 3, key: "objective", title: "Objective and theory of change" },
  { step: 4, key: "decision_route", title: "The decision route" },
  { step: 5, key: "power", title: "Power and stakeholders" },
  { step: 6, key: "pressure", title: "Pressure analysis" },
  { step: 7, key: "strategy", title: "Campaign strategy" },
  { step: 8, key: "tactics", title: "Tactics and sequencing" },
  { step: 9, key: "organising", title: "Organising plan" },
  { step: 10, key: "documents", title: "Campaign documents" },
] as const satisfies readonly JourneyStepDef[];

export type JourneyStepKey =
  | "problem"
  | "evidence"
  | "objective"
  | "decision_route"
  | "power"
  | "pressure"
  | "strategy"
  | "tactics"
  | "organising"
  | "documents";

export type SectionStatus =
  | "empty"
  | "assembling"
  | "under_review"
  | "accepted"
  | "needs_verification";

export function journeyStepByKey(key: JourneyStepKey): JourneyStepDef {
  const def = JOURNEY_STEPS.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown journey step key: ${key}`);
  return def;
}
