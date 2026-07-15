// Standalone check: exercises the pure compiler + receipts against the Leicester
// fixture and prints a summary. Not part of the app build. Run via the project's
// TypeScript compiler into a temp dir, then node (see the run notes in the W6
// handoff). Uses only runtime-neutral modules (no next/*, no DOM).

import type { CampaignState } from "../contracts/state";
import type { Claim } from "../contracts/evidence";
import { compileDocuments, isExportable } from "./compile";
import { buildEvidenceAndNextChecks } from "./evidence";
import { buildCampaignReceipt, buildBatchReceipt } from "./receipts";
import { DOCUMENT_DISCLAIMER, campaignGrade, documentPill } from "./language";
import { FIXTURE_CAMPAIGN_ID, FIXTURE_STATE, FIXTURE_CLAIMS, FIXTURE_EVENTS } from "./fixtures";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

console.log("=== compileDocuments ===");
const docs = compileDocuments(FIXTURE_STATE, FIXTURE_CLAIMS);
assert(docs.length === 9, `compiles all nine documents (got ${docs.length})`);
for (const d of docs) {
  console.log(
    `  #${d.num} ${d.name} → ${d.status}` +
      `${d.isPack ? ` [pack, ${d.resourceCount} resource(s)]` : ""}` +
      `${d.flags.length ? ` (${d.flags.length} flag(s))` : ""}` +
      ` · html ${d.html.length}b · text ${d.plainText.length}b`,
  );
  assert(d.html.length > 0, `${d.key} has html`);
  assert(d.plainText.length > 0, `${d.key} has plainText`);
  assert(
    ["assembling", "under review", "ready", "needs verification"].includes(d.status),
    `${d.key} status is an exact product string`,
  );
}

// Statuses under the narrowed badge rule (15 Jul 2026): only load-bearing
// "External information unavailable" claims gate the badge; other unresolved
// labels stay in flags[] for the display layer. The fixture has none, so every
// content-bearing document reaches "ready" and its caveats live in flags.
const byKey = new Map(docs.map((d) => [d.key, d]));
assert(byKey.get("objective_theory_of_change")!.status === "ready", "objective doc ready (accepted section, no external-unavailable claims)");
assert(
  byKey.get("power_stakeholder_map")!.status === "ready",
  "power map ready (conflicting + flagged section no longer gate the badge)",
);
assert(
  byKey.get("power_stakeholder_map")!.flags.length >= 2,
  "power map still carries its caveats in flags[] (unresolved claim + flagged section)",
);
assert(byKey.get("campaign_strategy")!.status === "ready", "strategy ready");
assert(byKey.get("tactics_timeline")!.status === "ready", "tactics ready");
assert(
  byKey.get("organising_plan")!.status === "assembling",
  "organising assembling (section empty — c7's unresolved claim must NOT flip a contentless doc)",
);
assert(
  byKey.get("campaign_brief")!.status === "under review",
  "brief under review (decision_route still being decided, organising empty)",
);
assert(byKey.get("lobbying_pack")!.status === "ready", "lobbying pack ready (verification note stays a flag, not a gate)");
assert(
  byKey.get("lobbying_pack")!.flags.some((f) => f.includes("placeholders")),
  "lobbying pack keeps its placeholder flag for the display layer",
);
assert(byKey.get("media_pack")!.status === "ready", "media pack ready (clean resources)");
assert(byKey.get("digital_pack")!.status === "assembling", "digital pack assembling (no resources)");

const readyCount = docs.filter((d) => d.status === "ready").length;
assert(readyCount === 6, `6 documents ready (got ${readyCount})`);

// contentless documents are never exportable
assert(!isExportable(byKey.get("organising_plan")!.status), "contentless organising plan is not exportable");
assert(!isExportable(byKey.get("digital_pack")!.status), "contentless digital pack is not exportable");

// no invented completion: the brief must explicitly mark the unfinished sections
assert(
  byKey.get("campaign_brief")!.plainText.includes("isn't finished yet"),
  "brief explicitly marks unfinished sections (no invented completion)",
);
assert(
  byKey.get("digital_pack")!.plainText.toLowerCase().includes("no resources"),
  "empty pack honestly states no resources",
);

