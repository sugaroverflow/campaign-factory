// The nine Canonical Campaign Documents (ADR 0007). Names and order are
// contractual; resource fragments live inside packs 7–9 and never inflate the
// document count. Docs 1–6 compile from reviewer-accepted brief sections.

export interface CanonicalDocumentDef {
  num: number; // 1–9, display order
  key: CanonicalDocumentKey;
  name: string;
  ownerAgentKey?: string; // packs 7–9 only; 1–6 are compiled deterministically
}

export const CANONICAL_DOCUMENTS = [
  { num: 1, key: "campaign_brief", name: "Campaign Brief" },
  { num: 2, key: "objective_theory_of_change", name: "Objective and Theory of Change" },
  { num: 3, key: "power_stakeholder_map", name: "Power and Stakeholder Map" },
  { num: 4, key: "campaign_strategy", name: "Campaign Strategy" },
  { num: 5, key: "tactics_timeline", name: "Tactics and Timeline" },
  { num: 6, key: "organising_plan", name: "Organising Plan" },
  { num: 7, key: "lobbying_pack", name: "Lobbying Pack", ownerAgentKey: "lobbying_producer" },
  { num: 8, key: "media_pack", name: "Media Pack", ownerAgentKey: "media_producer" },
  { num: 9, key: "digital_pack", name: "Digital Campaign Pack", ownerAgentKey: "digital_producer" },
] as const satisfies readonly CanonicalDocumentDef[];

export type CanonicalDocumentKey =
  | "campaign_brief"
  | "objective_theory_of_change"
  | "power_stakeholder_map"
  | "campaign_strategy"
  | "tactics_timeline"
  | "organising_plan"
  | "lobbying_pack"
  | "media_pack"
  | "digital_pack";

// Exact product strings (parameters §8 / ADR 0007). Store these verbatim.
export const DOCUMENT_STATUSES = [
  "assembling",
  "under review",
  "ready",
  "needs verification",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

// A resource fragment inside a pack (emails, agendas, press releases, posts…).
export interface PackResource {
  key: string; // stable within the pack, e.g. "councillor_email"
  title: string;
  body: string; // markdown-ish plain text
  verificationNotes?: string[]; // explicit placeholders, never invented facts
  claimIds?: string[];
}
