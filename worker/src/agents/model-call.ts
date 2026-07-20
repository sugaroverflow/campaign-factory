// Shared low-level model invocation. Reuses web/anthropic.ts for streaming,
// pause_turn resume (web_search server tool), structured output, and the usage
// sink. Adds: the fetch_page client-tool loop (one agent identity across turns),
// a roster-timeout + cancellation guard that aborts the underlying request via
// AbortController (CallOptions.signal), one automatic
// correction retry on invalid structured output, per-call usage recording, and
// per-search Factory Events. The visible operational retry (timeout/provider)
// lives one level up, in the executor / reviewer.

import type Anthropic from "@anthropic-ai/sdk";
import { call, getClient, parseJSONLoose, textOf } from "@web/lib/anthropic.js";
import type { Effort } from "@web/lib/pipeline/models.js";
import { costUSD, WEB_SEARCH_COST_USD, type Usage } from "@web/lib/spend/pricing.js";
import { validateAgainst, type JSchema } from "@web/lib/factory/agents/index.js";
import type { AgentDef } from "@web/lib/factory/contracts/index.js";
import type { ExecutorDeps } from "./deps.js";
import { fetchPage } from "./gateway.js";
import type { WorkEmitter } from "./work.js";

export class TurnTimeoutError extends Error {}
export class TurnAbortedError extends Error {}
// The model produced effectively-empty content twice (initial + explicit
// correction retry). Callers map this to a failed result with a distinct
// "empty_output" reason instead of submitting an empty proposal.
export class EmptyOutputError extends Error {}

/**
 * TEMPORARY diagnostic tap (env-gated): with FACTORY_DIAG=1 the raw provider
 * exception is printed to stderr, including the API error body/status that the
 * product path deliberately sanitizes out of events and logs. Production
 * behaviour is unchanged when the env var is unset.
 */
export function diag(tag: string, e: unknown): void {
  if (process.env.FACTORY_DIAG !== "1") return;
  const a = e as { name?: string; status?: number; message?: string; error?: unknown; cause?: unknown; headers?: unknown };
  console.error(`[FACTORY_DIAG] ${tag}: name=${a?.name} status=${a?.status} message=${a?.message}`);
  if (a?.error !== undefined) {
    try {
      console.error(`[FACTORY_DIAG] ${tag} body: ${JSON.stringify(a.error).slice(0, 4000)}`);
    } catch {
      console.error(`[FACTORY_DIAG] ${tag} body (unserializable):`, a.error);
    }
  }
  if (a?.cause !== undefined) console.error(`[FACTORY_DIAG] ${tag} cause: ${String(a.cause)}`);
}

/**
 * Run one model call under a per-turn deadline and the run's cancellation
 * signal. Unlike a plain promise race, this passes a real AbortSignal INTO the
 * request (via CallOptions.signal), so a timed-out or cancelled turn tears down
 * the underlying HTTP stream instead of leaking it in the background. The abort
 * reason is tracked so the rejection surfaces as the typed error the executor's
 * operational-retry logic branches on (TurnTimeoutError vs TurnAbortedError).
 */
async function runCall<T>(make: (signal: AbortSignal) => Promise<T>, ms: number, parent: AbortSignal): Promise<T> {
  if (parent.aborted) throw new TurnAbortedError("run cancelled");
  const ac = new AbortController();
  let reason: "timeout" | "cancel" | null = null;
  const abortWith = (r: "timeout" | "cancel") => {
    if (reason) return;
    reason = r;
    ac.abort();
  };
  const onParent = () => abortWith("cancel");
  parent.addEventListener("abort", onParent, { once: true });
  const timer = setTimeout(() => abortWith("timeout"), Math.max(1, ms));
  (timer as { unref?: () => void }).unref?.();
  try {
    return await make(ac.signal);
  } catch (e) {
    diag(`runCall (reason=${reason ?? "provider"})`, e);
    if (reason === "timeout") throw new TurnTimeoutError(`model turn exceeded ${ms}ms`);
    if (reason === "cancel") throw new TurnAbortedError("run cancelled");
    throw e;
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onParent);
  }
}

export interface ModelTurnSpec {
  system: string;
  userText: string;
  schema?: JSchema;
  structuredOutput?: boolean;
  model: string;
  effort: Effort;
  adaptiveThinking: boolean;
  maxOutputTokens: number;
  timeoutMs: number;
  tools?: unknown[];
  def: AgentDef;
  campaignId: string;
  agentRunId: string;
  batchId?: string;
  journeyStep?: number;
  work: WorkEmitter;
  maxToolTurns?: number;
}

