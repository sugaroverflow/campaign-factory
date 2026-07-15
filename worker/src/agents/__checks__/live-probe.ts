// TEMPORARY live diagnostic probe (coordinator-authorized, budget-capped).
// Runs ONE live research_director turn through the real executeAgentTurn with
// FACTORY_DIAG=1 to capture the raw provider exception that the product path
// sanitizes. Standalone: stubbed sql/gate/emit, no worker, no DB writes.
// Run: FACTORY_DIAG=1 npx tsx src/agents/__checks__/live-probe.ts

import { readFileSync } from "node:fs";
import { executeAgentTurn } from "../executor.js";
import type { EmitFragment, ExecutorDeps } from "../deps.js";
import { agentDef } from "@web/lib/factory/contracts/roster.js";
import type { AgentTaskEnvelope } from "@web/lib/factory/contracts/index.js";
import { validateSectionContent } from "@web/lib/factory/state/sections.js";

const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

function loadApiKey(): string {
  const env = readFileSync(new URL("../../../../web/.env.local", import.meta.url), "utf8");
  const m = env.match(/^ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)"?\s*$/m);
  if (!m) throw new Error("ANTHROPIC_API_KEY not found in web/.env.local");
  return m[1].trim();
}

// ---- stub sql: tagged template; synthesizes just enough rows -------------
const PROBE_STATE = {
  campaignId: "camp-live-probe",
  version: 0,
  problem:
    "Parents want a timed school street (motor-traffic restriction at drop-off and pick-up) on the road outside St John the Baptist CofE Primary School to improve child safety and air quality.",
  place: "Leicester (Leicester City Council)",
  sections: {},
};
let srcN = 0;
const sqlStub = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const q = strings.join(" $ ");
  if (q.includes("campaign_state_versions")) return [{ state: PROBE_STATE }];
  if (q.includes("insert into factory.sources")) {
    // values order mirrors recordSource's insert column list.
    srcN++;
    const [id, campaign_id, url, title, organisation, published_at, accessed_at, tier, is_primary, media_type, content_hash, retrieval_status] = values;
    return [{ id: id ?? `src_probe_${srcN}`, campaign_id, url, title, organisation, published_at, accessed_at, tier, is_primary, media_type, content_hash, retrieval_status }];
  }
  return [];
}) as unknown as ExecutorDeps["sql"];

// ---- deps -----------------------------------------------------------------
const controller = new AbortController();
let totalCost = 0;
const eventCounts = new Map<string, number>();

const deps: ExecutorDeps = {
  emit: async (f: EmitFragment) => {
    eventCounts.set(f.type, (eventCounts.get(f.type) ?? 0) + 1);
    const p = f.payload as { summary?: string; verb?: string };
    console.log(`[${ts()}] EVENT ${f.type} :: ${p?.summary ?? ""}`);
    return {
      eventId: "e",
      sequence: 0,
      campaignId: "camp-live-probe",
      type: f.type,
      at: new Date().toISOString(),
      visibility: f.visibility ?? "public",
      payload: f.payload,
    };
  },
  gate: { acquire: async () => () => {} },
  sql: sqlStub,
  recordUsage: async (u) => {
    totalCost += u.costUSD;
    console.log(
      `[${ts()}] USAGE ${u.model} in=${u.inputTokens} out=${u.outputTokens} cost=$${u.costUSD.toFixed(4)} total=$${totalCost.toFixed(4)}`,
    );
    if (totalCost > 0.8) {
      console.error(`[${ts()}] BUDGET GUARD: total cost > $0.80 — aborting probe`);
      controller.abort();
    }
  },
  agentDef: agentDef("research_director"),
  modelMode: "live",
  signal: controller.signal,
  apiKey: loadApiKey(),
  now: () => new Date(),
};

const envelope: AgentTaskEnvelope = {
  campaignId: "camp-live-probe",
  agentRunId: "ar-live-probe",
  stateVersion: 0,
  journeySteps: [1, 2],
  task:
    "Scope this campaign: refine the problem statement, name the required place and authority, set the research questions, and select exactly two research specialists from the catalogue. Intake: 'We want the council to stop cars driving past St John the Baptist Primary School in Leicester at school run times — it is dangerous and the air is terrible.'",
  contextRefs: [],
  evidenceRefs: [],
  constraints: [],
  toolPolicy: "search_discovery",
  deadlineAt: new Date(Date.now() + 300000).toISOString(),
};

async function main() {
  console.log(`[${ts()}] PROBE start: live research_director turn (diag=${process.env.FACTORY_DIAG})`);
  const result = await executeAgentTurn(envelope, deps);
  console.log(`\n[${ts()}] RESULT status=${result.status}`);
  console.log(`  workSummary: ${result.workSummary.slice(0, 300)}`);
  console.log(`  claims=${result.claims.length} proposals=${result.proposals.length} handoffs=${result.handoffs.length} unknowns=${result.unknowns.length}`);
  for (const p of result.proposals) {
    for (const o of p.ops as Array<{ op: string; step?: string; content?: unknown }>) {
      let valid = "";
      if (o.op === "set_section") {
        const v = validateSectionContent(o.step as never, o.content);
        valid = v.ok ? " [valid vs w1 schema]" : ` [INVALID: ${v.errors.slice(0, 2).join("; ")}]`;
      }
      console.log(`  op ${o.op} step=${o.step ?? "-"}${valid}`);
    }
  }
  for (const h of result.handoffs) console.log(`  handoff -> ${h.toAgentKey}`);
  console.log(`  events: ${[...eventCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  TOTAL COST: $${totalCost.toFixed(4)}`);
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch((e) => {
  console.error(`[${ts()}] PROBE CRASHED:`, e);
  console.log(`  TOTAL COST: $${totalCost.toFixed(4)}`);
  process.exit(2);
});
