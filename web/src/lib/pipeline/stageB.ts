import Anthropic from "@anthropic-ai/sdk";
import { getClient, call, textOf, parseJSONLoose } from "../anthropic";
import { MODELS } from "./models";
import { PLAN_SYSTEM } from "./prompts";
import { PLAN_SCHEMA } from "./schemas";
import { publicInput } from "./util";
import { coerceLabel } from "./labels";
import { type UsageSink } from "../spend/pricing";
import { type RunInput, type ResearchResult, type Plan } from "./types";

// Stage B — Opus 4.8, effort high. NEVER downgraded: plan coherence across
// objective / power map / pressure / tactics / organising is the un-lintable
// core. Prompt-specified JSON (schema too large for grammar compilation) with
// tolerant parse + one corrective retry.
export async function runPlan(input: RunInput, research: ResearchResult | null, onUsage?: UsageSink): Promise<Plan> {
  const client = getClient(input.apiKey);
  const researchBlock = research
    ? JSON.stringify(research)
    : JSON.stringify({ note: "Research unavailable — plan from user input only; mark everything needing verification." });
  const ask = `User input: ${JSON.stringify(publicInput(input))}\n\nResearch findings (verified):\n${researchBlock}\n\nReturn ONLY a JSON object (no prose, no code fences) that validates against this JSON Schema:\n${JSON.stringify(PLAN_SCHEMA)}`;

  let messages: Anthropic.MessageParam[] = [{ role: "user", content: ask }];
  for (let attempt = 0; ; attempt++) {
    const msg = await call(
      client,
      {
        model: MODELS.plan.model,
        max_tokens: 16000,
        system: PLAN_SYSTEM,
        effort: MODELS.plan.effort,
        adaptiveThinking: true,
        messages,
      },
      { onUsage },
    );
    try {
      const plan = parseJSONLoose<Plan>(textOf(msg));
      // keep stakeholder position labels on-enum
      plan.stakeholders = (plan.stakeholders || []).map((s) => ({ ...s, positionStatus: coerceLabel(s.positionStatus) }));
      return plan;
    } catch (e) {
      if (attempt >= 1) throw e;
      messages = [
        ...messages,
        { role: "assistant", content: msg.content },
        { role: "user", content: "That was not parseable as a single JSON object. Return ONLY the complete JSON object, nothing else." },
      ];
    }
  }
}
