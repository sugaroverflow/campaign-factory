// "Evidence and Next Checks" (ADR 0006). Builds the structured source ledger
// (claims grouped by the seven verification labels), unresolved conflicts, the
// next-checks list with affected sections, and terminal gaps — plus the HTML
// section that appears at the foot of the Campaign Brief. PURE, runtime-neutral.
//
// Display redesign (product decision, 15 Jul 2026): the compiled section leads
// with three COLLAPSED plain-English groups — "Sources disagree", "Not yet
// double-checked", "Couldn't be checked from public sources" — followed by the
// settled claims, all as <details>/<summary> so the exported HTML degrades
// gracefully. Each claim collapses to a one-line summary and expands to full
// detail (label, sources, affected sections). Canonical labels stay on the
// data; only the display copy is translated (language.ts).
//
// Nothing is invented: missing evidence surfaces as explicit unresolved / gap
// entries, never as silent completion. `[VERIFY: …]` notes stripped from the
// document prose (render.ts) resurface here as draft notes under Next checks.

import type { CampaignState, TerminalGap } from "../contracts/state";
import type { Claim, NextCheck } from "../contracts/evidence";
import { JOURNEY_STEPS } from "../contracts/journey";
import { VERIFICATION_LABELS, type VerificationLabel } from "../../pipeline/labels";
import {
  EVIDENCE_ANCHOR_ID,
  collectVerifyNotes,
  escapeHtml,
  isUnresolvedLabel,
  stripVerifyText,
} from "./render";
import {
  FACT_CHECKS_TITLE,
  NEXT_CHECKS_GROUP,
  SETTLED_EVIDENCE_GROUP,
  TERMINAL_GAPS_NOTE,
  TERMINAL_GAPS_TITLE,
  UNRESOLVED_EVIDENCE_GROUPS,
  plainLabel,
  plainOutputName,
} from "./language";

export interface EvidenceClaimView {
  id: string;
  text: string;
  type: string;
  label: VerificationLabel;
  loadBearing: boolean;
  confidence: string;
  excerpt?: string;
  sourceCount: number;
  affectedOutputs: string[];
  contradictsClaimIds?: string[];
}

export interface SourceLedgerGroup {
  label: VerificationLabel;
  count: number;
  claims: EvidenceClaimView[];
}

export interface EvidenceTotals {
  claims: number;
  loadBearing: number;
  verifiedLoadBearing: number; // load-bearing claims that reached a settled label
  unresolvedLoadBearing: number;
}

/** A `[VERIFY: …]` note found in accepted content — stripped from the document
 *  prose by the renderer, kept visible here (nothing deleted from data). */
export interface DraftNote {
  text: string;
  section: string; // human section / pack title it came from
}

export interface EvidenceAndNextChecks {
  groups: SourceLedgerGroup[]; // in canonical label order; only labels present
  conflicts: EvidenceClaimView[]; // "Conflicting evidence" or explicit contradiction links
  nextChecks: NextCheck[];
  terminalGaps: TerminalGap[];
  draftNotes: DraftNote[];
  totals: EvidenceTotals;
}

function toView(claim: Claim): EvidenceClaimView {
  return {
    id: claim.id,
    text: claim.text,
    type: claim.type,
    label: claim.status,
    loadBearing: claim.loadBearing,
    confidence: claim.confidence,
    excerpt: claim.excerpt,
    sourceCount: claim.sourceIds?.length ?? 0,
    affectedOutputs: claim.affectedOutputs ?? [],
    contradictsClaimIds: claim.contradictsClaimIds,
  };
}

/** Scan the content the compiler actually renders (accepted / flagged sections
 *  and pack resources) for `[VERIFY: …]` notes so nothing stripped from prose
 *  is lost. */
function collectDraftNotes(state: CampaignState): DraftNote[] {
  const notes: DraftNote[] = [];
  for (const step of JOURNEY_STEPS) {
    const sec = state.sections?.[step.key];
    if (!sec) continue;
    if (sec.status !== "accepted" && sec.status !== "needs_verification") continue;
    for (const text of collectVerifyNotes(sec.content)) {
      notes.push({ text, section: step.title });
    }
  }
  for (const doc of state.documents ?? []) {
    for (const r of doc.resources ?? []) {
      for (const text of collectVerifyNotes(r.body)) {
        notes.push({ text, section: r.title || r.key });
      }
    }
  }
  return notes;
}

