// Executable checks for the W3 agent runtime: gateway SSRF guards, tier
// heuristic, label coercion, deterministic QA, and full mock-mode coverage of
// every agent (zero model calls). Run: FACTORY_MOCK_FAST=1 npx tsx src/agents/__checks__/gateway-and-labels.ts

import { fetchPage, isBlockedIp, tierOf } from "../gateway.js";
import { executeAgentTurn } from "../executor.js";
import { runSynthesisReview } from "../reviewer.js";
import { deterministicQA } from "../qa.js";
import type { EmitFragment, ExecutorDeps } from "../deps.js";
import { coerceLabel } from "@web/lib/pipeline/labels.js";
import { coerceClaims } from "@web/lib/factory/agents/shared.js";
import { getAgentContract } from "@web/lib/factory/agents/index.js";
import { validateSectionContent } from "@web/lib/factory/state/sections.js";
import type {
  AgentDef,
  AgentResult,
  AgentTaskEnvelope,
  ChangeProposal,
} from "@web/lib/factory/contracts/index.js";
import { ALL_AGENT_DEFS, agentDef } from "@web/lib/factory/contracts/roster.js";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function stub(def: AgentDef): { deps: ExecutorDeps; events: EmitFragment[] } {
  const events: EmitFragment[] = [];
  const deps: ExecutorDeps = {
    emit: async (f) => {
      events.push(f);
      return {
        eventId: "e",
        sequence: events.length,
        campaignId: "camp-1",
        type: f.type,
        at: new Date().toISOString(),
        visibility: f.visibility ?? "public",
        payload: f.payload,
      };
    },
    gate: { acquire: async () => () => {} },
    // Deliberately throws if used — the gateway catch path must swallow it.
    sql: (() => {
      throw new Error("sql not available in check");
    }) as unknown as ExecutorDeps["sql"],
    recordUsage: async () => {},
    agentDef: def,
    modelMode: "mock",
    signal: new AbortController().signal,
    now: () => new Date(),
  };
  return { deps, events };
}

function env(def: AgentDef): AgentTaskEnvelope {
  return {
    campaignId: "camp-1",
    agentRunId: `ar-${def.key}`,
    stateVersion: 0,
    journeySteps: def.journeySteps,
    task: "Mock task",
    contextRefs: [],
    evidenceRefs: [],
    constraints: [],
    toolPolicy: def.toolPolicy,
    deadlineAt: new Date(Date.now() + 300000).toISOString(),
  };
}

const ALLOWED_OPS = new Set(["set_section", "merge_section", "set_pack", "add_next_check", "record_terminal_gap"]);
const MOCK_LABELS = new Set(["Generated campaign recommendation", "Campaign assumption"]);

