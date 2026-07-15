// The deterministic nine-document compiler (ADR 0007, parameters §2).
// PURE and runtime-neutral (no next/*, no DOM). The worker's finalisation node
// calls compileDocuments(state, claims); the same function renders the live
// Document Library and the exported .doc. Agents never rewrite shared factual
// foundations at export — this is the ONLY renderer.
//
// Docs 1–6 compile from Campaign Synthesis Reviewer-ACCEPTED brief sections.
// Packs 7–9 render CampaignDocumentState.resources (producers own the content;
// the compiler only renders it). Missing evidence yields explicit
// "needs verification" markers — never invented completion.

import type { JourneyStepKey } from "../contracts/journey";
import { JOURNEY_STEPS } from "../contracts/journey";
import {
  CANONICAL_DOCUMENTS,
  type CanonicalDocumentKey,
  type DocumentStatus,
} from "../contracts/documents";
import type { CampaignDocumentState, CampaignSectionState, CampaignState } from "../contracts/state";
import type { PackResource } from "../contracts/documents";
import type { Claim } from "../contracts/evidence";
import {
  SECTION_RENDERERS,
  blocksToHtml,
  blocksToText,
  escapeHtml,
  isUnresolvedLabel,
  type Block,
} from "./render";
import { buildEvidenceAndNextChecks, evidenceSection } from "./evidence";
import { DOCUMENT_DISCLAIMER, plainDocStatus, sectionStatusPhrase } from "./language";

export interface CompiledDocument {
  key: CanonicalDocumentKey;
  num: number;
  name: string;
  status: DocumentStatus; // exact product strings
  html: string;
  plainText: string;
  isPack: boolean;
  /** brief-section keys underlying docs 1–6 (empty for packs) */
  sectionKeys: JourneyStepKey[];
  /** resource fragments rendered inside packs 7–9 (0 for docs 1–6) */
  resourceCount: number;
  /** reasons the document is "needs verification" (unresolved claims, placeholders) */
  flags: string[];
}

// Which accepted brief sections each compiled document is built from. The
// Campaign Brief is the full ten-step narrative (steps 1–9 are load-bearing for
// readiness; the step-10 "documents" overview is not required to be ready).
const BRIEF_SECTIONS: JourneyStepKey[] = [
  "problem",
  "evidence",
  "objective",
  "decision_route",
  "power",
  "pressure",
  "strategy",
  "tactics",
  "organising",
];

export const DOC_SECTIONS: Record<
  Exclude<CanonicalDocumentKey, "lobbying_pack" | "media_pack" | "digital_pack">,
  JourneyStepKey[]
> = {
  campaign_brief: BRIEF_SECTIONS,
  objective_theory_of_change: ["objective"],
  power_stakeholder_map: ["power", "pressure"],
  campaign_strategy: ["strategy"],
  tactics_timeline: ["tactics"],
  organising_plan: ["organising"],
};

const PACK_KEYS: ReadonlySet<CanonicalDocumentKey> = new Set([
  "lobbying_pack",
  "media_pack",
  "digital_pack",
]);

const STEP_TITLE = new Map<JourneyStepKey, string>(JOURNEY_STEPS.map((s) => [s.key, s.title]));

// Plain-English note for a section that couldn't be fully checked in time —
// clean prose in the body, the detail lives in the Fact checks section.
const CHECK_SECTION_NOTE =
  "Some facts in this section couldn't be fully checked in time — see Fact checks before you use it.";