export function buildEvidenceAndNextChecks(state: CampaignState, claims: Claim[]): EvidenceAndNextChecks {
  const views = claims.map(toView);

  const groups: SourceLedgerGroup[] = [];
  for (const label of VERIFICATION_LABELS) {
    const inGroup = views.filter((v) => v.label === label);
    if (inGroup.length) groups.push({ label, count: inGroup.length, claims: inGroup });
  }

  const conflicts = views.filter(
    (v) => v.label === "Conflicting evidence" || (v.contradictsClaimIds?.length ?? 0) > 0,
  );

  const loadBearing = views.filter((v) => v.loadBearing);
  const unresolvedLoadBearing = loadBearing.filter((v) => isUnresolvedLabel(v.label));

  return {
    groups,
    conflicts,
    nextChecks: state.nextChecks ?? [],
    terminalGaps: state.terminalGaps ?? [],
    draftNotes: collectDraftNotes(state),
    totals: {
      claims: views.length,
      loadBearing: loadBearing.length,
      verifiedLoadBearing: loadBearing.length - unresolvedLoadBearing.length,
      unresolvedLoadBearing: unresolvedLoadBearing.length,
    },
  };
}

// ---- rendering helpers (shared one-line + detail shape for a claim) ----

/** Full detail lines for an expanded claim (plain English, display only). */
export function claimDetailLines(c: EvidenceClaimView): string[] {
  const lines: string[] = [];
  lines.push(`How it's labelled: ${plainLabel(c.label)}`);
  if (c.loadBearing) lines.push("Key fact — the campaign leans on this");
  if (c.sourceCount) {
    lines.push(`Sources: ${c.sourceCount}${c.excerpt ? ` — “${c.excerpt}”` : ""}`);
  } else {
    lines.push("No source recorded yet");
  }
  if (c.confidence) lines.push(`Research confidence: ${c.confidence}`);
  if (c.affectedOutputs.length) {
    lines.push(`Appears in: ${c.affectedOutputs.map(plainOutputName).join(", ")}`);
  }
  return lines;
}

function claimDetailsHtml(c: EvidenceClaimView): string {
  const lines = claimDetailLines(c).map((l) => `<li>${escapeHtml(l)}</li>`);
  return (
    `<details class="fa-evclaim"><summary>${escapeHtml(stripVerifyText(c.text))}</summary>` +
    `<ul class="fa-evclaim__meta">${lines.join("")}</ul></details>`
  );
}

function claimText(c: EvidenceClaimView): string[] {
  return [`- ${stripVerifyText(c.text)}`, `  (${claimDetailLines(c).join(" · ")})`];
}

function groupHtml(title: string, caption: string, claims: EvidenceClaimView[]): string {
  return (
    `<details class="fa-evgroup"><summary>${escapeHtml(title)} (${claims.length})</summary>` +
    `<p class="fa-evgroup__cap">${escapeHtml(caption)}</p>` +
    claims.map(claimDetailsHtml).join("") +
    `</details>`
  );
}

function groupText(title: string, caption: string, claims: EvidenceClaimView[]): string[] {
  return [`${title} (${claims.length}) — ${caption}`, ...claims.flatMap(claimText)];
}

/** The Campaign Brief's closing section, rendered as html + plain text.
 *  Heading is "Fact checks" (14 Jul 2026 redesign) — one cohesive section:
 *  plain-English category headers with a one-line caption, a dropdown per
 *  category, bullets per claim. The anchor id is unchanged (existing links). */
