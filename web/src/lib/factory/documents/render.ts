// Deterministic HTML/plain-text rendering for the nine Canonical Campaign
// Documents (ADR 0007). PURE and runtime-neutral: no next/*, no DOM, no
// randomness, no Date.now(). Same input → same output. The compiler is the ONLY
// renderer; agents never rewrite shared factual foundations at export.
//
// A tiny block AST is rendered to BOTH html and plainText from one source, so
// the on-page view, the Copy action, and the Word .doc download all stay in
// sync.
//
// Clean-prose rule (product decision, 15 Jul 2026): body text carries NO inline
// warning markup — no `[VERIFY: …]` blocks, no inline verification-label tags.
// The ONE exception is a fact labelled "Conflicting evidence", which gets a
// small question-mark icon (the power-map `.pm-inf` visual) anchor-linking to
// the Evidence and Next Checks section. Nothing is deleted from data: labels
// stay on the claims, and every stripped `[VERIFY: …]` note resurfaces in
// Evidence and Next Checks (see evidence.ts collectDraftNotes). Fill-in blanks
// like `[OFFICER NAME]` are content, not warnings — they keep their highlight.

import type { JourneyStepKey } from "../contracts/journey";
import { isVerificationLabel, type VerificationLabel } from "../../pipeline/labels";

/* label → provenance tag class (identical mapping to Journey.tsx / journey.css) */
export const LABEL_TAG_CLASS: Record<VerificationLabel, string> = {
  "Verified public information": "real",
  "Supported inference": "gen",
  "Generated campaign recommendation": "gen",
  "Campaign assumption": "mock",
  "Conflicting evidence": "verify",
  "Verification incomplete": "verify",
  "External information unavailable": "ext",
};

/** Labels that mean a claim is NOT settled — used by the document status logic. */
export const UNRESOLVED_LABELS: ReadonlySet<VerificationLabel> = new Set<VerificationLabel>([
  "Conflicting evidence",
  "Verification incomplete",
  "External information unavailable",
]);

export function isUnresolvedLabel(label: VerificationLabel): boolean {
  return UNRESOLVED_LABELS.has(label);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- `[VERIFY: …]` handling (stripped from prose, resurfaced in Evidence and
//      Next Checks) ----

const VERIFY_BLOCK_RE = /\[\s*verify\b[:\s]?([^\]\n]*)\]/gi;

/** Remove `[VERIFY: …]` blocks from prose and tidy the leftover spacing. */
export function stripVerifyText(text: string): string {
  return text
    .replace(VERIFY_BLOCK_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?)])/g, "$1")
    .replace(/\( +/g, "(")
    .trim();
}

/** The notes inside a string's `[VERIFY: …]` blocks ("[VERIFY: x]" → "x"). */
export function verifyNotesIn(text: string): string[] {
  const notes: string[] = [];
  for (const m of text.matchAll(VERIFY_BLOCK_RE)) {
    const note = (m[1] ?? "").trim();
    if (note) notes.push(note);
  }
  return notes;
}

/** Every `[VERIFY: …]` note in an arbitrarily nested content value. */
export function collectVerifyNotes(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === "string") return verifyNotesIn(value);
  if (Array.isArray(value)) return value.flatMap((v) => collectVerifyNotes(v, depth + 1));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((v) => collectVerifyNotes(v, depth + 1));
  }
  return [];
}

/** Clean prose: VERIFY blocks are stripped (they resurface in Evidence and Next
 *  Checks); remaining `[ … ]` fill-in blanks keep their <mark> highlight. */
export function withVerifyHtml(text: string): string {
  return stripVerifyText(text)
    .split(/(\[[^\]\n]+\])/g)
    .map((p) => (/^\[[^\]\n]+\]$/.test(p) ? `<mark>${escapeHtml(p)}</mark>` : escapeHtml(p)))
    .join("");
}

// ---- the one allowed inline marker: "sources disagree" question-mark ----

/** Anchor id of the Evidence and Next Checks section inside compiled html. */
export const EVIDENCE_ANCHOR_ID = "evidence-next-checks";