// step 10 derives from the compiled document statuses — no phantom
// "isn't finished yet" section (only decision_route + organising qualify)
const briefText = byKey.get("campaign_brief")!.plainText;
const briefHtml = byKey.get("campaign_brief")!.html;
const unacceptedMarks = briefText.split("isn't finished yet").length - 1;
assert(
  unacceptedMarks === 2,
  `brief marks exactly the 2 unfinished sections, no phantom step 10 (got ${unacceptedMarks})`,
);
assert(
  briefText.includes("2. Objective and Theory of Change: Ready to use"),
  "brief step 10 summarises the nine documents with plain-English statuses",
);

// extras fallback: reviewer-accepted content beyond the bespoke keys still renders
assert(briefText.includes("Local government"), "brief renders the specialist lane block (humanised lane_ key)");
assert(
  briefText.includes("administered by the Highways team"),
  "brief renders the lane findings content, not a 'no structured content' note",
);
assert(
  byKey.get("objective_theory_of_change")!.plainText.includes("Theory of change"),
  "objective doc renders the preserved theoryOfChange field",
);

console.log("\n=== clean document prose (15 Jul 2026 product decision) ===");
for (const d of docs) {
  assert(!d.html.includes("[VERIFY"), `${d.key} html carries no inline [VERIFY: …] blocks`);
  assert(!d.plainText.includes("[VERIFY"), `${d.key} plainText carries no inline [VERIFY: …] blocks`);
  assert(!d.html.includes('class="tag'), `${d.key} html carries no inline verification-label tags`);
  assert(d.html.includes(DOCUMENT_DISCLAIMER.slice(0, 24)), `${d.key} html ends with the AI-draft disclaimer footer`);
  assert(d.plainText.endsWith(DOCUMENT_DISCLAIMER), `${d.key} plainText ends with the AI-draft disclaimer`);
}
// the ONE allowed inline marker: conflicting facts get the ? link to the evidence section
assert(
  briefHtml.includes('class="pm-inf pm-inf--inline" href="#evidence-next-checks"'),
  "brief marks the conflicting ward-councillor fact with the question-mark link",
);
assert(briefHtml.includes('id="evidence-next-checks"'), "brief carries the evidence-section anchor target");
// fill-in blanks are content, not warnings — they keep their highlight
assert(
  byKey.get("lobbying_pack")!.html.includes("<mark>[OFFICER NAME]</mark>"),
  "pack fill-in blanks keep their highlight",
);
// stripped [VERIFY: …] notes resurface in Fact checks — nothing deleted
assert(
  !byKey.get("campaign_strategy")!.plainText.includes("deputation request deadline"),
  "strategy doc prose no longer carries the [VERIFY: …] note",
);
assert(
  briefText.includes("deputation request deadline for Cabinet meetings"),
  "the stripped [VERIFY: …] note resurfaces in the brief's Fact checks",
);
assert(
  briefHtml.includes("flagged while drafting"),
  "draft notes say which section they were flagged in",
);
// the closing section is headed "Fact checks" (14 Jul 2026 redesign), with the
// checks + gaps rendered in the same collapsed category style as the claims
assert(briefHtml.includes(">Fact checks</h2>"), "brief closes with the 'Fact checks' section heading");
assert(briefText.includes("FACT CHECKS"), "brief plainText carries the FACT CHECKS heading");
assert(
  briefHtml.includes("<summary>Things to check next (3)</summary>"),
  "next checks render as a 'Things to check next' category (2 checks + 1 draft note)",
);
assert(
  briefHtml.includes("<summary>Not completed in this run (1)</summary>"),
  "terminal gaps render as a 'Not completed in this run' category",
);
// the three plain-English check groups render collapsed with captions
assert(briefHtml.includes("<summary>Sources disagree (1)</summary>"), "'Sources disagree' group renders with its count");
assert(briefHtml.includes("Not yet double-checked (2)"), "'Not yet double-checked' group renders with its count");
assert(
  briefHtml.includes("Different sources gave different answers"),
  "group captions render in plain English",
);
assert(briefHtml.includes('<details class="fa-evgroup">'), "groups use <details> so exports degrade gracefully");
assert(briefHtml.includes('<details class="fa-evclaim">'), "claims collapse to one line inside their group");