export function evidenceSection(data: EvidenceAndNextChecks): { html: string; plainText: string } {
  const html: string[] = [];
  const text: string[] = [];

  html.push(`<h2 id="${EVIDENCE_ANCHOR_ID}">${escapeHtml(FACT_CHECKS_TITLE)}</h2>`);
  text.push(`\n${FACT_CHECKS_TITLE.toUpperCase()}`);

  const t = data.totals;
  const intro =
    `${t.claims} fact${t.claims === 1 ? "" : "s"} recorded during research · ` +
    `${t.loadBearing} key fact${t.loadBearing === 1 ? "" : "s"} the campaign leans on ` +
    `(${t.verifiedLoadBearing} settled, ${t.unresolvedLoadBearing} still to check). ` +
    `Anything unresolved is listed here — shown, never quietly filled in.`;
  html.push(`<p>${escapeHtml(intro)}</p>`);
  text.push(intro);

  const byLabel = new Map(data.groups.map((g) => [g.label, g.claims]));

  // ---- the three plain-English check groups (collapsed) ----
  for (const spec of UNRESOLVED_EVIDENCE_GROUPS) {
    const claims = byLabel.get(spec.label) ?? [];
    if (!claims.length) continue;
    html.push(groupHtml(spec.title, spec.caption, claims));
    text.push(...groupText(spec.title, spec.caption, claims));
  }

  // ---- everything settled, kept visible (collapsed) ----
  const settled = data.groups
    .filter((g) => !isUnresolvedLabel(g.label))
    .flatMap((g) => g.claims);
  if (settled.length) {
    html.push(groupHtml(SETTLED_EVIDENCE_GROUP.title, SETTLED_EVIDENCE_GROUP.caption, settled));
    text.push(...groupText(SETTLED_EVIDENCE_GROUP.title, SETTLED_EVIDENCE_GROUP.caption, settled));
  }

  if (!data.groups.length) {
    html.push(`<p class="fa-doc-note">No facts recorded yet.</p>`);
    text.push("(No facts recorded yet.)");
  }

  // ---- things to check next (same category style; includes notes stripped
  //      from the draft prose) ----
  const draftNotes = data.draftNotes ?? [];
  if (data.nextChecks.length || draftNotes.length) {
    const rows = [
      ...data.nextChecks.map((n) => {
        const affects = n.affectedSections?.length
          ? ` — affects: ${n.affectedSections.map(plainOutputName).join(", ")}`
          : "";
        const reason = n.reason ? ` (${n.reason})` : "";
        return {
          html: `<li><b>${escapeHtml(n.description)}</b>${escapeHtml(reason)}${escapeHtml(affects)}</li>`,
          text: `- ${n.description}${reason}${affects}`,
        };
      }),
      ...draftNotes.map((n) => ({
        html: `<li><b>${escapeHtml(n.text)}</b> — flagged while drafting ${escapeHtml(n.section)}</li>`,
        text: `- ${n.text} — flagged while drafting ${n.section}`,
      })),
    ];
    html.push(
      `<details class="fa-evgroup"><summary>${escapeHtml(NEXT_CHECKS_GROUP.title)} (${rows.length})</summary>` +
        `<p class="fa-evgroup__cap">${escapeHtml(NEXT_CHECKS_GROUP.caption)}</p>` +
        `<ul>${rows.map((r) => r.html).join("")}</ul></details>`,
    );
    text.push(`${NEXT_CHECKS_GROUP.title} (${rows.length}) — ${NEXT_CHECKS_GROUP.caption}`);
    for (const r of rows) text.push(r.text);
  }

  // ---- work that did not complete (same category style) ----
  if (data.terminalGaps.length) {
    const items = data.terminalGaps.map((gp) => ({
      html: `<li>${escapeHtml(gp.description)}${gp.step ? ` <span class="hint-sm">(step ${gp.step})</span>` : ""}</li>`,
      text: `- ${gp.description}${gp.step ? ` (step ${gp.step})` : ""}`,
    }));
    html.push(
      `<details class="fa-evgroup"><summary>${escapeHtml(TERMINAL_GAPS_TITLE)} (${items.length})</summary>` +
        `<p class="fa-evgroup__cap">${escapeHtml(TERMINAL_GAPS_NOTE)}</p>` +
        `<ul>${items.map((i) => i.html).join("")}</ul></details>`,
    );
    text.push(`${TERMINAL_GAPS_TITLE} — ${TERMINAL_GAPS_NOTE}`);
    for (const i of items) text.push(i.text);
  }

  return { html: html.join("\n"), plainText: text.join("\n\n").trim() };
}
