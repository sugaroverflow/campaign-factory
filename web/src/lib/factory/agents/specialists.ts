// The six registered specialists (step 2; Sonnet 5 high; search_specialist ≤4).
// All share one template built from the catalogue entry: gather verified claims
// with sources in their lane, summarise findings, merge a lane block into the
// evidence section, and hand off to the Evidence Adjudicator.

import { SPECIALIST_CATALOGUE, type SpecialistDef, type SpecialistKey } from "../contracts/roster";
import { S, str, strA } from "./schema";
import {
  EVIDENCE_RULES,
  NO_SYNTHETIC_DATA,
  PLACE_DISCIPLINE,
  TOOL_USE,
  UNTRUSTED_SOURCES,
  agentOutputSchema,
  baseBody,
  buildMergeProposal,
  coerceRefs,
  systemPrompt,
  userMessageHeader,
} from "./shared";
import type { AgentContract } from "./types";

function makeSpecialistContract(def: SpecialistDef): AgentContract {
  const findingsSchema = S(
    { summary: str, keyPoints: strA, candidateOrganisations: strA, disputedClaims: strA },
    ["summary", "keyPoints"],
  );
  const schema = agentOutputSchema({ findings: findingsSchema, evidenceClaimRefs: strA }, [
    "findings",
    "evidenceClaimRefs",
  ]);
  const role = `You are the ${def.displayName} for Campaign Factory — one of exactly two research specialists on this campaign. Your remit: ${def.responsibility}. You were selected because this campaign involves: ${def.useWhen}.
- Answer the research questions in YOUR lane only, using up to ${def.searchBudget} web searches; fetch the underlying official pages before relying on them.
- Produce verified claims WITH sources for your lane; give each fact its honest verification label. Do not duplicate the other specialist's evidence questions.
- Summarise your findings and hand your evidence to the Evidence Adjudicator, who decides final claim status. You surface evidence; you do not adjudicate it.`;

  return {
    key: def.key,
    schema,
    structuredOutput: false,
    system: () =>
      systemPrompt(role, [NO_SYNTHETIC_DATA, UNTRUSTED_SOURCES, EVIDENCE_RULES, PLACE_DISCIPLINE, TOOL_USE], schema),
    userMessage: (env, ctx) => userMessageHeader(env, ctx),
    toResult: (raw, ctx) => {
      const env = ctx.envelope;
      const body = baseBody(raw, ctx);
      const refs = coerceRefs(raw.evidenceClaimRefs);
      const findings = raw.findings ?? {};
      if (!body.handoffs.some((h) => h.toAgentKey === "evidence_adjudicator")) {
        body.handoffs.push({ toAgentKey: "evidence_adjudicator", artefact: `${def.shortName} evidence for adjudication`, refs });
      }
      body.proposals.unshift(
        buildMergeProposal(
          env,
          2,
          { [`lane_${def.key}`]: { specialist: def.displayName, findings } },
          refs,
          { summary: `${def.shortName} research lane findings` },
        ),
      );
      return body;
    },
  };
}

export const specialistContracts: Record<SpecialistKey, AgentContract> = Object.fromEntries(
  SPECIALIST_CATALOGUE.map((d) => [d.key, makeSpecialistContract(d)]),
) as Record<SpecialistKey, AgentContract>;