console.log("\n=== affectedOutputs normalization ===");
const variantClaim: Claim = {
  id: "cv1",
  campaignId: FIXTURE_CAMPAIGN_ID,
  text: "The spring 2027 term deadline is not confirmed by any council source.",
  type: "deadline",
  status: "Verification incomplete",
  loadBearing: true,
  confidence: "low",
  sourceIds: [],
  authorAgentRunId: "ar2",
  stateVersion: 6,
  affectedOutputs: ["Objective and Theory of Change"], // free text, not a key
};
const docsWithVariant = compileDocuments(FIXTURE_STATE, [...FIXTURE_CLAIMS, variantClaim]);
const objWithVariant = docsWithVariant.find((d) => d.key === "objective_theory_of_change")!;
assert(
  objWithVariant.flags.some((f) => f.includes("spring 2027 term deadline")),
  "free-text affectedOutputs variant still reaches its document's flags",
);
assert(
  objWithVariant.status === "ready",
  `a "Verification incomplete" claim flags but no longer gates the badge (got ${objWithVariant.status})`,
);

console.log("\n=== contentless pack with stored terminal status ===");
const stateWithEmptyReadyPack: CampaignState = {
  ...FIXTURE_STATE,
  documents: FIXTURE_STATE.documents.map((d) =>
    d.key === "digital_pack" ? { ...d, status: "ready" as const } : d,
  ),
};
const emptyReadyDocs = compileDocuments(stateWithEmptyReadyPack, FIXTURE_CLAIMS);
const emptyReadyPack = emptyReadyDocs.find((d) => d.key === "digital_pack")!;
assert(
  emptyReadyPack.status === "assembling",
  `stored terminal status on an empty pack compiles to assembling (got ${emptyReadyPack.status})`,
);

console.log("\n=== external-unavailable claim still gates the badge ===");
const externalClaim: Claim = {
  id: "cx1",
  campaignId: FIXTURE_CAMPAIGN_ID,
  text: "Internal council traffic counts for this street are not publicly available.",
  type: "number",
  status: "External information unavailable",
  loadBearing: true,
  confidence: "low",
  sourceIds: [],
  authorAgentRunId: "ar2",
  stateVersion: 6,
  affectedOutputs: ["strategy"],
};
const docsWithExternal = compileDocuments(FIXTURE_STATE, [...FIXTURE_CLAIMS, externalClaim]);
const strategyWithExternal = docsWithExternal.find((d) => d.key === "campaign_strategy")!;
assert(
  strategyWithExternal.status === "needs verification",
  `a load-bearing external-unavailable claim still gates the badge (got ${strategyWithExternal.status})`,
);

console.log("\n=== buildEvidenceAndNextChecks ===");
const evidence = buildEvidenceAndNextChecks(FIXTURE_STATE, FIXTURE_CLAIMS);
console.log(`  groups: ${evidence.groups.map((g) => `${g.label}(${g.count})`).join(", ")}`);
console.log(`  conflicts: ${evidence.conflicts.length}, nextChecks: ${evidence.nextChecks.length}, terminalGaps: ${evidence.terminalGaps.length}`);
console.log(`  draftNotes: ${JSON.stringify(evidence.draftNotes)}`);
console.log(`  totals: ${JSON.stringify(evidence.totals)}`);
assert(evidence.totals.claims === 7, "7 claims total");
assert(evidence.totals.loadBearing === 5, "5 load-bearing claims");
assert(evidence.totals.unresolvedLoadBearing === 3, "3 unresolved load-bearing claims (c2, c3, c7)");
assert(evidence.conflicts.length === 1, "1 conflict surfaced");
assert(evidence.groups.length === 5, "claims grouped across 5 labels");
assert(
  evidence.draftNotes.length === 1 && evidence.draftNotes[0].section === "Campaign strategy",
  "the strategy [VERIFY: …] note is collected with its section title",
);

