import Anthropic from "@anthropic-ai/sdk";
import { getClient, call, textOf, parseJSONLoose } from "../anthropic";
import { MODELS, WEB_SEARCH_MAX_USES } from "./models";
import { RESEARCH_SYSTEM, researchUserMessage } from "./prompts";
import { coerceLabel } from "./labels";
import { type UsageSink } from "../spend/pricing";
import { type RunInput, type ResearchResult } from "./types";

export interface ResearchHooks {
  onText?: (delta: string) => void; // token stream for the live research feed
  onNote?: (note: string) => void; // "searching the web…" etc.
  onUsage?: UsageSink;
}

const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCH_MAX_USES };

function finalize(out: ResearchResult): ResearchResult {
  // Enforce the label enum in code — an off-enum label is treated as unverified.
  out.claims = (out.claims || []).map((c) => ({ ...c, status: coerceLabel(c.status) }));
  return out;
}

// Stage A — Sonnet 5, effort high, web search. Produces the verified situation
// with 7-label claims. A large max_tokens budget (thinking + the big JSON) + one
// corrective retry guard against truncation/prose/fences (a real failure seen in
// rehearsal) WITHOUT degrading research effort. No synthetic fallback — a hard
// failure propagates and the run degrades to a labelled partial.
export async function runResearch(input: RunInput, hooks: ResearchHooks = {}): Promise<ResearchResult> {
  const client = getClient(input.apiKey);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: researchUserMessage(input) }];

  const msg = await call(
    client,
    {
      model: MODELS.research.model,
      max_tokens: 32000,
      system: RESEARCH_SYSTEM,
      effort: MODELS.research.effort,
      adaptiveThinking: true,
      tools: [WEB_SEARCH_TOOL],
      messages,
    },
    { maxPauseResumes: 3, onText: hooks.onText, onToolNote: hooks.onNote, onUsage: hooks.onUsage },
  );

  try {
    return finalize(parseJSONLoose<ResearchResult>(textOf(msg)));
  } catch {
    // The model already did the research; ask it to re-emit ONLY valid JSON with
    // room to finish. Tools stay declared (so replayed server-tool result blocks
    // are valid) but it won't search again — it has what it needs.
    hooks.onNote?.("finalising research…");
    const fix = await call(
      client,
      {
        model: MODELS.research.model,
        max_tokens: 32000,
        system: RESEARCH_SYSTEM,
        tools: [WEB_SEARCH_TOOL],
        messages: [
          ...messages,
          { role: "assistant", content: msg.content },
          {
            role: "user",
            content:
              "Your previous response could not be parsed as a single JSON object (it may have been truncated or wrapped in prose/code fences). Re-emit the COMPLETE research result as exactly one JSON object — no prose, no code fences, no partial output.",
          },
        ],
      },
      { maxPauseResumes: 1, onUsage: hooks.onUsage },
    );
    return finalize(parseJSONLoose<ResearchResult>(textOf(fix)));
  }
}