// The affectedOutputs vocabulary is pinned in the agent prompts (shared.ts
// AFFECTED_OUTPUTS_GUIDE), but recorded runs predate that and models still
// near-miss ("problem statement", "evidence base"). Fold case/spacing/
// underscores and map the observed variants so claim flags reach the documents
// they describe instead of silently matching nothing.
const OUTPUT_KEY_ALIASES: Record<string, string> = {
  // observed in the recorded live batch
  problemstatement: "problem",
  evidencebase: "evidence",
  // step titles and other near-miss names, folded
  theproblem: "problem",
  researchandevidence: "evidence",
  research: "evidence",
  objectiveandtheoryofchange: "objective",
  objectivetheoryofchange: "objective",
  theoryofchange: "objective",
  thedecisionroute: "decision_route",
  powerandstakeholders: "power",
  powerstakeholdermap: "power",
  powerandstakeholdermap: "power",
  stakeholdermap: "power",
  pressureanalysis: "pressure",
  campaignstrategy: "strategy",
  tacticsandsequencing: "tactics",
  tacticsandtimeline: "tactics",
  tacticstimeline: "tactics",
  organisingplan: "organising",
  campaigndocuments: "documents",
};

function normalizeOutputKey(raw: string): string {
  const folded = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return OUTPUT_KEY_ALIASES[folded] ?? folded;
}

/** claims whose affectedOutputs touch any of the given section keys or the doc key */
function claimsFor(claims: Claim[], sectionKeys: JourneyStepKey[], docKey: CanonicalDocumentKey): Claim[] {
  const targets = new Set<string>([...sectionKeys, docKey].map(normalizeOutputKey));
  return claims.filter((c) => (c.affectedOutputs ?? []).some((o) => targets.has(normalizeOutputKey(o))));
}

function unresolvedLoadBearing(claims: Claim[]): Claim[] {
  return claims.filter((c) => c.loadBearing && isUnresolvedLabel(c.status));
}

/**
 * Status for a compiled document from its underlying section statuses + claims
 * (ADR 0007):
 *  - no content-bearing section yet → "assembling" (or "under review" while a
 *    proposal is being decided) — claim flags describe CONTENT, so a document
 *    with nothing in it can never be "needs verification" (and therefore never
 *    exportable)
 *  - any load-bearing claim affecting it labelled "External information
 *    unavailable" → "needs verification" (badge rule narrowed 15 Jul 2026,
 *    user-confirmed: "Conflicting evidence" and "Verification incomplete" no
 *    longer gate the badge — they still populate flags[] for the display layer)
 *  - content-bearing sections and no external-unavailable claims → "ready"
 *  - some accepted / under review → "under review"
 */
export function sectionDocStatus(
  state: CampaignState,
  sectionKeys: JourneyStepKey[],
  claims: Claim[],
  docKey: CanonicalDocumentKey,
): { status: DocumentStatus; flags: string[] } {
  const flags: string[] = [];
  const statuses = sectionKeys.map((k) => state.sections[k]?.status ?? "empty");

  // Content-bearing means a section the compiler actually renders (accepted or
  // accepted-then-flagged). Without one, the honest status is "assembling":
  // "needs verification" on an empty document would unlock export of nothing.
  const hasContent = statuses.some((s) => s === "accepted" || s === "needs_verification");
  if (!hasContent) {
    return {
      status: statuses.some((s) => s === "under_review") ? "under review" : "assembling",
      flags,
    };
  }

  // flags[] still carries ALL unresolved load-bearing claims (the display
  // layer needs them) — only the STATUS decision below is narrower.
  const relevant = claimsFor(claims, sectionKeys, docKey);
  const unresolved = unresolvedLoadBearing(relevant);
  for (const c of unresolved) flags.push(`Unresolved load-bearing claim: ${c.text}`);

  const hasNeedsVerification = statuses.some((s) => s === "needs_verification");
  if (hasNeedsVerification) flags.push("A source section is flagged needs verification.");

  // Status gate: ONLY "External information unavailable" load-bearing claims.
  if (unresolved.some((c) => c.status === "External information unavailable")) {
    return { status: "needs verification", flags };
  }
  if (statuses.length > 0 && statuses.every((s) => s === "accepted" || s === "needs_verification")) {
    return { status: "ready", flags };
  }
  return { status: "under review", flags };
}

