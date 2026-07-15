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
import { costUSD, type Usage } from "@web/lib/spend/pricing.js";
import { validateAgainst, type JSchema } from "@web/lib/factory/agents/index.js";
import type { AgentDef } from "@web/lib/factory/contracts/index.js";
import type { ExecutorDeps } from "./deps.js";
import { fetchPage } from "./gateway.js";
import type { WorkEmitter } from "./work.js";

export class TurnTimeoutError extends Error {}
export class TurnAbortedError extends Error {}

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

type Block = { type: string; [k: string]: unknown };

export async function runModelTurn(spec: ModelTurnSpec, deps: ExecutorDeps): Promise<ModelTurnResult> {
  const client = getClient(deps.apiKey);
  const nowMs = () => (deps.now?.() ?? new Date()).getTime();
  const deadline = nowMs() + spec.timeoutMs;
  const remaining = () => deadline - nowMs();

  let searchCount = 0;
  const onUsage = (model: string, usage: Usage) => {
    void deps.recordUsage({
      campaignId: spec.campaignId,
      batchId: spec.batchId,
      agentRunId: spec.agentRunId,
      model,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens,
      costUSD: costUSD(model, usage),
    });
  };
  const onToolNote = (note: string) => {
    if (note.startsWith("searching")) {
      searchCount++;
      void deps.emit({
        type: "source.search.started",
        journeyStep: spec.journeyStep,
        payload: { summary: "Searching public sources", verb: "searching", agentKey: spec.def.key },
      });
    } else if (note.startsWith("reading")) {
      void deps.emit({
        type: "source.search.completed",
        journeyStep: spec.journeyStep,
        payload: { summary: "Read search results", verb: "read", agentKey: spec.def.key },
      });
    }
    spec.work.work(note, "searching");
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
  const opts = { onToolNote, onUsage, maxPauseResumes: (spec.def.searchBudget ?? 0) + 3 };

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: spec.userText }];
  const maxToolTurns = spec.maxToolTurns ?? 8;
  let finalText = "";

  for (let turn = 0; turn <= maxToolTurns; turn++) {
    if (remaining() <= 0) throw new TurnTimeoutError(`model turn exceeded ${spec.timeoutMs}ms`);
    spec.work.work(turn === 0 ? "Working" : "Reviewing sources", "thinking");
    const msg = await runCall(
      (signal) => call(client, { ...baseParams, messages } as Parameters<typeof call>[1], { ...opts, signal }),
      Math.max(1, remaining()),
      deps.signal,
    );
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
  if (spec.schema) {
    const errors = validateAgainst(spec.schema, parsed);
    if (errors.length && remaining() > 0) {
      spec.work.work("Correcting output format", "fixing");
      messages.push({ role: "assistant", content: finalText });
      messages.push({
        role: "user",
        content: `Your previous response did not match the required schema. Problems:\n- ${errors.slice(0, 20).join("\n- ")}\n\nReturn ONLY the corrected single JSON object — no prose, no fences.`,
      });
      try {
        const msg2 = await runCall(
          (signal) => call(client, { ...baseParams, messages, tools: undefined } as Parameters<typeof call>[1], { onUsage, signal }),
          Math.max(1, remaining()),
          deps.signal,
        );
        const t2 = textOf(msg2);
        const p2 = safeParseObject(t2);
        if (validateAgainst(spec.schema, p2).length <= errors.length) {
          parsed = p2;
          finalText = t2;
        }
      } catch (e) {
        if (e instanceof TurnAbortedError) throw e;
        // A failed correction retry is non-fatal: fall through with tolerant coercion.
      }
    }
  }

  return { raw: parsed, rawText: finalText, searchCount };
}
