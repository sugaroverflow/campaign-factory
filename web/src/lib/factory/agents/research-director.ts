// Step 1–2: Campaign Interpreter & Research Director (Sonnet 5 high;
// search_discovery ≤2). Produces the ScopeBrief — refined problem, required
// place, research questions, and the specialist PAIR (chosen only from the 6
// catalogue keys) with reasons — plus discovery claims. The selected pair is
// surfaced as handoffs so W2's graph spawns exactly those specialists.

import { SPECIALIST_CATALOGUE } from "../contracts/roster";
import type { AgentHandoff } from "../contracts/envelope";
import { A, enumStr, S, str, strA } from "./schema";
import {
  EVIDENCE_RULES,
  NO_SYNTHETIC_DATA,
  PLACE_DISCIPLINE,
  TOOL_USE,
  UNTRUSTED_SOURCES,
  agentOutputSchema,
  asStrArray,
  asString,
  baseBody,
  buildSectionProposal,
  coerceRefs,
  systemPrompt,
  userMessageHeader,
} from "./shared";
import type { AgentContract } from "./types";

const SPECIALIST_KEYS = SPECIALIST_CATALOGUE.map((s) => s.key);
const SPECIALIST_KEY_SET = new Set<string>(SPECIALIST_KEYS);

const scopeBriefSchema = S({
  refinedProblem: str,
  campaignName: str,
  requiredPlace: S({ area: str, authority: str, geography: str }),
  interpretation: str,
  researchQuestions: strA,
  specialistSelection: A(S({ specialist: enumStr(SPECIALIST_KEYS), reason: str })),
  context: S({
    situation: str,
    currentPolicy: str,
    affected: strA,
    keyDates: strA,
    institutions: strA,
    howItChanged: str,
  }),
  decisionRouteSketch: S({
    formal: str,
    implementer: str,
    practical: str,
    processes: strA,
    interventionPoints: strA,
    deadlines: strA,
    unresolved: strA,
  }),
  possibleAllies: strA,
  possibleOpponents: strA,
  localMedia: strA,
});

const schema = agentOutputSchema({ scopeBrief: scopeBriefSchema, evidenceClaimRefs: strA }, [
  "scopeBrief",
  "evidenceClaimRefs",
]);

const CATALOGUE_LINES = SPECIALIST_CATALOGUE.map((s) => `  - "${s.key}": ${s.responsibility} (use when: ${s.useWhen})`).join(
  "\n",
);

const role = `You are the Campaign Interpreter & Research Director for Campaign Factory (UK local/public-policy campaigns) — the first agent on the campaign. Interpret what the user is actually asking, establish the required place, and set the research agenda for the specialists who follow.

Produce a ScopeBrief:
- refinedProblem: the problem as the evidence reframes it (not necessarily the user's original words);
- requiredPlace: the specific UK area, the responsible authority, and the geography;
- researchQuestions: the concrete questions the research lanes must answer (who decides, current policy/restriction, process/deadline, precedent/opposition);
- specialistSelection: choose EXACTLY TWO specialists — the narrowest useful PAIR whose evidence questions do NOT overlap — from ONLY these catalogue keys, each with a reason:
${CATALOGUE_LINES}
  Do not select two overlapping specialists to inflate the roster. If a genuinely distinct third institution/evidence system exists that the pair cannot cover, request it via specialistRequest (one only) — but still pick the best pair.
- context and a decision-route sketch from your ≤2 discovery searches;
- possibleAllies, possibleOpponents, localMedia as leads for later lanes (attributed, not asserted).

Run at most TWO discovery searches, fetch the underlying pages, then stop and write the JSON.`;

export const researchDirector: AgentContract = {
  key: "research_director",
  schema,
  structuredOutput: false, // large, nested + claims — prompt-JSON + tolerant parse
  system: () => systemPrompt(role, [NO_SYNTHETIC_DATA, UNTRUSTED_SOURCES, EVIDENCE_RULES, PLACE_DISCIPLINE, TOOL_USE], schema),
  userMessage: (env, ctx) => userMessageHeader(env, ctx),
  toResult: (raw, ctx) => {
    const env = ctx.envelope;
    const body = baseBody(raw, ctx);
    const brief = (raw.scopeBrief && typeof raw.scopeBrief === "object" ? raw.scopeBrief : {}) as Record<string, unknown>;
    const refs = coerceRefs(raw.evidenceClaimRefs);

    // Deterministically turn the selected pair into specialist handoffs (the
    // graph reads these). Keep only valid catalogue keys, dedupe, cap at 2.
    const selection = Array.isArray(brief.specialistSelection) ? brief.specialistSelection : [];
    const chosen: AgentHandoff[] = [];
    const seen = new Set<string>();
    for (const sel of selection) {
      const o = (sel && typeof sel === "object" ? sel : {}) as Record<string, unknown>;
      const key = asString(o.specialist);
      if (!SPECIALIST_KEY_SET.has(key) || seen.has(key)) continue;
      seen.add(key);
      chosen.push({ toAgentKey: key, artefact: `Research lane: ${asString(o.reason) || key}`, refs });
      if (chosen.length >= 2) break;
    }
    body.handoffs = [...chosen, ...body.handoffs];

    const place = (brief.requiredPlace && typeof brief.requiredPlace === "object" ? brief.requiredPlace : {}) as Record<string, unknown>;
    const context = (brief.context && typeof brief.context === "object" ? brief.context : {}) as Record<string, unknown>;
    const routeSketch = (brief.decisionRouteSketch && typeof brief.decisionRouteSketch === "object" ? brief.decisionRouteSketch : {}) as Record<string, unknown>;
    const scopeSummary =
      asString(context.situation) || asString(brief.interpretation) || asString(brief.refinedProblem) || "Initial research scoping.";

    // Step 1 (problem): the refined framing. `statement` is w1's required core
    // field; place is an extra field the reducer preserves.
    body.proposals.unshift(
      buildSectionProposal(
        env,
        1,
        {
          statement: asString(brief.refinedProblem),
          campaignName: asString(brief.campaignName),
          interpretation: asString(brief.interpretation),
          context,
          place,
        },
        refs,
        { summary: "Refined problem, campaign name, and required place" },
      ),
    );
    // Step 2 (evidence): the research agenda + scoping context, as a full
    // set_section so the required `summary` exists before specialists merge
    // their lane blocks and the adjudicator finalises claim status.
    body.proposals.splice(1, 0,
      buildSectionProposal(
        env,
        2,
        {
          summary: scopeSummary,
          researchQuestions: asStrArray(brief.researchQuestions),
          keyDates: asStrArray(context.keyDates),
          institutions: asStrArray(context.institutions),
          allies: asStrArray(brief.possibleAllies),
          opponents: asStrArray(brief.possibleOpponents),
          localMedia: asStrArray(brief.localMedia),
          unresolved: asStrArray(routeSketch.unresolved),
          specialistSelection: selection,
          decisionRouteSketch: routeSketch,
        },
        refs,
        { summary: "Research agenda, scoping context, and specialist selection" },
      ),
    );
    return body;
  },
};
