import Anthropic from "@anthropic-ai/sdk";
import { type Effort } from "./pipeline/models";
import { type Usage, type UsageSink } from "./spend/pricing";

// Client factory. Key resolution: explicit per-run key (BYOK seam) → server env.
// AI Gateway swap point: to route spend through Vercel AI Gateway, set baseURL +
// the gateway key here once the web_search passthrough is verified (PLAN §12).
export function getClient(apiKey?: string): Anthropic {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic API key configured (set ANTHROPIC_API_KEY or pass one per run).");
  return new Anthropic({ apiKey: key });
}

// Minimal param surface we use. Cast to the SDK type at the call site so beta-ish
// fields (output_config.effort, adaptive thinking, web_search_20260209) don't
// fight version drift in the SDK's exported param types.
export interface CallParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Anthropic.MessageParam[];
  tools?: unknown[];
  effort?: Effort;
  jsonSchema?: Record<string, unknown>; // structured output
  adaptiveThinking?: boolean;
}

export interface CallOptions {
  maxPauseResumes?: number; // server-tool (web search) pause_turn resumes
  onText?: (delta: string) => void; // streamed text deltas (Stage A live feed)
  onToolNote?: (note: string) => void; // "searching the web…" etc.
  onUsage?: UsageSink; // token usage → spend ledger / kill-switch
}

function buildParams(p: CallParams): Record<string, unknown> {
  const output_config: Record<string, unknown> = {};
  if (p.effort) output_config.effort = p.effort;
  if (p.jsonSchema) output_config.format = { type: "json_schema", schema: p.jsonSchema };
  const params: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.max_tokens,
    messages: p.messages,
  };
  if (p.system) params.system = p.system;
  if (p.tools) params.tools = p.tools;
  if (Object.keys(output_config).length) params.output_config = output_config;
  // Sonnet 5 runs adaptive by default; Opus needs it set explicitly. Haiku 4.5
  // does not support adaptive thinking, so callers omit it.
  if (p.adaptiveThinking) params.thinking = { type: "adaptive" };
  return params;
}

// One streamed call, resuming server-tool pauses, returning the final Message.
async function streamOnce(
  client: Anthropic,
  params: Record<string, unknown>,
  opts: CallOptions,
): Promise<Anthropic.Message> {
  const stream = client.messages.stream(params as unknown as Anthropic.MessageStreamParams);
  if (opts.onText) stream.on("text", (delta: string) => opts.onText!(delta));
  if (opts.onToolNote) {
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start") {
        const t = event.content_block.type;
        if (t === "server_tool_use") opts.onToolNote!("searching the web…");
        else if (t === "web_search_tool_result") opts.onToolNote!("reading search results…");
      }
    });
  }
  return stream.finalMessage();
}

export async function call(
  client: Anthropic,
  p: CallParams,
  opts: CallOptions = {},
): Promise<Anthropic.Message> {
  const base = buildParams(p);
  let msg = await streamOnce(client, base, opts);
  opts.onUsage?.(p.model, msg.usage as Usage);
  const maxResumes = opts.maxPauseResumes ?? 3;
  for (let i = 0; i < maxResumes && msg.stop_reason === "pause_turn"; i++) {
    const messages = [...(p.messages as Anthropic.MessageParam[]), { role: "assistant" as const, content: msg.content }];
    msg = await streamOnce(client, { ...base, messages }, opts);
    opts.onUsage?.(p.model, msg.usage as Usage);
  }
  if (msg.stop_reason === "refusal") {
    throw new Error("The request was declined by the model's safety systems.");
  }
  return msg;
}

export function textOf(msg: Anthropic.Message): string {
  return (msg.content || [])
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// Tolerant JSON extraction (mirrors the prototype's parseJSON).
export function parseJSONLoose<T = unknown>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    /* fall through to bracket extraction */
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      /* fall through */
    }
  }
  throw new Error("Could not parse JSON from model response");
}
