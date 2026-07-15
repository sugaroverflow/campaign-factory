// Invisible QA supplement (parameters §5). NOT an agent: it owns no campaign
// responsibility, emits no agent Factory Events, and returns flags only. The
// deterministic checks run first (schema validity, citation-reference
// integrity, label-enum validity, the load-bearing source rule). A single
// claude-haiku-4-5 pass (no thinking, 3000 output tokens) then flags contract /
// citation / generic-language / verification-marker problems. In mock mode the
// Haiku pass is skipped (deterministic only) so the graph makes zero model
// calls. Flags are attached to the proposal for the reviewer.

import { call, getClient, parseJSONLoose, textOf } from "@web/lib/anthropic.js";
import { isVerificationLabel } from "@web/lib/pipeline/labels.js";
import { costUSD, type Usage } from "@web/lib/spend/pricing.js";
import type { AgentDef, AgentResult, ChangeProposalDraft } from "@web/lib/factory/contracts/index.js";
import type { ExecutorDeps } from "./deps.js";

export type QAKind = "schema" | "contract" | "citation" | "generic_language" | "verification_marker";

export interface QAFlag {
  kind: QAKind;
  severity: "block" | "warn";
  message: string;
}

export interface QAInput {
  result: AgentResult;
  def: AgentDef;
  campaignId: string;
  agentRunId: string;
  batchId?: string;
}

const CLAIM_REF = /^c(\d+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function proposalEvidenceRefs(p: ChangeProposalDraft): string[] {
  const refs: string[] = [];
  for (const op of p.ops) {
    if (op.op === "set_section" || op.op === "merge_section" || op.op === "set_pack") refs.push(...op.evidenceClaimIds);
    else if (op.op === "add_next_check" && op.check.claimIds) refs.push(...op.check.claimIds);
  }
  return refs;
}

/** Deterministic checks — cheap, run always, never make a model call. */
export function deterministicQA(result: AgentResult): QAFlag[] {
  const flags: QAFlag[] = [];
  const claimCount = result.claims.length;

  // Label-enum validity + load-bearing source rule.
  result.claims.forEach((c, i) => {
    if (!isVerificationLabel(c.status)) {
      flags.push({ kind: "schema", severity: "block", message: `claim ${i + 1} has an off-vocabulary verification label: ${String(c.status)}` });
    }
    if (c.loadBearing && c.status === "Verified public information" && c.sourceIds.length === 0) {
      flags.push({
        kind: "verification_marker",
        severity: "block",
        message: `load-bearing claim ${i + 1} is labelled "Verified public information" but cites no source`,
      });
    }
  });
  result.claimDecisions?.decisions.forEach((d, i) => {
    if (!isVerificationLabel(d.resultingLabel)) {
      flags.push({ kind: "schema", severity: "block", message: `claim decision ${i + 1} has an off-vocabulary resulting label` });
    }
  });

  // Citation-reference integrity: every evidence ref is either a c{n} within the
  // claims array or an existing claim id (uuid). Anything else is dangling.
  for (const p of result.proposals) {
    for (const ref of proposalEvidenceRefs(p)) {
      const m = CLAIM_REF.exec(ref);
      if (m) {
        const n = Number(m[1]);
        if (n < 1 || n > claimCount) {
          flags.push({ kind: "citation", severity: "block", message: `proposal references ${ref} but only ${claimCount} claim(s) were produced` });
        }
      } else if (!UUID.test(ref)) {
        flags.push({ kind: "citation", severity: "warn", message: `proposal evidence ref "${ref}" is neither a c{n} local ref nor a claim id` });
      }
    }
  }
  return flags;
}

const QA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["flags"],
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "severity", "message"],
        properties: {
          kind: { type: "string", enum: ["contract", "citation", "generic_language", "verification_marker"] },
          severity: { type: "string", enum: ["block", "warn"] },
          message: { type: "string" },
        },
      },
    },
  },
} as const;