console.log("\n=== buildCampaignReceipt (events + state + claims) ===");
const receipt = buildCampaignReceipt(FIXTURE_EVENTS, FIXTURE_STATE, FIXTURE_CLAIMS);
console.log(`  status: ${receipt.status} (partial=${receipt.partial})`);
console.log(`  agents: ${JSON.stringify(receipt.agents)}`);
console.log(`  sourcesFetched: ${receipt.sourcesFetched}`);
console.log(`  sections: ${receipt.sections.accepted}/${receipt.sections.total}`);
console.log(`  documents ready: ${receipt.documents.ready}/${receipt.documents.total} (needsVerification ${receipt.documents.needsVerification})`);
console.log(`  terminalGaps: ${receipt.terminalGaps}`);
console.log(`  judgements: ${JSON.stringify(receipt.judgements)}`);
console.log(`  claims: ${JSON.stringify(receipt.claims)}`);
console.log(`  elapsedMs: ${receipt.elapsedMs}`);
assert(receipt.status === "partial", "run status is partial (last run.* event)");
assert(receipt.agents.spawned === 7, `7 agents spawned (got ${receipt.agents.spawned})`);
assert(receipt.agents.completed === 6, `6 agents completed (got ${receipt.agents.completed})`);
assert(receipt.agents.failed === 1, `1 agent failed (got ${receipt.agents.failed})`);
assert(receipt.sourcesFetched === 3, `3 sources fetched (got ${receipt.sourcesFetched})`);
assert(receipt.sections.accepted === 6, `6 sections accepted (got ${receipt.sections.accepted})`);
assert(
  receipt.sections.total === 9,
  `9 acceptable sections — step 10 is compiled, never reviewer-accepted (got ${receipt.sections.total})`,
);
assert(receipt.documents.ready === 6, `6 documents ready (got ${receipt.documents.ready})`);
assert(
  receipt.documents.needsVerification === 0,
  `no documents gated (no external-unavailable claims in fixture; got ${receipt.documents.needsVerification})`,
);
assert(receipt.terminalGaps === 1, "1 terminal gap");
assert(receipt.judgements.requested === 1 && receipt.judgements.resolved === 1, "1 judgement requested + resolved");
assert(receipt.claims.total === 7 && receipt.claims.labelSource === "claim-ledger", "claim tally from ledger");
assert(typeof receipt.elapsedMs === "number" && receipt.elapsedMs! > 0, "elapsed derived from events");

console.log("\n=== buildCampaignReceipt (events + state only, no claim ledger) ===");
const receiptNoClaims = buildCampaignReceipt(FIXTURE_EVENTS, FIXTURE_STATE);
console.log(`  claims: ${JSON.stringify(receiptNoClaims.claims)}`);
assert(receiptNoClaims.claims.labelSource === "events", "falls back to event-derived labels without a ledger");
assert(receiptNoClaims.claims.byLabel["Verified public information"] === 2, "2 verified claims from events (c1, c6)");

console.log("\n=== buildBatchReceipt ===");
const batch = buildBatchReceipt(
  [
    { events: FIXTURE_EVENTS, state: FIXTURE_STATE, claims: FIXTURE_CLAIMS },
    { events: FIXTURE_EVENTS, state: FIXTURE_STATE, claims: FIXTURE_CLAIMS },
  ],
  { batchId: "fixture-batch" },
);
console.log(`  campaignCount: ${batch.campaignCount}`);
console.log(`  totals: ${JSON.stringify(batch.totals)}`);
console.log(`  statuses: ${JSON.stringify(batch.statuses)}`);
console.log(`  substantiallyUsable: ${batch.substantiallyUsable}`);
assert(batch.campaignCount === 2, "2 campaigns in batch");
assert(batch.totals.documentsReady === 12, "batch totals ready docs across campaigns (6+6)");
assert(batch.substantiallyUsable === 2, "both campaigns substantially usable (≥1 ready doc)");
assert(batch.statuses.partial === 2, "both campaigns partial in batch status roll-up");

console.log("\n=== campaignGrade (grading ladder, 14 Jul 2026 redesign) ===");
const g99 = campaignGrade(9, 9);
assert(g99.label === "Complete" && g99.tone === "complete", "9/9 → Complete (green)");
const g89 = campaignGrade(8, 9);
assert(g89.label === "Nearly complete" && g89.tone === "nearly", "8/9 → Nearly complete (amber)");
const g59 = campaignGrade(5, 9);
assert(
  g59.label === "5 of 9 sections built" && g59.tone === "neutral",
  "5/9 → '5 of 9 sections built' (grey)",
);
assert(campaignGrade(3, 3).tone === "complete", "all-of-total is Complete for any denominator");

console.log("\n=== documentPill (document card vocabulary) ===");
const pReady = documentPill("ready");
assert(pReady?.label === "Complete" && pReady?.tone === "complete", "ready → Complete (green)");
const pFlagged = documentPill("ready", true);
assert(
  pFlagged?.label === "Complete" && pFlagged?.tone === "complete",
  "ready stays Complete even with advisory flags (status drives the pill; caveats live in Fact checks)",
);
const pNeeds = documentPill("needs verification");
assert(
  pNeeds?.label === "Nearly complete" && pNeeds?.tone === "nearly",
  "needs verification → Nearly complete (amber)",
);
assert(documentPill("assembling") === null, "assembling → no pill (card dims)");
assert(documentPill("under review") === null, "under review → no pill (card dims)");
assert(documentPill(undefined) === null, "not started → no pill (card dims)");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exit(1);