/** The small question-mark after a conflicting fact — same `.pm-inf` visual as
 *  the power-map nodes — linking to Evidence and Next Checks. */
export function conflictMarkHtml(anchorId: string = EVIDENCE_ANCHOR_ID): string {
  return (
    ` <a class="pm-inf pm-inf--inline" href="#${anchorId}"` +
    ` title="Sources disagree on this — see Fact checks">?</a>`
  );
}

const CONFLICT_TEXT_MARK = " (sources disagree — see Fact checks)";

function isConflictLabel(label: string | undefined): boolean {
  return label === "Conflicting evidence";
}

// ---- block AST ----

export type Block =
  | { t: "h2" | "h3" | "h4"; text: string; label?: string }
  | { t: "p"; text: string; label?: string; callout?: "warm" | "blue" | "mint" }
  | { t: "quote"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "kv"; rows: Array<[string, string]> }
  | { t: "note"; text: string }; // honest gap / verification marker

const CALLOUT_CLASS: Record<NonNullable<Extract<Block, { t: "p" }>["callout"]>, string> = {
  warm: "callout warm",
  blue: "callout",
  mint: "callout mint",
};

export function blocksToHtml(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case "h2":
      case "h3":
      case "h4": {
        // Clean prose: labels never render inline; a conflicting fact gets the
        // question-mark link to Evidence and Next Checks, nothing else.
        const mark = isConflictLabel(b.label) ? conflictMarkHtml() : "";
        out.push(`<${b.t}>${escapeHtml(b.text)}${mark}</${b.t}>`);
        break;
      }
      case "p": {
        const cls = b.callout ? ` class="${CALLOUT_CLASS[b.callout]}"` : "";
        const mark = isConflictLabel(b.label) ? conflictMarkHtml() : "";
        out.push(`<p${cls}>${withVerifyHtml(b.text)}${mark}</p>`);
        break;
      }
      case "quote":
        out.push(`<blockquote class="narr">${withVerifyHtml(b.text)}</blockquote>`);
        break;
      case "ul":
      case "ol":
        if (b.items.length) {
          out.push(
            `<${b.t}>${b.items.map((i) => `<li>${withVerifyHtml(i)}</li>`).join("")}</${b.t}>`,
          );
        }
        break;
      case "kv":
        if (b.rows.length) {
          out.push(
            `<table><tbody>${b.rows
              .map(([k, v]) => `<tr><td><b>${escapeHtml(k)}</b></td><td>${withVerifyHtml(v)}</td></tr>`)
              .join("")}</tbody></table>`,
          );
        }
        break;
      case "note":
        out.push(`<p class="fa-doc-note">${escapeHtml(b.text)}</p>`);
        break;
    }
  }
  return out.join("\n");
}

export function blocksToText(blocks: Block[]): string {
  const parts: string[] = [];
  // Clean prose in the text export too: VERIFY blocks are stripped (they live
  // in Evidence and Next Checks), labels never render inline, and a conflicting
  // fact gets a short plain-text marker instead of the icon.
  const mark = (label?: string) => (isConflictLabel(label) ? CONFLICT_TEXT_MARK : "");
  for (const b of blocks) {
    switch (b.t) {
      case "h2":
        parts.push(`\n${stripVerifyText(b.text).toUpperCase()}${mark(b.label)}`);
        break;
      case "h3":
      case "h4":
      case "p":
        parts.push(`${stripVerifyText(b.text)}${mark(b.label)}`);
        break;
      case "quote":
        parts.push(stripVerifyText(b.text));
        break;
      case "ul":
        for (const i of b.items) parts.push(`- ${stripVerifyText(i)}`);
        break;
      case "ol":
        b.items.forEach((i, n) => parts.push(`${n + 1}. ${stripVerifyText(i)}`));
        break;
      case "kv":
        for (const [k, v] of b.rows) parts.push(`${k}: ${stripVerifyText(v)}`);
        break;
      case "note":
        parts.push(`(${b.text})`);
        break;
    }
  }
  // collapse to double-newline paragraph separation, trimmed
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length)
    .join("\n\n")
    .trim();
}