/** Render one brief section into blocks, honestly marking unaccepted sections. */
function renderSectionForBrief(key: JourneyStepKey, sec: CampaignSectionState | undefined): Block[] {
  const title = STEP_TITLE.get(key) ?? key;
  const blocks: Block[] = [{ t: "h2", text: title }];
  const status = sec?.status ?? "empty";
  if (status === "accepted" || status === "needs_verification") {
    const body = SECTION_RENDERERS[key](sec?.content);
    if (body.length) blocks.push(...body);
    else blocks.push({ t: "note", text: "Accepted, but no written content was recorded." });
    if (status === "needs_verification") {
      blocks.push({ t: "note", text: CHECK_SECTION_NOTE });
    }
  } else {
    blocks.push({
      t: "note",
      text: `This section isn't finished yet (currently ${sectionStatusPhrase(status)}). Nothing has been invented to fill it.`,
    });
  }
  return blocks;
}

/** One line of the step-10 overview: a compiled document and its status. */
interface DocStatusSummary {
  num: number;
  name: string;
  status: DocumentStatus;
}

/**
 * Step 10 ("Campaign documents") is DERIVED, not agent-written: no agent emits
 * set_section for it — the nine documents themselves are its content, and
 * their compiled statuses exist at compile time. Summarising them here is real
 * state, not invented narrative; any explicitly accepted overview content is
 * still rendered first.
 */
function renderDocumentsSection(
  sec: CampaignSectionState | undefined,
  docSummaries: readonly DocStatusSummary[],
): Block[] {
  const blocks: Block[] = [{ t: "h2", text: STEP_TITLE.get("documents") ?? "Campaign documents" }];
  const status = sec?.status ?? "empty";
  if (status === "accepted" || status === "needs_verification") {
    blocks.push(...SECTION_RENDERERS.documents(sec?.content));
    if (status === "needs_verification") {
      blocks.push({ t: "note", text: CHECK_SECTION_NOTE });
    }
  }
  blocks.push({
    t: "p",
    text: "Nine campaign documents are built from the finished sections above. Where each one stood when this brief was put together:",
  });
  blocks.push({
    t: "kv",
    rows: docSummaries.map((d): [string, string] => [`${d.num}. ${d.name}`, plainDocStatus(d.status)]),
  });
  const notReady = docSummaries.filter((d) => d.status !== "ready").length;
  if (notReady > 0) {
    blocks.push({
      t: "note",
      text: `${notReady} of ${docSummaries.length} documents aren't ready to use yet. Nothing has been invented to fill them.`,
    });
  }
  return blocks;
}

function compileBrief(
  state: CampaignState,
  claims: Claim[],
  docSummaries: readonly DocStatusSummary[],
): { html: string; plainText: string } {
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  // headline
  const headBlocks: Block[] = [];
  if (state.problem) headBlocks.push({ t: "quote", text: state.problem });
  if (state.place) headBlocks.push({ t: "p", text: `Place: ${state.place}` });
  if (headBlocks.length) {
    htmlParts.push(blocksToHtml(headBlocks));
    textParts.push(blocksToText(headBlocks));
  }

  // the ten-step narrative (steps 1–10, in order; step 10 derives from the
  // compiled document statuses instead of expecting a set_section)
  for (const step of JOURNEY_STEPS) {
    const blocks =
      step.key === "documents"
        ? renderDocumentsSection(state.sections[step.key], docSummaries)
        : renderSectionForBrief(step.key, state.sections[step.key]);
    htmlParts.push(blocksToHtml(blocks));
    textParts.push(blocksToText(blocks));
  }

  // Evidence and next checks closing section
  const evidence = evidenceSection(buildEvidenceAndNextChecks(state, claims));
  htmlParts.push(evidence.html);
  textParts.push(evidence.plainText);

  return {
    html: htmlParts.filter(Boolean).join("\n"),
    plainText: textParts.filter(Boolean).join("\n\n").trim(),
  };
}

