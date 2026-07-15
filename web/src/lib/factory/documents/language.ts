// Plain-language display layer (product decision, 15 Jul 2026). The factory is
// for UK campaigners with no technical background, so every user-facing surface
// speaks plain, warm, direct UK English. This module is the single source for
// those translations.
//
// DISPLAY ONLY: the canonical strings — the seven verification labels, the
// exact document status strings, section statuses, flags — are unchanged in
// stored data, events, and replay manifests. These helpers translate at the
// point of display and always fall back to the canonical string, so an
// unrecognised value is shown honestly rather than hidden.
//
// PURE and runtime-neutral (no next/*, no DOM): the compiler, the worker-facing
// modules, and client components all import from here alike.

import type { VerificationLabel } from "../../pipeline/labels";
import type { DocumentStatus } from "../contracts/documents";
import type { SectionStatus } from "../contracts/journey";
import { JOURNEY_STEPS } from "../contracts/journey";

/* ---- the seven verification labels → plain English ---- */

export const PLAIN_LABEL: Record<VerificationLabel, string> = {
  "Verified public information": "Confirmed from public sources",
  "Supported inference": "Reasonable conclusion from the evidence",
  "Generated campaign recommendation": "Our recommendation",
  "Campaign assumption": "Working assumption",
  "Conflicting evidence": "Sources disagree",
  "Verification incomplete": "Not yet double-checked",
  "External information unavailable": "Couldn't be checked from public sources",
};

/** Plain-English reading of a verification label; unknown strings pass through. */
export function plainLabel(label: string): string {
  return (PLAIN_LABEL as Record<string, string>)[label] ?? label;
}

/* ---- document status badges ---- */

export const PLAIN_DOC_STATUS: Record<DocumentStatus, string> = {
  assembling: "Still being written",
  "under review": "Being checked",
  ready: "Ready to use",
  "needs verification": "Check before you use this",
};

export function plainDocStatus(status: DocumentStatus): string {
  return PLAIN_DOC_STATUS[status] ?? status;
}

/* ---- document card pills (14 Jul 2026 redesign) ----
   The Document Library speaks the campaignGrade vocabulary: "Complete" (green)
   for ready, "Nearly complete" (amber) for needs-verification or flagged, and
   NO pill for a contentless document — the card simply dims. Never red. */

export function documentPill(
  status: DocumentStatus | undefined,
  // Advisory flags (e.g. not-yet-double-checked claims) do NOT demote a ready
  // document: STATUS drives the pill; caveats live in Fact checks. Every real
  // research run carries some advisory flags — flag-demotion would make
  // "Complete" unreachable, contradicting the ready count in the header.
  _flagged = false,
): { label: string; tone: "complete" | "nearly" } | null {
  if (status === "ready") return { label: "Complete", tone: "complete" };
  if (status === "needs verification") return { label: "Nearly complete", tone: "nearly" };
  return null; // assembling / under review / not started — dimmed card, no pill
}

/* ---- brief-section status chips ---- */

export const PLAIN_SECTION_STATUS: Record<SectionStatus, string> = {
  empty: "Waiting",
  assembling: "Still being written",
  under_review: "Being checked",
  accepted: "Accepted",
  needs_verification: "Check before you use this",
};

/** Mid-sentence, lowercase reading of a section status ("currently …"). */
export function sectionStatusPhrase(status: SectionStatus): string {
  switch (status) {
    case "empty":
      return "not started";
    case "assembling":
      return "still being written";
    case "under_review":
      return "being checked";
    case "accepted":
      return "accepted";
    case "needs_verification":
      return "waiting on a final check";
    default:
      return status;
  }
}

/* ---- compiled-document flags (CompiledDocument.flags carries canonical
        strings; translate when showing them to the campaigner) ---- */

const FLAG_PREFIX_CLAIM = "Unresolved load-bearing claim: ";

export function plainFlag(flag: string): string {
  if (flag.startsWith(FLAG_PREFIX_CLAIM)) {
    return `Key fact still to check: ${flag.slice(FLAG_PREFIX_CLAIM.length)}`;
  }
  if (flag === "A source section is flagged needs verification.") {
    return "Part of this document still needs checking before you use it.";
  }
  if (flag === "Contains explicit verification placeholders.") {
    return "Contains fill-in blanks to complete before anything is sent.";
  }
  return flag;
}

