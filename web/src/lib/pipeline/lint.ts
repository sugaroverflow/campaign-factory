import { getClient, call, textOf, parseJSONLoose } from "../anthropic";
import { MODELS } from "./models";
import { LINT_SYSTEM } from "./prompts";
import { LINT_SCHEMA } from "./schemas";
import { type UsageSink } from "../spend/pricing";
import { type RunInput, type ResearchResult, type Drafts, type LintResult } from "./types";

// Cheap Haiku 4.5 consistency pass overlapping Stage C: every specific fact in
// the drafts is either present in the verified research or marked [VERIFY: ...].
// Haiku has no adaptive thinking / effort — plain call. Never rewrites; flags only.
export async function runLint(
  input: RunInput,
  research: ResearchResult | null,
  drafts: Drafts,
  onUsage?: UsageSink,
): Promise<LintResult> {
  const client = getClient(input.apiKey);
  const facts = JSON.stringify((research?.claims || []).slice(0, 25));
  const msg = await call(
    client,
    {
      model: MODELS.lint.model,
      max_tokens: 2000,
      system: LINT_SYSTEM,
      jsonSchema: LINT_SCHEMA,
      messages: [
        {
          role: "user",
          content: `Verified research facts:\n${facts}\n\nDrafted materials:\n${JSON.stringify(drafts)}\n\nReturn the lint JSON.`,
        },
      ],
    },
    { onUsage },
  );
  const raw = textOf(msg);
  let out: LintResult;
  try {
    out = parseJSONLoose<LintResult>(raw);
  } catch (e) {
    // TEMP DIAGNOSTIC: surface why the parse failed so we can see it in prod.
    const blockTypes = (msg.content || []).map((b) => b.type).join(",");
    throw new Error(
      `${e instanceof Error ? e.message : "parse failed"} | stop=${msg.stop_reason} blocks=[${blockTypes}] textLen=${raw.length} head=${JSON.stringify(raw.slice(0, 120))} tail=${JSON.stringify(raw.slice(-120))}`,
    );
  }
  out.flags = out.flags || [];
  out.ok = !out.flags.some((f) => f.severity === "block");
  return out;
}