function compileSubDoc(
  key: Exclude<CanonicalDocumentKey, "lobbying_pack" | "media_pack" | "digital_pack">,
  name: string,
  state: CampaignState,
): { html: string; plainText: string } {
  const sectionKeys = DOC_SECTIONS[key];
  const blocks: Block[] = [{ t: "h2", text: name }];
  let renderedAny = false;
  for (const sk of sectionKeys) {
    const sec = state.sections[sk];
    const status = sec?.status ?? "empty";
    if (status === "accepted" || status === "needs_verification") {
      const body = SECTION_RENDERERS[sk](sec?.content);
      if (body.length) {
        blocks.push(...body);
        renderedAny = true;
      }
      if (status === "needs_verification") {
        blocks.push({ t: "note", text: CHECK_SECTION_NOTE });
      }
    } else {
      blocks.push({
        t: "note",
        text: `The ${STEP_TITLE.get(sk) ?? sk} section isn't finished yet (currently ${sectionStatusPhrase(status)}). Nothing has been invented to fill it.`,
      });
    }
  }
  if (!renderedAny) {
    blocks.push({ t: "note", text: "Nothing here yet — this document fills in as its brief sections are finished." });
  }
  return { html: blocksToHtml(blocks), plainText: blocksToText(blocks) };
}

// ---- packs 7–9 ----

function packStatus(
  docState: CampaignDocumentState | undefined,
  claims: Claim[],
  docKey: CanonicalDocumentKey,
): { status: DocumentStatus; flags: string[] } {
  const flags: string[] = [];
  const resources = docState?.resources ?? [];
  if (!resources.length) {
    // No content yet: keep the stored NON-TERMINAL status only. A stored
    // terminal status ("ready" / "needs verification") without resources would
    // make an empty pack exportable, so it honestly stays "assembling".
    return { status: docState?.status === "under review" ? "under review" : "assembling", flags };
  }
  const hasNotes = resources.some((r) => (r.verificationNotes?.length ?? 0) > 0);
  if (hasNotes) flags.push("Contains explicit verification placeholders.");
  const referenced = new Set<string>();
  for (const r of resources) for (const id of r.claimIds ?? []) referenced.add(id);
  const unresolved = claims.filter(
    (c) => referenced.has(c.id) && c.loadBearing && isUnresolvedLabel(c.status),
  );
  for (const c of unresolved) flags.push(`Unresolved load-bearing claim: ${c.text}`);
  const claimUnresolved = claimsFor(claims, [], docKey).filter(
    (c) => c.loadBearing && isUnresolvedLabel(c.status),
  );
  for (const c of claimUnresolved) if (!unresolved.includes(c)) flags.push(`Unresolved load-bearing claim: ${c.text}`);

  // Status gate (badge rule narrowed 15 Jul 2026, user-confirmed): ONLY
  // load-bearing claims labelled "External information unavailable" make a
  // content-bearing pack "needs verification". Other unresolved labels and
  // verification placeholders stay in flags[] for the display layer.
  const externalUnavailable = [...unresolved, ...claimUnresolved].some(
    (c) => c.status === "External information unavailable",
  );
  if (externalUnavailable) {
    return { status: "needs verification", flags };
  }
  // otherwise respect a stored terminal status, defaulting to ready once content exists
  return { status: docState?.status === "under review" ? "under review" : "ready", flags };
}

function renderResource(r: PackResource): Block[] {
  const blocks: Block[] = [{ t: "h3", text: r.title || r.key }];
  if (r.body && r.body.trim()) {
    // resource bodies are markdown-ish plain text; split on blank lines into paras
    for (const para of r.body.split(/\n{2,}/)) {
      const p = para.trim();
      if (p) blocks.push({ t: "p", text: p });
    }
  }
  if (r.verificationNotes?.length) {
    blocks.push({ t: "h4", text: "Before you send this, check" });
    blocks.push({ t: "ul", items: r.verificationNotes });
  }
  return blocks;
}