/* ---- shared copy strings ---- */

/** Footer disclaimer on every compiled document (on page and in the Word export). */
export const DOCUMENT_DISCLAIMER =
  "AI-generated draft — please verify all facts and figures before publishing or campaigning with this material.";

/** Plain heading for what the data records as terminal gaps. */
export const TERMINAL_GAPS_TITLE = "Not completed in this run";
export const TERMINAL_GAPS_NOTE =
  "This work didn't finish in the time available. Nothing was invented to cover it.";

/** The evidence/claims apparatus renders as ONE cohesive section under this
 *  heading, at the bottom of the brief and of every compiled document. */
export const FACT_CHECKS_TITLE = "Fact checks";

/** Next-checks rendered as a fact-check category (same style as the others). */
export const NEXT_CHECKS_GROUP = {
  title: "Things to check next",
  caption: "Specific checks to make before you rely on the campaign materials",
};

/** Judgement framing: a defaulted choice is ours to own and the user's to change. */
export const JUDGEMENT_FRAME = "A choice we made — you can change it";
export const JUDGEMENT_DEFAULT_CHIP = "chosen for now";

/* ---- campaign grading ladder (product decision, 15 Jul 2026) ----
   One shared vocabulary for "how finished is this campaign": the brief header
   line, gallery cards, and receipts all read from here. Tones map to
   green ("complete") / amber ("nearly") / grey ("neutral") — NEVER red. */

export function campaignGrade(
  acceptedSections: number,
  totalSections: number,
): { label: string; tone: "complete" | "nearly" | "neutral" } {
  if (totalSections > 0 && acceptedSections >= totalSections) {
    return { label: "Complete", tone: "complete" };
  }
  if (acceptedSections === totalSections - 1) {
    return { label: "Nearly complete", tone: "nearly" };
  }
  return { label: `${acceptedSections} of ${totalSections} sections built`, tone: "neutral" };
}

/* ---- Evidence & Next Checks groups (three unresolved kinds, plain titles) ---- */

export interface EvidenceGroupCopy {
  label: VerificationLabel; // canonical grouping key (data unchanged)
  title: string;
  caption: string;
}

export const UNRESOLVED_EVIDENCE_GROUPS: readonly EvidenceGroupCopy[] = [
  {
    label: "Conflicting evidence",
    title: "Sources disagree",
    caption:
      "Different sources gave different answers on these points — check before relying on them",
  },
  {
    label: "Verification incomplete",
    title: "Not yet double-checked",
    caption:
      "Found during research but not verified against a second source in the time available",
  },
  {
    label: "External information unavailable",
    title: "Couldn't be checked from public sources",
    caption:
      "These need information that isn't publicly available — for example internal council data",
  },
];

/** Everything the research settled, kept visible below the three check groups. */
export const SETTLED_EVIDENCE_GROUP = {
  title: "What the campaign rests on",
  caption:
    "Everything else the research recorded — confirmed facts, reasonable conclusions, our recommendations and working assumptions",
};

/* ---- affected outputs → readable names ---- */

const fold = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");

const OUTPUT_TITLES: ReadonlyMap<string, string> = new Map([
  ...JOURNEY_STEPS.map((s): [string, string] => [fold(s.key), s.title]),
  ...JOURNEY_STEPS.map((s): [string, string] => [fold(s.title), s.title]),
  ["campaignbrief", "Campaign Brief"],
  ["objectivetheoryofchange", "Objective and theory of change"],
  ["powerstakeholdermap", "Power and stakeholders"],
  ["campaignstrategy", "Campaign strategy"],
  ["tacticstimeline", "Tactics and sequencing"],
  ["organisingplan", "Organising plan"],
  ["lobbyingpack", "Lobbying pack"],
  ["mediapack", "Media pack"],
  ["digitalpack", "Digital pack"],
]);

/** "decision_route" → "The decision route"; free text is tidied, never dropped. */
export function plainOutputName(output: string): string {
  const known = OUTPUT_TITLES.get(fold(output));
  if (known) return known;
  const s = output.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : output;
}
