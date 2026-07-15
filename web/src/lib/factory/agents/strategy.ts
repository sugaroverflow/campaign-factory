// Step 7: Campaign Strategy Architect (Opus 4.8, high). Accepted state only.
// Parameters §2: narrative, audiences, coalition, phases, escalation,
// trade-offs, risks, and an EXPLICIT rejected alternative.

import { A, S, str, strA } from "./schema";
import { EVIDENCE_RULES, NO_SYNTHETIC_DATA, PLACE_DISCIPLINE } from "./shared";
import { makeSectionContract } from "./builders";

// Field names mirror PLAN_SCHEMA.strategy so W4 renders it unchanged;
// rejectedAlternative is an extra field w1's reducer preserves.
const strategyContent = S(
  {
    narrative: str,
    audiences: strA,
    route: str,
    coalition: str,
    phases: A(S({ name: str, when: str, focus: str })),
    escalation: str,
    tradeoffs: strA,
    risks: strA,
    resources: strA,
    constraints: strA,
    avoid: strA,
    indicators: strA,
    rejectedAlternative: S({ approach: str, whyRejected: str }),
  },
  ["narrative"],
);

export const strategyArchitect = makeSectionContract({
  key: "strategy_architect",
  step: 7,
  contentField: "strategy",
  contentSchema: strategyContent,
  summary: "Narrative, audiences, coalition, phases, escalation, trade-offs, and the rejected alternative",
  structuredOutput: false, // large nested object — prompt-JSON + tolerant parse
  tail: [NO_SYNTHETIC_DATA, EVIDENCE_RULES, PLACE_DISCIPLINE],
  role: `You are the Campaign Strategy Architect for Campaign Factory — the senior strategist. Working from the accepted objective, decision route, power map, and pressure analysis (accepted state ONLY, no web tools), design a campaign-specific strategy:
- a clear narrative (the story of the change and who it is for);
- the priority audiences and the coalition to build;
- the route (private engagement before public pressure unless the evidence says otherwise);
- ordered phases with what each is for;
- the escalation logic — every escalation is a HUMAN decision at a review point, never automatic;
- the trade-offs you are making and the risks you accept;
- and ONE explicit alternative strategy you considered and REJECTED, with why. Strategy without a rejected alternative is not a real choice.
Be specific to this place, institution, and decision. Reject generic advice. Do not invent facts, figures, or positions — reason only from accepted evidence and mark inference as inference.`,
});