export interface ModelTurnResult {
  raw: Record<string, unknown>;
  rawText: string;
  searchCount: number;
}

function safeParseObject(text: string): Record<string, unknown> {
  try {
    const v = parseJSONLoose<unknown>(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// "Effectively empty": no string leaf anywhere carries non-whitespace content.
// Catches both the tolerant-parse {} fallback and outputs whose builders would
// coerce every content field to an empty string.
function hasContentString(v: unknown): boolean {
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(hasContentString);
  if (v && typeof v === "object") return Object.values(v).some(hasContentString);
  return false;
}
export function isEffectivelyEmpty(parsed: Record<string, unknown>): boolean {
  return !hasContentString(parsed);
}

// Heuristic: the content of the JSON string literal currently open at the end
// of the streamed buffer — the readable prose being written into a field.
// Returns null when the buffer tail is JSON syntax rather than string content.
function trailingStringContent(tail: string): string | null {
  const m = /"((?:[^"\\]|\\.)*)$/.exec(tail);
  if (!m) return null;
  return m[1]
    .replace(/\\[nrt]/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

const cleanSnippet = (s: string, cap = 140): string => s.replace(/\s+/g, " ").trim().slice(-cap);

type Block = { type: string; [k: string]: unknown };

export async function runModelTurn(spec: ModelTurnSpec, deps: ExecutorDeps): Promise<ModelTurnResult> {
  const client = getClient(deps.apiKey, deps.apiProvider);
  const nowMs = () => (deps.now?.() ?? new Date()).getTime();
  const deadline = nowMs() + spec.timeoutMs;
  const remaining = () => deadline - nowMs();

  const logDropped = (what: string) => (err: unknown) =>
    console.error(`[agents] ${spec.def.key}: fire-and-forget ${what} failed:`, err);

  let searchCount = 0;
  // Searches noted since the last usage record, so each call segment's ledger
  // row carries the web searches it actually spent.
  let searchesSinceLastUsage = 0;
  const onUsage = (model: string, usage: Usage) => {
    const webSearches = searchesSinceLastUsage;
    searchesSinceLastUsage = 0;
    deps
      .recordUsage({
        campaignId: spec.campaignId,
        batchId: spec.batchId,
        agentRunId: spec.agentRunId,
        model,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens,
        // Ledger totals sum cost_usd only, so search spend must be priced in
        // here. WEB_SEARCH_COST_USD is per research call of ~4 searches → /4.
        costUSD: costUSD(model, usage) + webSearches * (WEB_SEARCH_COST_USD / 4),
        webSearches: webSearches || undefined,
      })
      .catch(logDropped("recordUsage"));
  };
  const onToolNote = (note: string, verb?: string) => {
    const v = verb ?? "working";
    if (v === "searching") {
      searchCount++;
      searchesSinceLastUsage++;
      deps
        .emit({
          type: "source.search.started",
          journeyStep: spec.journeyStep,
          // note carries the real query, e.g. `Searching: "…"`.
          payload: { summary: note, verb: "searching", agentKey: spec.def.key },
        })
        .catch(logDropped("source.search.started emit"));
    } else if (v === "reading") {
      deps
        .emit({
          type: "source.search.completed",
          journeyStep: spec.journeyStep,
          payload: { summary: "Read search results", verb: "reading", agentKey: spec.def.key },
        })
        .catch(logDropped("source.search.completed emit"));
    }
    spec.work.work(note, v);
  };

  // Live activity feed: surface what the model is generating, throttled to at
  // most one visible update per second (the WorkEmitter coalesces further).
  // JSON outputs never leak brace noise — we show the readable string content
  // currently being written, or fall back to a running character count.
  const progress = { lastAt: 0, sawContent: false, jsonMode: false, chars: 0, textTail: "", thinkTail: "" };
  const resetProgress = () => {
    progress.sawContent = false;
    progress.jsonMode = false;
    progress.chars = 0;
    progress.textTail = "";
    progress.thinkTail = "";
  };
  const onProgress = (kind: "text" | "thinking", delta: string) => {
    if (kind === "text") {
      if (!progress.sawContent) {
        const t = delta.trimStart();
        if (t) {
          progress.sawContent = true;
          progress.jsonMode = t.startsWith("{") || t.startsWith("[");
        }
      }
      progress.chars += delta.length;
      progress.textTail = (progress.textTail + delta).slice(-600);
    } else {
      progress.thinkTail = (progress.thinkTail + delta).slice(-600);
    }
    const t = nowMs();
    if (t - progress.lastAt < 1000) return; // ≤1 progress update/sec per agent
    progress.lastAt = t;
    if (kind === "thinking") {
      const s = cleanSnippet(progress.thinkTail);
      if (s) spec.work.work(`Thinking: "…${s}"`, "thinking");
      return;
    }
    if (progress.jsonMode) {
      const readable = trailingStringContent(progress.textTail);
      const s = readable ? cleanSnippet(readable) : "";
      if (s.length >= 24) spec.work.work(`Writing: "…${s}"`, "writing");
      else spec.work.work(`Drafting output · ${progress.chars.toLocaleString("en-GB")} chars…`, "writing");
      return;
    }
    const s = cleanSnippet(progress.textTail);
    if (s) spec.work.work(`Writing: "…${s}"`, "writing");
  };

  const baseParams = {
    model: spec.model,
    max_tokens: spec.maxOutputTokens,
    system: spec.system,
    effort: spec.effort,
    adaptiveThinking: spec.adaptiveThinking,
    jsonSchema: spec.structuredOutput ? (spec.schema as Record<string, unknown> | undefined) : undefined,
    tools: spec.tools && spec.tools.length ? spec.tools : undefined,
  };
  const opts = { onToolNote, onUsage, onProgress, maxPauseResumes: (spec.def.searchBudget ?? 0) + 3 };

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: spec.userText }];
  const maxToolTurns = spec.maxToolTurns ?? 8;
  let finalText = "";
  // Server tools (web_search_20260209) may run inside a code-execution
  // container; the response then carries a container id that MUST be echoed on
  // any continuation of that turn (e.g. our fetch_page tool_result round), or
  // the API rejects it: 400 "container_id is required when there are pending
  // tool uses generated by code execution with tools."
  let containerId: string | undefined;
  let lastStop: string | null = null;

  for (let turn = 0; turn <= maxToolTurns; turn++) {
    if (remaining() <= 0) throw new TurnTimeoutError(`model turn exceeded ${spec.timeoutMs}ms`);
    resetProgress();
    spec.work.work(turn === 0 ? "Working" : "Reviewing sources", "thinking");
    const msg = await runCall(
      (signal) =>
        call(client, { ...baseParams, messages, container: containerId } as Parameters<typeof call>[1], { ...opts, signal }),
      Math.max(1, remaining()),
      deps.signal,
    );
    containerId = (msg as unknown as { container?: { id?: string } }).container?.id ?? containerId;
    lastStop = msg.stop_reason;
    finalText = textOf(msg);
    const blocks = (msg.content ?? []) as unknown as Block[];
    const toolUses = blocks.filter((b) => b.type === "tool_use");
    if (msg.stop_reason === "tool_use" && toolUses.length) {
      messages.push({ role: "assistant", content: msg.content });
      const results: Block[] = [];
      for (const tu of toolUses) {
        const id = String(tu.id);
        if (tu.name === "fetch_page" && remaining() > 0) {
          const r = await fetchPage((tu.input ?? {}) as Record<string, unknown>, {
            def: spec.def,
            deps,
            agentRunId: spec.agentRunId,
            campaignId: spec.campaignId,
            journeyStep: spec.journeyStep,
          });
          results.push({ type: "tool_result", tool_use_id: id, content: r.toolText });
        } else {
          results.push({ type: "tool_result", tool_use_id: id, content: "[tool unavailable]", is_error: true });
        }
      }
      messages.push({ role: "user", content: results as unknown as Anthropic.MessageParam["content"] });
      continue;
    }
    break;
  }

  let parsed = safeParseObject(finalText);
  const errors = spec.schema ? validateAgainst(spec.schema, parsed) : [];
  const emptyFirst = isEffectivelyEmpty(parsed);
  // A max_tokens stop ALWAYS triggers the correction retry (batch 7 fix): a
  // truncated-yet-parseable output would sail through here only to be rejected
  // by the reviewer downstream ("Truncated mid-sentence") — burning the wave.
  const truncated = lastStop === "max_tokens";
  if ((errors.length || emptyFirst || truncated) && remaining() > 0) {
    spec.work.work(
      emptyFirst
        ? "Output was empty — regenerating"
        : errors.length
          ? "Correcting output format"
          : "Output was cut off — regenerating to fit",
      "fixing",
    );
    messages.push({ role: "assistant", content: finalText.trim() ? finalText : "(empty output)" });
    messages.push({
      role: "user",
      content: `${emptyFirst ? "Your previous output was EMPTY — produce the full content now. Do not return empty strings, empty arrays, or an empty object.\n\n" : ""}${
        errors.length
          ? `Your previous response did not match the required schema. Problems:\n- ${errors.slice(0, 20).join("\n- ")}\n\n`
          : ""
      }${
        truncated
          ? "Your previous response was CUT OFF by the output token limit. Return the COMPLETE JSON object but make every prose field markedly more concise so the whole object fits well within the limit. Do not drop required fields.\n\n"
          : ""
      }Return ONLY the corrected single JSON object — no prose, no fences.`,
    });
    try {
      resetProgress();
      // No `container` here: the correction retry strips `tools`, and the API
      // rejects a container id on requests without the code-execution-backed
      // tools ("Container identifier can only be provided when using the code
      // execution tool"). There are no pending tool uses at correction time —
      // the last assistant turn is plain text — so it is not needed either.
      // The tool loop above, however, may have left tool_use / server_tool_use /
      // tool_result / web_search_tool_result blocks in earlier turns. With
      // `tools` stripped the API 400s on those blocks, so flatten them to plain
      // text before retrying (role alternation is preserved).
      const retryMessages = sanitizeForToollessRetry(messages);
      const msg2 = await runCall(
        (signal) =>
          call(
            client,
            {
              ...baseParams,
              messages: retryMessages,
              tools: undefined,
              // A truncated first attempt would truncate again at the same
              // budget — give the correction room to finish the object.
              max_tokens: truncated
                ? Math.min(spec.maxOutputTokens * 2, 16000)
                : baseParams.max_tokens,
            } as Parameters<typeof call>[1],
            {
              onUsage,
              onProgress,
              signal,
            },
          ),
        Math.max(1, remaining()),
        deps.signal,
      );
      const t2 = textOf(msg2);
      const p2 = safeParseObject(t2);
      const errors2 = spec.schema ? validateAgainst(spec.schema, p2) : [];
      // Accept the retry only if it produced content and is no worse on schema.
      if (!isEffectivelyEmpty(p2) && errors2.length <= errors.length) {
        parsed = p2;
        finalText = t2;
      }
    } catch (e) {
      diag("correction retry", e);
      if (e instanceof TurnAbortedError) throw e;
      // A failed correction retry is non-fatal: fall through with tolerant coercion.
    }
  }

  // Blocker fix: never hand back effectively-empty content — downstream
  // builders would coerce it into an empty proposal that the reviewer rejects,
  // burning run budget and permanently killing the section. The explicit
  // correction retry above has already had its chance by this point.
  if (isEffectivelyEmpty(parsed)) {
    throw new EmptyOutputError("The model returned empty output after an explicit correction retry (empty_output).");
  }

  return { raw: parsed, rawText: finalText, searchCount };
}

// Flatten any tool-related content blocks left by the web-search tool loop into
// plain text so a `tools: undefined` correction retry does not 400 ("tool_use/
// tool_result blocks require the tools that produced them"). String content is
// passed through; a block-array turn keeps its text blocks and replaces tool
// blocks with a short placeholder, so no message becomes empty and roles keep
// alternating.
function sanitizeForToollessRetry(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    const kept: Array<{ type: "text"; text: string }> = [];
    for (const block of m.content as Array<{ type?: string; text?: string; name?: string }>) {
      const t = block.type;
      if (t === "text") {
        kept.push({ type: "text", text: block.text ?? "" });
      } else if (t === "tool_use" || t === "server_tool_use") {
        kept.push({ type: "text", text: `[used tool ${block.name ?? ""}]`.trim() });
      } else if (t === "tool_result" || t === "web_search_tool_result") {
        kept.push({ type: "text", text: "[tool result omitted for correction retry]" });
      }
      // any other block type is dropped
    }
    if (kept.length === 0) kept.push({ type: "text", text: "[omitted]" });
    return { role: m.role, content: kept as unknown as Anthropic.MessageParam["content"] };
  });
}
