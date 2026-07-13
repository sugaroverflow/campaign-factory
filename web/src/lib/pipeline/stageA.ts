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

// Stage A — Sonnet 5, effort high, web search. Produces the verified situation
// with 7-label claims. The label enum is enforced in code (coerceLabel) so an
// off-enum label is treated as unverified rather than trusted.
export async function runResearch(input: RunInput, hooks: ResearchHooks = {}): Promise<ResearchResult> {
  const client = getClient(input.apiKey);
  const msg = await call(
    client,
    {
      model: MODELS.research.model,
      max_tokens: 16000,
      system: RESEARCH_SYSTEM,
      effort: MODELS.research.effort,
      adaptiveThinking: true,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
      messages: [{ role: "user", content: researchUserMessage(input) }],
    },
    { maxPauseResumes: 3, onText: hooks.onText, onToolNote: hooks.onNote, onUsage: hooks.onUsage },
  );
  const out = parseJSONLoose<ResearchResult>(textOf(msg));
  out.claims = (out.claims || []).map((c) => ({ ...c, status: coerceLabel(c.status) }));
  return out;
}