function compilePack(name: string, docState: CampaignDocumentState | undefined): { html: string; plainText: string } {
  const resources = docState?.resources ?? [];
  const blocks: Block[] = [{ t: "h2", text: name }];
  if (!resources.length) {
    blocks.push({ t: "note", text: "Nothing in this pack yet (no resources) — it fills in once the strategy, tactics and organising sections are ready." });
    return { html: blocksToHtml(blocks), plainText: blocksToText(blocks) };
  }
  blocks.push({
    t: "p",
    text: "First drafts only — please edit and approve everything before it goes anywhere. Fill in the highlighted [ … ] blanks first.",
  });
  const html: string[] = [blocksToHtml(blocks)];
  const text: string[] = [blocksToText(blocks)];
  for (const r of resources) {
    const rb = renderResource(r);
    html.push(blocksToHtml(rb));
    text.push(blocksToText(rb));
  }
  return { html: html.join("\n"), plainText: text.join("\n\n").trim() };
}

// Footer disclaimer on EVERY compiled document (product decision, 15 Jul 2026).
// Baked into html + plainText here so the on-page Document Library, the Copy
// actions, and the Word export all carry it from the one renderer.
function withDisclaimer(r: { html: string; plainText: string }): { html: string; plainText: string } {
  return {
    html: `${r.html}\n<footer class="fa-doc-footer">${escapeHtml(DOCUMENT_DISCLAIMER)}</footer>`,
    plainText: `${r.plainText}\n\n${DOCUMENT_DISCLAIMER}`,
  };
}

/**
 * Compile all nine Canonical Campaign Documents from accepted campaign state +
 * the claim ledger. Deterministic and side-effect free.
 */
export function compileDocuments(state: CampaignState, claims: Claim[]): CompiledDocument[] {
  const docStateByKey = new Map<CanonicalDocumentKey, CampaignDocumentState>(
    (state.documents ?? []).map((d) => [d.key, d]),
  );
  const claimList = claims ?? [];

  // Pass 1: every document's status (independent of rendered bodies). The
  // brief's step-10 section reports these, so they must exist before rendering.
  const statusByKey = new Map<CanonicalDocumentKey, { status: DocumentStatus; flags: string[] }>();
  for (const def of CANONICAL_DOCUMENTS) {
    if (PACK_KEYS.has(def.key)) {
      statusByKey.set(def.key, packStatus(docStateByKey.get(def.key), claimList, def.key));
    } else {
      const subKey = def.key as Exclude<
        CanonicalDocumentKey,
        "lobbying_pack" | "media_pack" | "digital_pack"
      >;
      statusByKey.set(def.key, sectionDocStatus(state, DOC_SECTIONS[subKey], claimList, def.key));
    }
  }
  const docSummaries: DocStatusSummary[] = CANONICAL_DOCUMENTS.map((def) => ({
    num: def.num,
    name: def.name,
    status: statusByKey.get(def.key)!.status,
  }));

  // Pass 2: render.
  return CANONICAL_DOCUMENTS.map((def): CompiledDocument => {
    const { status, flags } = statusByKey.get(def.key)!;
    const isPack = PACK_KEYS.has(def.key);
    if (isPack) {
      const docState = docStateByKey.get(def.key);
      const { html, plainText } = withDisclaimer(compilePack(def.name, docState));
      return {
        key: def.key,
        num: def.num,
        name: def.name,
        status,
        html,
        plainText,
        isPack: true,
        sectionKeys: [],
        resourceCount: docState?.resources?.length ?? 0,
        flags,
      };
    }

    const subKey = def.key as Exclude<
      CanonicalDocumentKey,
      "lobbying_pack" | "media_pack" | "digital_pack"
    >;
    const sectionKeys = DOC_SECTIONS[subKey];
    const { html, plainText } = withDisclaimer(
      def.key === "campaign_brief"
        ? compileBrief(state, claimList, docSummaries)
        : compileSubDoc(subKey, def.name, state),
    );
    return {
      key: def.key,
      num: def.num,
      name: def.name,
      status,
      html,
      plainText,
      isPack: false,
      sectionKeys,
      resourceCount: 0,
      flags,
    };
  });
}

/** True once the reviewer pass makes a document exportable (ADR 0007). */
export function isExportable(status: DocumentStatus): boolean {
  return status === "ready" || status === "needs verification";
}
