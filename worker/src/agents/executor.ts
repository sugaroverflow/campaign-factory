// executeAgentTurn — the entry point W2's graph calls for every producing/
// research/analysis agent (NOT the synthesis reviewer; that uses reviewer.ts).
// Responsibilities: assemble bounded context from accepted state + referenced
// claims/sources (never the raw event log); route model+effort per roster;
// acquire the concurrency gate around the model call; run the turn with one
// visible operational retry; emit work/source/evidence Factory Events; and map
// the model output into the frozen AgentResult via the agent's contract. In
// mock mode it delegates to mock.ts and makes zero model calls.

import type {
  AgentKey,
  AgentResult,
  AgentTaskEnvelope,
  AgentTerminalStatus,
} from "@web/lib/factory/contracts/index.js";
// Value import direct from its module (contracts barrel uses `export *`).
import { JOURNEY_STEPS } from "@web/lib/factory/contracts/journey.js";
import { getAgentContract, type AgentResultBody } from "@web/lib/factory/agents/index.js";
import { getClaims, getSources } from "@web/lib/factory/store/evidence.js";
import { getAcceptedState } from "@web/lib/factory/store/state-versions.js";
import type { AgentDef } from "@web/lib/factory/contracts/index.js";
import type { AgentTurnFn, ExecutorDeps } from "./deps.js";
import { buildTools } from "./gateway.js";
import {
  diag,
  EmptyOutputError,
  runModelTurn,
  TurnAbortedError,
  TurnTimeoutError,
  type ModelTurnResult,
  type ModelTurnSpec,
} from "./model-call.js";
import { WorkEmitter } from "./work.js";
import { mockAgentTurn } from "./mock.js";

export const executeAgentTurn: AgentTurnFn = async (envelope, deps) => {
  const def = deps.agentDef;
  const journeyStep = envelope.journeySteps[0];
  const work = new WorkEmitter(deps, def.key, journeyStep);

  if (deps.modelMode === "mock") {
    return mockAgentTurn(envelope, deps, work);
  }

  const contract = getAgentContract(def.key as AgentKey);
  const mode: "public" | "presenter" = envelope.batchId ? "presenter" : "public";
  const kind: "model" | "research" = def.toolPolicy === "none" ? "model" : "research";
  const release = await deps.gate.acquire({ campaignId: envelope.campaignId, mode, kind });
  try {
    const contextExtracts = await assembleContext(envelope, deps, def);
    const { tools } = buildTools(def);
    const spec: ModelTurnSpec = {
      system: contract.system(def),
      userText: contract.userMessage(envelope, contextExtracts),
      schema: contract.schema,
      structuredOutput: contract.structuredOutput,
      model: def.model,
      effort: def.effort,
      adaptiveThinking: def.model !== "claude-haiku-4-5", // Haiku has no adaptive thinking
      maxOutputTokens: def.maxOutputTokens,
      timeoutMs: def.timeoutMs,
      tools,
      def,
      campaignId: envelope.campaignId,
      agentRunId: envelope.agentRunId,
      batchId: envelope.batchId,
      journeyStep,
      work,
    };

    let turn: ModelTurnResult | null;
    try {
      turn = await runWithOperationalRetry(spec, deps, work, envelope.deadlineAt);
    } catch (e) {
      if (e instanceof EmptyOutputError) {
        // The model produced empty content twice (model-call already ran its
        // explicit correction retry). Fail the turn with a distinct reason
        // rather than submitting an empty proposal for the reviewer to reject.
        work.work("Empty output — no proposal submitted", "failed");
        work.flush();
        return failedResult(envelope, "The agent produced empty output twice; its proposal was withheld.", "empty_output");
      }
      throw e;
    }
    if (!turn) {
      work.flush();
      return failedResult(envelope, "The agent could not complete after a retry (timeout or provider failure).");
    }
    const body = contract.toResult(turn.raw, { envelope, def });
    await emitEvidenceEvents(body, deps, journeyStep, def.key);
    work.flush();
    return { agentRunId: envelope.agentRunId, status: terminalStatus(body), ...body };
  } finally {
    release();
    work.flush();
  }
};

