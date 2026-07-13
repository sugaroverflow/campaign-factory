import { getClient, call, textOf, parseJSONLoose } from "../anthropic";
import { MODELS } from "./models";
import { DRAFTS_SYSTEM } from "./prompts";
import { DRAFTS_SCHEMA, type DraftGroup } from "./schemas";
import { publicInput, errMsg } from "./util";
import { type UsageSink } from "../spend/pricing";
import { type RunInput, type ResearchResult, type Plan, type Drafts } from "./types";

const GROUPS: DraftGroup[] = ["lobbying", "media", "digital"];

async function runDraftGroup(
  input: RunInput,
  research: ResearchResult | null,
  plan: Plan | null,
  group: DraftGroup,
  onUsage?: UsageSink,
): Promise<unknown> {
  const client = getClient(input.apiKey);
  const facts = JSON.stringify((research?.claims || []).slice(0, 20));
  const msg = await call(
    client,
    {
      model: MODELS.drafts.model,
      max_tokens: 8000,
      system: DRAFTS_SYSTEM[group],
      effort: MODELS.drafts.effort,
      adaptiveThinking: true,
      jsonSchema: DRAFTS_SCHEMA[group],
      messages: [
        {
          role: "user",
          content: `Campaign plan:\n${JSON.stringify(plan ?? {})}\n\nKey verified facts:\n${facts}\n\nUser context: ${JSON.stringify(publicInput(input))}\n\nDraft the ${group} resources JSON.`,
        },
      ],
    },
    { onUsage },
  );
  return parseJSONLoose(textOf(msg));
}

export interface DraftsHooks {
  onNote?: (note: string) => void;
  onUsage?: UsageSink;
}

// Stage C — Sonnet 5, effort medium, three grouped parallel calls (one per
// audience pack). allSettled so one group failing doesn't lose the others
// (partial-results principle). TODO(M6): cache-stagger — fire group 1, await its
// first streamed token, then fire 2+3, to hit the shared-state prompt cache.
export async function runDrafts(
  input: RunInput,
  research: ResearchResult | null,
  plan: Plan | null,
  hooks: DraftsHooks = {},
): Promise<Drafts> {
  const results = await Promise.allSettled(GROUPS.map((g) => runDraftGroup(input, research, plan, g, hooks.onUsage)));
  const drafts: Drafts = {};
  results.forEach((r, i) => {
    const g = GROUPS[i];
    if (r.status === "fulfilled") {
      (drafts as Record<string, unknown>)[g] = r.value;
    } else {
      hooks.onNote?.(`Draft group "${g}" failed: ${errMsg(r.reason)}`);
    }
  });
  if (!drafts.lobbying && !drafts.media && !drafts.digital) {
    throw new Error("All draft groups failed");
  }
  return drafts;
}