// ---- defensive content accessors (content is `unknown`, may be partial) ----

export function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}
export function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}
export function objArr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x))
    : [];
}

// ---- per-section renderers (content shapes mirror state/sections.ts) ----

function pushList(blocks: Block[], heading: string, items: string[]): void {
  if (items.length) {
    blocks.push({ t: "h3", text: heading });
    blocks.push({ t: "ul", items });
  }
}

export function renderProblem(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const statement = str(c.statement);
  if (statement) b.push({ t: "quote", text: statement });
  const interpretation = str(c.interpretation);
  if (interpretation) {
    b.push({ t: "h3", text: "How the campaign was scoped", label: "Generated campaign recommendation" });
    b.push({ t: "p", text: interpretation, callout: "warm" });
  }
  const ctx = rec(c.context);
  const situation = str(ctx.situation);
  if (situation) {
    b.push({ t: "h3", text: "The situation" });
    b.push({ t: "p", text: situation });
  }
  const currentPolicy = str(ctx.currentPolicy);
  if (currentPolicy) {
    b.push({ t: "h4", text: "Current policy / restriction" });
    b.push({ t: "p", text: currentPolicy });
  }
  const howItChanged = str(ctx.howItChanged);
  if (howItChanged) {
    b.push({ t: "h4", text: "How research changed the request" });
    b.push({ t: "p", text: howItChanged, callout: "blue" });
  }
  pushList(b, "Key dates and processes", strArr(ctx.keyDates));
  pushList(b, "Institutions involved", strArr(ctx.institutions));
  pushList(b, "People affected", strArr(ctx.affected));
  return b;
}

export function renderEvidence(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const summary = str(c.summary);
  if (summary) b.push({ t: "p", text: summary });
  pushList(b, "Research questions", strArr(c.researchQuestions));
  pushList(b, "Key dates", strArr(c.keyDates));
  pushList(b, "Institutions", strArr(c.institutions));
  pushList(b, "Likely allies", strArr(c.allies));
  pushList(b, "Likely opponents", strArr(c.opponents));
  pushList(b, "Local media", strArr(c.localMedia));
  pushList(b, "Still unresolved", strArr(c.unresolved));
  return b;
}

export function renderObjective(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const dm = str(c.dm);
  const action = str(c.action);
  const by = str(c.by);
  const mvw = str(c.mvw);
  if (dm && action) {
    const by2 = by ? ` by ${by}` : "";
    const mvw2 = mvw ? `, even if the immediate outcome is only ${mvw}` : "";
    b.push({ t: "p", text: `We want ${dm} to ${action}${by2}${mvw2}.`, callout: "warm" });
  }
  const rows: Array<[string, string]> = [];
  if (dm) rows.push(["Decision-maker", dm]);
  if (action) rows.push(["Specific action", action]);
  if (by) rows.push(["By", by]);
  if (mvw) rows.push(["Minimum viable win", mvw]);
  const success = str(c.success);
  if (success) rows.push(["Success looks like", success]);
  if (rows.length) b.push({ t: "kv", rows });
  const smart = objArr(c.smart);
  if (smart.length) {
    b.push({ t: "h3", text: "SMART assessment" });
    b.push({
      t: "kv",
      rows: smart
        .map((s): [string, string] => [str(s.test) || "Test", str(s.assessment) || "—"])
        .filter(([, v]) => v),
    });
  }
  pushList(b, "Constraints", strArr(c.constraints));
  return b;
}

export function renderDecisionRoute(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const rows: Array<[string, string]> = [];
  const formal = str(c.formal);
  if (formal) rows.push(["Formal authority", formal]);
  const implementer = str(c.implementer);
  if (implementer) rows.push(["Implementer", implementer]);
  if (rows.length) b.push({ t: "kv", rows });
  const practical = str(c.practical);
  if (practical) {
    b.push({ t: "h3", text: "How it works in practice", label: "Supported inference" });
    b.push({ t: "p", text: practical, callout: "blue" });
  }
  pushList(b, "Processes and committees", strArr(c.processes));
  pushList(b, "Intervention points", strArr(c.interventionPoints));
  pushList(b, "Deadlines", strArr(c.deadlines));
  pushList(b, "Unresolved institutional questions", strArr(c.unresolved));
  return b;
}