// Operational retries on timeout / provider failure. Cancellation
// (TurnAbortedError) and empty output (EmptyOutputError — model-call already
// retried in-turn) are rethrown, never retried. Three rungs (user, 16 Jul):
// 1. OVERLOAD (429 rate_limit / 529 overloaded): up to two further attempts
//    after a short jittered wait (5–15s, or the provider's retry-after when
//    under 20s) — the 16 Jul Sonnet burst cleared within a minute, so a
//    patient retry succeeds where an instant one just re-fails.
// 2. Other failures keep the single instant retry. A timeout consumes the
//    whole envelope window (raw headroom ~0), so it gets one fresh window
//    capped at MAX_RETRY_TIMEOUT_MS; provider errors fail fast and keep their
//    real headroom. Under 30s of headroom the retry is skipped.
// 3. LAST RESORT, public/audience runs only (never presenter batches — stage
//    tempo stays predictable): when every attempt failed on a provider error
//    (not a timeout) and the agent runs on Sonnet, one final attempt runs on
//    claude-opus-4-8 — the alternative is a terminal gap mid-session.
// Returns null after failed/skipped retries so the caller emits a failed
// result rather than crash the node.
const MIN_RETRY_HEADROOM_MS = 30_000;
const MAX_RETRY_TIMEOUT_MS = 120_000;
const OVERLOAD_EXTRA_ATTEMPTS = 2;
const OVERLOAD_MAX_WAIT_MS = 20_000;
const FALLBACK_MODEL = "claude-opus-4-8";
const MIN_FALLBACK_HEADROOM_MS = 45_000;

function isOverloadError(e: unknown): boolean {
  const err = e as { status?: unknown; error?: { type?: unknown }; message?: unknown } | null;
  const status = typeof err?.status === "number" ? err.status : undefined;
  const type = err?.error && typeof err.error === "object" ? (err.error as { type?: unknown }).type : undefined;
  if (status === 429 || status === 529 || type === "rate_limit_error" || type === "overloaded_error") return true;
  // Observed 16 Jul (Sonnet incident): the client wrapper rethrows a plain
  // Error whose MESSAGE is the raw JSON body ({"type":"overloaded_error",...},
  // status undefined) — detect that shape too.
  const msg = typeof err?.message === "string" ? err.message : "";
  return msg.includes('"overloaded_error"') || msg.includes('"rate_limit_error"');
}

// Auth/credit failures are NON-retryable: a rejected, revoked, or
// out-of-credits key (Anthropic 401; OpenRouter 401/402/403 on BYOK runs)
// fails identically on every rung, and the Opus fallback would burn the same
// dead key. Fail the turn immediately with an honest gap instead.
function isKeyOrCreditError(e: unknown): boolean {
  const err = e as { status?: unknown; message?: unknown } | null;
  const status = typeof err?.status === "number" ? err.status : undefined;
  if (status === 401 || status === 402 || status === 403) return true;
  const msg = typeof err?.message === "string" ? err.message : "";
  return msg.includes('"authentication_error"') || msg.includes("Insufficient credits");
}