async function main() {
  process.env.FACTORY_MOCK_FAST = "1";

  // 1) SSRF IP guards.
  console.log("SSRF isBlockedIp:");
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "169.254.169.254", "172.16.5.5", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    ok(`blocks ${ip}`, isBlockedIp(ip) === true);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "2606:2800:220:1:248:1893:25c8:1946"]) {
    ok(`allows ${ip}`, isBlockedIp(ip) === false);
  }

  // 2) tier heuristic.
  console.log("Tier heuristic:");
  ok("gov.uk → A", tierOf("www.leicester.gov.uk") === "A");
  ok("parliament.uk → A", tierOf("committees.parliament.uk") === "A");
  ok("ons.gov.uk → B", tierOf("www.ons.gov.uk") === "B");
  ok("bbc.co.uk → C", tierOf("www.bbc.co.uk") === "C");
  ok("random → D", tierOf("some-campaign-blog.example") === "D");

  // 3) gateway refuses/blocks private + non-http targets without throwing.
  console.log("Gateway blocks private/non-http targets:");
  const { deps: gd } = stub(agentDef("research_director"));
  for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://localhost:8080/", "http://[::1]/", "file:///etc/passwd", "ftp://example.com/x", "not-a-url"]) {
    const r = await fetchPage({ url }, { def: agentDef("research_director"), deps: gd, agentRunId: "ar", campaignId: "camp-1" });
    ok(`blocks/refuses ${url}`, r.status === "blocked" && !r.sourceId, `status=${r.status}`);
  }

  // 4) label coercion.
  console.log("Label coercion:");
  ok("off-enum → Verification incomplete", coerceLabel("totally made up") === "Verification incomplete");
  ok("valid passes through", coerceLabel("Verified public information") === "Verified public information");
  const coerced = coerceClaims([{ text: "x", type: "authority", status: "nonsense", loadBearing: true, confidence: "sky-high", sourceIds: "notarray" }], "camp-1");
  ok("coerceClaims off-enum label → Verification incomplete", coerced[0].status === "Verification incomplete");
  ok("coerceClaims off-enum confidence → low", coerced[0].confidence === "low");
  ok("coerceClaims bad sourceIds → []", Array.isArray(coerced[0].sourceIds) && coerced[0].sourceIds.length === 0);

  // 5) deterministic QA.
  console.log("Deterministic QA:");
  const badResult: AgentResult = {
    agentRunId: "ar",
    status: "complete",
    workSummary: "",
    claims: [{ campaignId: "camp-1", text: "load bearing", type: "authority", status: "Verified public information", loadBearing: true, confidence: "high", sourceIds: [] }],
    proposals: [
      { campaignId: "camp-1", baseStateVersion: 0, summary: "s", ops: [{ op: "set_section", step: "objective", content: {}, evidenceClaimIds: ["c5"] }], assumptions: [] },
    ],
    unknowns: [],
    confidence: "high",
    handoffs: [],
  };
  const qaFlags = deterministicQA(badResult);
  ok("flags load-bearing verified claim with no source", qaFlags.some((f) => f.kind === "verification_marker" && f.severity === "block"));
  ok("flags dangling c5 citation", qaFlags.some((f) => f.kind === "citation" && f.severity === "block"));

  // 6) full mock coverage, zero model calls.
  console.log("Mock coverage (all agents):");
  for (const def of ALL_AGENT_DEFS) {
    if (def.key === "synthesis_reviewer") continue;
    const { deps, events } = stub(def);
    const result = await executeAgentTurn(env(def), deps);
    const opsOk = result.proposals.every((p) => p.ops.every((o) => ALLOWED_OPS.has(o.op)));
    const labelsOk = result.claims.every((c) => MOCK_LABELS.has(c.status));
    const workUpdates = events.filter((e) => e.type === "work.update").length;
    ok(`${def.key}: complete + allow-listed ops + honest labels`, result.status === "complete" && opsOk && labelsOk, `status=${result.status} opsOk=${opsOk} labelsOk=${labelsOk}`);
    ok(`${def.key}: emitted work updates`, workUpdates >= 1, `workUpdates=${workUpdates}`);
    // Every full set_section must satisfy w1's real reducer schema — this is the
    // exact validation w2's applyProposal runs, so mock content that would be
    // rejected in a live graph is caught here (e.g. a stakeholder missing name).
    const sectionErrors: string[] = [];
    for (const p of result.proposals) {
      for (const o of p.ops as Array<{ op: string; step?: unknown; content?: unknown }>) {
        if (o.op === "set_section") {
          const v = validateSectionContent(o.step as never, o.content);
          if (!v.ok) sectionErrors.push(`${String(o.step)}: ${v.errors.slice(0, 3).join("; ")}`);
        }
      }
    }
    ok(`${def.key}: set_section content valid vs w1 schema`, sectionErrors.length === 0, sectionErrors.join(" | "));
  }

  // research director selects a specialist pair via handoffs.
  {
    const def = agentDef("research_director");
    const { deps } = stub(def);
    const result = await executeAgentTurn(env(def), deps);
    const specialistHandoffs = result.proposals.length; // sanity
    ok("research director emits 2 section proposals", result.proposals.filter((p) => p.ops.some((o) => o.op === "set_section")).length >= 2, `n=${specialistHandoffs}`);
    ok("research director hands off to 2 specialists", result.handoffs.filter((h) => ["local_government", "parliamentary", "public_body", "planning", "local_media", "precedent_opposition"].includes(h.toAgentKey)).length === 2);
  }

  // adjudicator emits a claim decision set.
  {
    const def = agentDef("evidence_adjudicator");
    const { deps } = stub(def);
    const result = await executeAgentTurn(env(def), deps);
    ok("adjudicator returns claimDecisions", !!result.claimDecisions && result.claimDecisions.decisions.length > 0);
  }

  // 6b) LIVE-path power name coercion: a model output whose stakeholders lack
  // `name` must be repaired by the power contract's normalizeContent (falling
  // back name→role→org, never inventing a person) so w1's reducer accepts it.
  console.log("Live power name coercion:");
  {
    const def = agentDef("power_stakeholder");
    const contract = getAgentContract("power_stakeholder");
    const raw = {
      workSummary: "x",
      confidence: "medium",
      unknowns: [],
      claims: [],
      evidenceClaimRefs: [],
      handoffs: [],
      power: {
        stakeholders: [
          { org: "Leicester City Council", role: "Cabinet lead for transport", tier: "decides", power: "High", position: "Unknown", positionStatus: "Campaign assumption", ask: "Meet us" },
          { org: "Residents' association", tier: "resists", power: "Low", position: "Opposed", positionStatus: "Campaign assumption", ask: "Hear concerns" },
        ],
        statusQuoCost: "Ongoing risk at the gate.",
      },
    };
    const body = contract.toResult(raw as Record<string, unknown>, { envelope: env(def), def });
    const op = body.proposals.flatMap((p) => p.ops).find((o) => o.op === "set_section") as
      | { op: string; step: string; content: Record<string, unknown> }
      | undefined;
    const list = (op?.content?.stakeholders ?? []) as Array<Record<string, unknown>>;
    ok("nameless stakeholder gets role as name", list[0]?.name === "Cabinet lead for transport");
    ok("role-less stakeholder falls back to org", list[1]?.name === "Residents' association");
    const v = op ? validateSectionContent(op.step as never, op.content) : { ok: false, errors: ["no set_section op"] };
    ok("coerced power content passes w1 schema", v.ok, v.errors.slice(0, 3).join("; "));
  }

  // 7) mock reviewer accepts all proposals.
  console.log("Mock reviewer:");
  {
    const def = agentDef("synthesis_reviewer");
    const { deps } = stub(def);
    const proposals: ChangeProposal[] = [
      { id: "p1", campaignId: "camp-1", agentRunId: "ar-x", baseStateVersion: 0, summary: "objective", ops: [{ op: "set_section", step: "objective", content: {}, evidenceClaimIds: [] }], assumptions: [], status: "submitted" },
    ];
    const outcome = await runSynthesisReview(
      { campaignId: "camp-1", reviewerAgentRunId: "reviewer-1", pass: "analysis", journeySteps: [3], proposals },
      deps,
    );
    ok("reviewer returns one review per proposal", outcome.reviews.length === 1);
    ok("reviewer accepts in mock", outcome.reviews[0].decision === "accept");
    ok("reviewer writes a step report", (outcome.reviews[0].stepReport ?? "").length > 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("CHECK CRASHED:", e);
  process.exit(1);
});