const TIER_LABEL: Record<string, string> = {
  decides: "Decides",
  influences: "Influences",
  mobilises: "Mobilises",
  resists: "May resist",
  neutral: "Neutral",
};
const TIER_ORDER = ["decides", "influences", "mobilises", "resists", "neutral"];

export function renderPower(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const statusQuoCost = str(c.statusQuoCost);
  if (statusQuoCost) {
    b.push({ t: "h3", text: "Cost of the status quo" });
    b.push({ t: "p", text: statusQuoCost, callout: "warm" });
  }
  const stakeholders = objArr(c.stakeholders);
  const byTier = new Map<string, Record<string, unknown>[]>();
  for (const s of stakeholders) {
    const tier = str(s.tier) || "neutral";
    const bucket = byTier.get(tier);
    if (bucket) bucket.push(s);
    else byTier.set(tier, [s]);
  }
  for (const tier of TIER_ORDER) {
    const rows = byTier.get(tier);
    if (!rows || !rows.length) continue;
    b.push({ t: "h3", text: TIER_LABEL[tier] || tier });
    for (const s of rows) {
      const name = str(s.name) || str(s.role) || "Stakeholder";
      const org = str(s.org);
      const role = str(s.role);
      const heading = [name, [role, org].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
      const positionStatus = str(s.positionStatus);
      const headingLabel = positionStatus && isVerificationLabel(positionStatus) ? positionStatus : undefined;
      b.push({ t: "h4", text: heading, label: headingLabel });
      const kv: Array<[string, string]> = [];
      const power = str(s.power);
      if (power) kv.push(["Power", power]);
      const position = str(s.position);
      if (position) kv.push(["Position", position]);
      if (positionStatus && !headingLabel) kv.push(["Position status", positionStatus]);
      const cares = str(s.cares);
      if (cares) kv.push(["Cares about", cares]);
      const ask = str(s.ask);
      if (ask) kv.push(["What we ask of them", ask]);
      const approach = str(s.approach);
      if (approach) kv.push(["Recommended approach", approach]);
      const evidence = str(s.evidence);
      if (evidence) kv.push(["Evidence", evidence]);
      const confidence = str(s.confidence);
      if (confidence) kv.push(["Confidence", confidence]);
      if (kv.length) b.push({ t: "kv", rows: kv });
    }
  }
  return b;
}

export function renderPressure(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const statusQuoCost = str(c.statusQuoCost);
  if (statusQuoCost) {
    b.push({ t: "h3", text: "Making the status quo costlier than change" });
    b.push({ t: "p", text: statusQuoCost, callout: "warm" });
  }
  const pressures = objArr(c.pressures);
  for (const pr of pressures) {
    const type = str(pr.type) || "Pressure";
    b.push({ t: "h4", text: type });
    const on = str(pr.on);
    const why = str(pr.why);
    if (why) b.push({ t: "p", text: on ? `Why it matters to ${on}: ${why}` : why });
    const whoApplies = str(pr.whoApplies);
    const channel = str(pr.channel);
    if (whoApplies || channel) {
      b.push({
        t: "p",
        text: `Who applies it: ${whoApplies || "—"}${channel ? ` · via ${channel}` : ""}`,
      });
    }
    const evidence = str(pr.evidence);
    if (evidence) b.push({ t: "p", text: `Evidence: ${evidence}` });
    const action = str(pr.action);
    if (action) b.push({ t: "p", text: `Campaign action that activates it: ${action}`, callout: "blue" });
  }
  return b;
}

export function renderStrategy(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const narrative = str(c.narrative);
  if (narrative) b.push({ t: "quote", text: narrative });
  const phases = objArr(c.phases);
  if (phases.length) {
    b.push({ t: "h3", text: "Phases" });
    b.push({
      t: "ol",
      items: phases.map((ph) => {
        const name = str(ph.name) || "Phase";
        const when = str(ph.when);
        const focus = str(ph.focus);
        return `${name}${when ? ` (${when})` : ""}${focus ? ` — ${focus}` : ""}`;
      }),
    });
  }
  const route = str(c.route);
  if (route) {
    b.push({ t: "h3", text: "Route to influence" });
    b.push({ t: "p", text: route });
  }
  const coalition = str(c.coalition);
  if (coalition) {
    b.push({ t: "h3", text: "Coalition strategy" });
    b.push({ t: "p", text: coalition });
  }
  pushList(b, "Priority audiences", strArr(c.audiences));
  pushList(b, "Resources assumed", strArr(c.resources));
  pushList(b, "Constraints", strArr(c.constraints));
  pushList(b, "What the campaign will avoid", strArr(c.avoid));
  const escalation = str(c.escalation);
  if (escalation) {
    b.push({ t: "h3", text: "Escalation path" });
    b.push({ t: "p", text: escalation });
  }
  pushList(b, "Risks", strArr(c.risks));
  pushList(b, "Trade-offs", strArr(c.tradeoffs));
  pushList(b, "Signs it is working or failing", strArr(c.indicators));
  const statusQuoCost = str(c.statusQuoCost);
  if (statusQuoCost) {
    b.push({ t: "h3", text: "Cost of the status quo" });
    b.push({ t: "p", text: statusQuoCost, callout: "warm" });
  }
  return b;
}

export function renderTactics(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const tactics = objArr(c.tactics);
  for (const t of tactics) {
    const name = str(t.name) || "Tactic";
    const phase = typeof t.phase === "number" ? `P${t.phase} ` : "";
    b.push({ t: "h4", text: `${phase}${name}` });
    const kv: Array<[string, string]> = [];
    const add = (k: string, key: string) => {
      const v = str(t[key]);
      if (v) kv.push([k, v]);
    };
    add("Type", "type");
    add("Target", "target");
    add("Owner", "owner");
    add("Purpose", "purpose");
    add("Timing", "timing");
    add("Dependencies", "dependencies");
    add("Resources", "resources");
    add("Pressure it applies", "pressure");
    add("Expected effect", "expected");
    add("Success sign", "success");
    add("What follows", "next");
    add("Escalation", "escalation");
    add("Human approval", "approval");
    if (kv.length) b.push({ t: "kv", rows: kv });
  }
  return b;
}

export function renderOrganising(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const whoActs = str(c.whoActs);
  if (whoActs) b.push({ t: "p", text: whoActs });
  const whyParticipate = str(c.whyParticipate);
  if (whyParticipate) {
    b.push({ t: "h3", text: "Why people will take part" });
    b.push({ t: "p", text: whyParticipate });
  }
  pushList(b, "The asks", strArr(c.asks));
  const roles = objArr(c.roles);
  if (roles.length) {
    b.push({ t: "h3", text: "Volunteer roles" });
    b.push({
      t: "kv",
      rows: roles.map((r): [string, string] => [str(r.role) || "Role", str(r.what) || "—"]),
    });
  }
  const oneToOne = strArr(c.oneToOne);
  if (oneToOne.length) {
    b.push({ t: "h3", text: "One-to-one conversation guide" });
    b.push({ t: "ol", items: oneToOne });
  }
  const outreach = str(c.outreach);
  if (outreach) {
    b.push({ t: "h3", text: "Outreach" });
    b.push({ t: "p", text: outreach });
  }
  const ladder = objArr(c.ladder);
  if (ladder.length) {
    b.push({ t: "h3", text: "Ladder of engagement" });
    b.push({
      t: "ol",
      items: ladder.map((l) => {
        const rung = str(l.rung) || "Step";
        const action = str(l.action);
        return `${rung}${action ? ` — ${action}` : ""}`;
      }),
    });
  }
  pushList(b, "Coalition", strArr(c.coalition));
  pushList(b, "Channels", strArr(c.channels));
  const event = str(c.event);
  if (event) {
    b.push({ t: "h3", text: "Event" });
    b.push({ t: "p", text: event });
  }
  const followup = str(c.followup);
  if (followup) b.push({ t: "p", text: `Follow-up: ${followup}` });
  const sustain = str(c.sustain);
  if (sustain) b.push({ t: "p", text: `Sustaining participation: ${sustain}` });
  pushList(b, "Metrics", strArr(c.metrics));
  pushList(b, "Where trust and relationships stay human", strArr(c.humanEssential));
  return b;
}

export function renderDocumentsOverview(content: unknown): Block[] {
  const c = rec(content);
  const b: Block[] = [];
  const summary = str(c.summary);
  if (summary) b.push({ t: "p", text: summary });
  pushList(b, "Notes", strArr(c.notes));
  return b;
}

// ---- generic extras fallback -----------------------------------------------
// The state reducer preserves EVERY field the accepted proposal carried, but a
// bespoke renderer only reads the keys it knows. Anything else — specialist
// lane blocks merged as `lane_<key>`, theoryOfChange, stages,
// rejectedAlternative, localKnowledgeGaps, specialistSelection,
// decisionRouteSketch, and whatever richer output an agent produced — must
// still reach the compiled documents, or reviewer-accepted content is silently
// dropped. This mirrors the on-page Extras fallback in
// components/factory/assembly/SectionContent.tsx: extra fields render as
// humanised, labelled subsections (paragraphs, lists, key/value rows — never
// raw JSON).

/** Humanise a content key: lane_council_records → "Council records",
 *  theoryOfChange → "Theory of change". */
export function humanizeKey(key: string): string {
  const s = key
    .replace(/^lane_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : key;
}

const LEAF_TEXT_KEYS = ["text", "statement", "claim", "title", "name", "value"] as const;
const LEAF_LABEL_KEYS = ["label", "status", "tier"] as const;

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isEmptyValue(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** One list item for a flat object inside an array: its leading text field,
 *  then the remaining primitive fields. Clean prose: a verification label is
 *  never shown inline — a conflicting fact gets a short plain marker, all other
 *  labels are stripped (they stay on the claims in Evidence and Next Checks).
 *  Non-label annotations (tier etc.) keep their parenthetical. */
function objectItemText(o: Record<string, unknown>): string | undefined {
  const textKey = LEAF_TEXT_KEYS.find((k) => typeof o[k] === "string" && (o[k] as string).trim());
  const labelKey = LEAF_LABEL_KEYS.find((k) => typeof o[k] === "string" && (o[k] as string).trim());
  const rest = Object.entries(o)
    .filter(([k, v]) => k !== textKey && k !== labelKey && isPrimitive(v) && String(v).trim())
    .map(([k, v]) => `${humanizeKey(k)}: ${String(v)}`);
  const rawLabel = labelKey ? (o[labelKey] as string) : undefined;
  const label = rawLabel
    ? isVerificationLabel(rawLabel)
      ? rawLabel === "Conflicting evidence"
        ? " (sources disagree)"
        : ""
      : ` (${rawLabel})`
    : "";
  if (textKey) {
    const head = `${o[textKey] as string}${label}`;
    return rest.length ? `${head} — ${rest.join(" · ")}` : head;
  }
  return rest.length ? `${rest.join(" · ")}${label}` : undefined;
}

/** An extra value of unknown shape → readable blocks. Never raw JSON. */
function extraValueBlocks(value: unknown, depth: number): Block[] {
  if (isEmptyValue(value) || depth > 4) return [];
  if (isPrimitive(value)) return [{ t: "p", text: String(value) }];
  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) return [{ t: "ul", items: value.map(String) }];
    const blocks: Block[] = [];
    const items: string[] = [];
    const flush = () => {
      if (items.length) {
        blocks.push({ t: "ul", items: [...items] });
        items.length = 0;
      }
    };
    for (const v of value) {
      if (isPrimitive(v)) {
        items.push(String(v));
        continue;
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        const flat = Object.values(o).every((x) => isEmptyValue(x) || isPrimitive(x));
        if (flat) {
          const line = objectItemText(o);
          if (line) items.push(line);
          continue;
        }
        flush();
        blocks.push(...extraObjectBlocks(o, depth + 1));
        continue;
      }
      flush();
      blocks.push(...extraValueBlocks(v, depth + 1));
    }
    flush();
    return blocks;
  }
  if (typeof value === "object") return extraObjectBlocks(value as Record<string, unknown>, depth);
  return [];
}

function extraObjectBlocks(o: Record<string, unknown>, depth: number): Block[] {
  if (depth > 4) return [];
  const entries = Object.entries(o).filter(([, v]) => !isEmptyValue(v));
  if (!entries.length) return [];
  // an all-primitive object reads best as key/value rows
  if (entries.every(([, v]) => isPrimitive(v))) {
    return [{ t: "kv", rows: entries.map(([k, v]): [string, string] => [humanizeKey(k), String(v)]) }];
  }
  const blocks: Block[] = [];
  for (const [k, v] of entries) {
    if (isPrimitive(v)) {
      blocks.push({ t: "p", text: `${humanizeKey(k)}: ${String(v)}` });
      continue;
    }
    const body = extraValueBlocks(v, depth + 1);
    if (!body.length) continue;
    blocks.push({ t: "h4", text: humanizeKey(k) });
    blocks.push(...body);
  }
  return blocks;
}

/** Render every content field the bespoke renderer did not consume. */
export function extraFieldBlocks(content: unknown, consumed: readonly string[]): Block[] {
  const c = rec(content);
  const blocks: Block[] = [];
  for (const [k, v] of Object.entries(c)) {
    if (consumed.includes(k) || isEmptyValue(v)) continue;
    const body = extraValueBlocks(v, 1);
    if (!body.length) continue;
    blocks.push({ t: "h3", text: humanizeKey(k) });
    blocks.push(...body);
  }
  return blocks;
}

// Keys each bespoke renderer consumes; everything else the reducer preserved
// flows through extraFieldBlocks so accepted content is never dropped.
const CONSUMED_KEYS: Record<JourneyStepKey, readonly string[]> = {
  problem: ["statement", "interpretation", "context"],
  evidence: [
    "summary",
    "researchQuestions",
    "keyDates",
    "institutions",
    "allies",
    "opponents",
    "localMedia",
    "unresolved",
  ],
  objective: ["dm", "action", "by", "mvw", "success", "smart", "constraints"],
  decision_route: [
    "formal",
    "implementer",
    "practical",
    "processes",
    "interventionPoints",
    "deadlines",
    "unresolved",
  ],
  power: ["statusQuoCost", "stakeholders"],
  pressure: ["statusQuoCost", "pressures"],
  strategy: [
    "narrative",
    "phases",
    "route",
    "coalition",
    "audiences",
    "resources",
    "constraints",
    "avoid",
    "escalation",
    "risks",
    "tradeoffs",
    "indicators",
    "statusQuoCost",
  ],
  tactics: ["tactics"],
  organising: [
    "whoActs",
    "whyParticipate",
    "asks",
    "roles",
    "oneToOne",
    "outreach",
    "ladder",
    "coalition",
    "channels",
    "event",
    "followup",
    "sustain",
    "metrics",
    "humanEssential",
  ],
  documents: ["summary", "notes"],
};

const BESPOKE_RENDERERS: Record<JourneyStepKey, (content: unknown) => Block[]> = {
  problem: renderProblem,
  evidence: renderEvidence,
  objective: renderObjective,
  decision_route: renderDecisionRoute,
  power: renderPower,
  pressure: renderPressure,
  strategy: renderStrategy,
  tactics: renderTactics,
  organising: renderOrganising,
  documents: renderDocumentsOverview,
};

export const SECTION_RENDERERS: Record<JourneyStepKey, (content: unknown) => Block[]> = Object.fromEntries(
  (Object.keys(BESPOKE_RENDERERS) as JourneyStepKey[]).map((key) => [
    key,
    (content: unknown): Block[] => [
      ...BESPOKE_RENDERERS[key](content),
      ...extraFieldBlocks(content, CONSUMED_KEYS[key]),
    ],
  ]),
) as Record<JourneyStepKey, (content: unknown) => Block[]>;