function overloadWaitMs(e: unknown): number {
  const headers = (e as { headers?: unknown })?.headers;
  const raw =
    headers && typeof (headers as { get?: unknown }).get === "function"
      ? (headers as { get: (k: string) => string | null }).get("retry-after")
      : headers && typeof headers === "object"
        ? (headers as Record<string, string>)["retry-after"]
        : undefined;
  const retryAfterMs = raw ? Number(raw) * 1000 : NaN;
  const jitteredMs = 5_000 + Math.random() * 10_000;
  const wait = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : jitteredMs;
  return Math.min(Math.max(wait, 1_000), OVERLOAD_MAX_WAIT_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runWithOperationalRetry(
  spec: ModelTurnSpec,
  deps: ExecutorDeps,
  work: WorkEmitter,
  deadlineAt?: string,
): Promise<ModelTurnResult | null> {
  const headroomNow = () => {
    const nowMs = (deps.now?.() ?? new Date()).getTime();
    const deadlineMs = deadlineAt ? Date.parse(deadlineAt) : NaN;
    return Number.isFinite(deadlineMs) ? deadlineMs - nowMs : spec.timeoutMs;
  };
  const emitRetry = (summary: string) => {
    deps
      .emit({
        type: "agent.retry",
        journeyStep: spec.journeyStep,
        payload: { summary, verb: "retrying", agentKey: spec.def.key },
      })
      .catch((err) => console.error(`[agents] ${spec.def.key}: agent.retry emit failed:`, err));
    work.work(summary, "retrying");
  };

  // Rung 1: attempt 1 plus patient overload re-attempts.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 1 + OVERLOAD_EXTRA_ATTEMPTS; attempt++) {
    try {
      const timeoutMs = attempt === 1 ? spec.timeoutMs : Math.min(spec.timeoutMs, Math.max(headroomNow(), MIN_RETRY_HEADROOM_MS));
      return await runModelTurn(attempt === 1 ? spec : { ...spec, timeoutMs }, deps);
    } catch (e) {
      diag(`${spec.def.key} attempt ${attempt} failed`, e);
      if (e instanceof TurnAbortedError || e instanceof EmptyOutputError) throw e;
      lastError = e;
      if (isKeyOrCreditError(e)) {
        work.work("The API key for this run was rejected or is out of credits — not retrying", "failed");
        return null;
      }
      if (!isOverloadError(e) || attempt >= 1 + OVERLOAD_EXTRA_ATTEMPTS) break;
      const waitMs = overloadWaitMs(e);
      if (headroomNow() - waitMs < MIN_RETRY_HEADROOM_MS) break;
      emitRetry(
        `Model overloaded — waiting ${Math.round(waitMs / 1000)}s before retrying (attempt ${attempt + 1} of ${1 + OVERLOAD_EXTRA_ATTEMPTS})`,
      );
      await sleep(waitMs);
    }
  }

  // Rung 2: the single generic retry — overload failures already spent their
  // patient attempts above, so they skip straight to the last resort.
  if (!isOverloadError(lastError)) {
    const headroomMs =
      lastError instanceof TurnTimeoutError ? Math.min(spec.timeoutMs, MAX_RETRY_TIMEOUT_MS) : headroomNow();
    if (headroomMs >= MIN_RETRY_HEADROOM_MS) {
      emitRetry(`Retrying after ${lastError instanceof TurnTimeoutError ? "a timeout" : "a provider error"}`);
      try {
        return await runModelTurn({ ...spec, timeoutMs: Math.min(spec.timeoutMs, headroomMs) }, deps);
      } catch (e2) {
        diag(`${spec.def.key} attempt 2 failed`, e2);
        if (e2 instanceof TurnAbortedError || e2 instanceof EmptyOutputError) throw e2;
        lastError = e2;
      }
    } else {
      diag(`${spec.def.key} retry skipped`, new Error(`${headroomMs}ms left before envelope deadline`));
    }
  }

  // Rung 3: cross-model last resort — public runs on Sonnet, provider errors
  // only (an Opus attempt after a Sonnet timeout would be slower still).
  const presenterBatch = Boolean(spec.batchId);
  const fallbackTimeoutMs = Math.min(headroomNow(), spec.timeoutMs);
  if (
    !presenterBatch &&
    spec.model.includes("sonnet") &&
    !(lastError instanceof TurnTimeoutError) &&
    fallbackTimeoutMs >= MIN_FALLBACK_HEADROOM_MS
  ) {
    emitRetry("Provider errors persist — final attempt on a backup model (Claude Opus)");
    try {
      return await runModelTurn({ ...spec, model: FALLBACK_MODEL, timeoutMs: fallbackTimeoutMs }, deps);
    } catch (e3) {
      diag(`${spec.def.key} ${FALLBACK_MODEL} fallback failed`, e3);
      if (e3 instanceof TurnAbortedError || e3 instanceof EmptyOutputError) throw e3;
    }
  }
  return null;
}

// Bounded context: problem + place, accepted (or in-review) sections with their
// Step Reports, referenced claims, and their sources — trimmed to the roster
// inputTokenBudget. Never the raw event log; never all source bodies.
async function assembleContext(envelope: AgentTaskEnvelope, deps: ExecutorDeps, def: AgentDef): Promise<string> {
  const state = await getAcceptedState(deps.sql, envelope.campaignId);
  const budgetChars = Math.max(2000, def.inputTokenBudget * 4);
  const parts: string[] = [`PROBLEM: ${state.problem}`, `PLACE: ${state.place}`, `Accepted state version: ${state.version}`];

  const secParts: string[] = [];
  for (const s of JOURNEY_STEPS) {
    const sec = state.sections?.[s.key];
    if (!sec || sec.status === "empty") continue;
    if (!sec.content && sec.status !== "accepted" && sec.status !== "needs_verification") continue;
    secParts.push(
      `--- SECTION ${s.step} ${s.key} [${sec.status}] ---\n${compact(sec.content, 3000)}${
        sec.stepReport ? `\nStep report: ${sec.stepReport}` : ""
      }`,
    );
  }
  if (secParts.length) parts.push(`ACCEPTED SECTIONS:\n${secParts.join("\n\n")}`);

  const claimIds = envelope.evidenceRefs?.length ? envelope.evidenceRefs : undefined;
  const claims = await getClaims(deps.sql, envelope.campaignId, claimIds);
  if (claims.length) {
    const shown = claims.slice(0, 60);
    parts.push(
      `EVIDENCE CLAIMS:\n${shown
        .map(
          (c) =>
            `- [${c.status}${c.loadBearing ? ", load-bearing" : ""}] ${c.text}${
              c.sourceIds.length ? ` (sources: ${c.sourceIds.join(", ")})` : ""
            }`,
        )
        .join("\n")}`,
    );
    const srcIds = Array.from(new Set(shown.flatMap((c) => c.sourceIds)));
    if (srcIds.length) {
      const sources = await getSources(deps.sql, envelope.campaignId, srcIds);
      if (sources.length) {
        parts.push(
          `SOURCES:\n${sources
            .map((s) => `- ${s.id} [tier ${s.tier}, ${s.retrievalStatus}] ${s.title} — ${s.organisation} (${s.url})`)
            .join("\n")}`,
        );
      }
    }
  }

  let text = parts.join("\n\n");
  if (text.length > budgetChars) text = `${text.slice(0, budgetChars)}\n\n[context truncated to fit the agent's input budget]`;
  return text;
}

function compact(content: unknown, cap: number): string {
  if (content == null) return "(empty)";
  let s: string;
  try {
    s = typeof content === "string" ? content : JSON.stringify(content);
  } catch {
    s = String(content);
  }
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

async function emitEvidenceEvents(
  body: AgentResultBody,
  deps: ExecutorDeps,
  journeyStep: number | undefined,
  agentKey: string,
): Promise<void> {
  if (body.claims.length) {
    const lb = body.claims.filter((c) => c.loadBearing).length;
    await deps.emit({
      type: "evidence.found",
      journeyStep,
      payload: {
        summary: `Recorded ${body.claims.length} claim${body.claims.length === 1 ? "" : "s"}${lb ? `, ${lb} load-bearing` : ""}`,
        verb: "recorded",
        agentKey,
      },
    });
    await emitPerClaimRows(body.claims, deps, journeyStep, agentKey);
  }
  if (body.conflict) {
    await deps.emit({
      type: "evidence.conflicted",
      journeyStep,
      payload: { summary: `Conflict: ${body.conflict.description.slice(0, 140)}`, verb: "flagged", agentKey, claimIds: body.conflict.claimIds },
    });
  }
  const gaps = body.claimDecisions?.gaps.length ?? 0;
  if (gaps) {
    await deps.emit({ type: "evidence.gap", journeyStep, payload: { summary: `${gaps} evidence gap${gaps === 1 ? "" : "s"} remain`, verb: "flagged", agentKey } });
  } else if (body.unknowns.length) {
    await deps.emit({
      type: "evidence.gap",
      journeyStep,
      payload: { summary: `${body.unknowns.length} open question${body.unknowns.length === 1 ? "" : "s"}`, verb: "flagged", agentKey },
    });
  }
}

// Per-claim evidence rows for the agent card backscroll: a ≤200-char excerpt of
// each claim plus its verification label. The fold counts every evidence.found
// event in the run's evidence tally, so per-claim evidence.found events would
// inflate it — these go out as work.update rows (payload.summary + verb only)
// instead, and the aggregate evidence.found above stays authoritative. Batched
// (3 claims per row; 5 when more than 10 claims) and paced ~600ms apart to stay
// under the emitter's 2 work.update/sec cap; capped at 5 rows with a remainder
// note so one prolific agent cannot flood the backscroll.
const CLAIM_EXCERPT_CHARS = 200;
const MAX_CLAIM_ROWS = 5;
const CLAIM_ROW_SPACING_MS = 600;

function claimLine(c: AgentResultBody["claims"][number]): string {
  const excerpt = c.text.replace(/\s+/g, " ").trim().slice(0, CLAIM_EXCERPT_CHARS);
  return `“${excerpt}” — ${c.status}`;
}

async function emitPerClaimRows(
  claims: AgentResultBody["claims"],
  deps: ExecutorDeps,
  journeyStep: number | undefined,
  agentKey: string,
): Promise<void> {
  const size = claims.length > 10 ? 5 : 3;
  const groups: string[][] = [];
  for (let i = 0; i < claims.length; i += size) {
    groups.push(claims.slice(i, i + size).map(claimLine));
  }
  const shown = groups.slice(0, MAX_CLAIM_ROWS);
  const remainder = claims.length - shown.reduce((n, g) => n + g.length, 0);
  for (let i = 0; i < shown.length; i++) {
    if (deps.signal.aborted) return;
    if (i > 0) await sleepMs(CLAIM_ROW_SPACING_MS);
    const suffix =
      i === shown.length - 1 && remainder > 0 ? ` · …and ${remainder} more claim${remainder === 1 ? "" : "s"}` : "";
    await deps.emit({
      type: "work.update",
      journeyStep,
      payload: { summary: `${shown[i].join("  ·  ")}${suffix}`, verb: "recording", agentKey },
    });
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });
}

function terminalStatus(body: AgentResultBody): AgentTerminalStatus {
  // A turn that produced neither a proposal nor a claim decision is partial.
  if (body.proposals.length === 0 && !body.claimDecisions) return "partial";
  return "complete";
}

// `code` gives the failure a machine-greppable marker (e.g. "empty_output") so
// downstream consumers can distinguish it from operational failures.
function failedResult(envelope: AgentTaskEnvelope, reason: string, code?: string): AgentResult {
  const summary = code ? `${reason} (${code})` : reason;
  return {
    agentRunId: envelope.agentRunId,
    status: "failed",
    workSummary: summary,
    claims: [],
    proposals: [],
    unknowns: [summary],
    confidence: "low",
    handoffs: [],
  };
}