const QA_SYSTEM = `You are an invisible QA checker for Campaign Factory. You are given one agent's structured output. Report problems only — do NOT rewrite anything. Check for:
- contract: the output does not do the agent's job, or presents inference/opinion as verified fact;
- citation: a specific figure, date, named person, or quote stated as fact with no supporting claim/source reference or verification placeholder;
- generic_language: vague campaign boilerplate not specific to the researched place, institution, or decision;
- verification_marker: an unverifiable specific that should be a [VERIFY: …] placeholder but is stated as fact, OR a fabricated-looking exact detail (precise statistic, named individual, exact date) not traceable to a claim.
Return ONLY JSON matching the schema. If there are no problems, return {"flags": []}.`;

function summariseForQA(result: AgentResult): string {
  const claims = result.claims
    .map((c, i) => `c${i + 1} [${c.status}${c.loadBearing ? ", load-bearing" : ""}] ${c.text}${c.sourceIds.length ? ` (src ${c.sourceIds.join(",")})` : " (no source)"}`)
    .join("\n");
  const proposals = result.proposals
    .map((p) => {
      const ops = p.ops
        .map((op) => {
          if (op.op === "set_section" || op.op === "merge_section")
            return `${op.op} ${op.step}: ${safe(op.op === "set_section" ? op.content : op.patch).slice(0, 1500)}`;
          if (op.op === "set_pack") return `set_pack ${op.document}: ${safe(op.resources).slice(0, 1500)}`;
          if (op.op === "add_next_check") return `add_next_check: ${op.check.description}`;
          return `record_terminal_gap: ${op.description}`;
        })
        .join("\n");
      return `PROPOSAL — ${p.summary}\n${ops}`;
    })
    .join("\n\n");
  return `WORK SUMMARY: ${result.workSummary}\n\nCLAIMS:\n${claims || "(none)"}\n\nPROPOSALS:\n${proposals || "(none)"}\n\nUNKNOWNS: ${result.unknowns.join("; ") || "(none)"}`;
}
function safe(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Full QA: deterministic checks + (live mode only) a Haiku pass. Never throws —
 * a QA failure degrades to the deterministic flags so it can never block the
 * pipeline. Makes zero model calls in mock mode.
 */
export async function runInvisibleQA(input: QAInput, deps: ExecutorDeps): Promise<QAFlag[]> {
  const flags = deterministicQA(input.result);
  if (deps.modelMode === "mock" || deps.signal.aborted) return flags;

  try {
    const client = getClient(deps.apiKey);
    // The Haiku pass is a model call like any other: it goes through the
    // concurrency gate so QA cannot exceed the campaign/global call caps.
    const release = await deps.gate.acquire({
      campaignId: input.campaignId,
      mode: input.batchId ? "presenter" : "public",
      kind: "model",
    });
    let msg;
    try {
      msg = await call(
        client,
        {
          model: "claude-haiku-4-5",
          max_tokens: 3000,
          system: QA_SYSTEM,
          messages: [{ role: "user", content: summariseForQA(input.result) }],
          jsonSchema: QA_SCHEMA as unknown as Record<string, unknown>,
        },
        {
          onUsage: (model: string, usage: Usage) =>
            void deps
              .recordUsage({
                campaignId: input.campaignId,
                batchId: input.batchId,
                agentRunId: input.agentRunId,
                model,
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
                costUSD: costUSD(model, usage),
              })
              .catch((err) => console.error("[agents] QA recordUsage failed:", err)),
        },
      );
    } finally {
      release();
    }
    const parsed = parseJSONLoose<{ flags?: Array<Partial<QAFlag>> }>(textOf(msg));
    const kinds = new Set<QAKind>(["contract", "citation", "generic_language", "verification_marker"]);
    for (const f of parsed.flags ?? []) {
      if (typeof f.message !== "string" || !f.message) continue;
      flags.push({
        kind: kinds.has(f.kind as QAKind) ? (f.kind as QAKind) : "contract",
        severity: f.severity === "block" ? "block" : "warn",
        message: f.message,
      });
    }
  } catch {
    // Haiku unavailable / failed — deterministic flags stand.
  }
  return flags;
}
