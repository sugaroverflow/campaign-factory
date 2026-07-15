// Factory agent registry — every Runtime Agent's brain, keyed by roster key.
// Runtime-neutral: importable from the worker via the @web/* path alias.

import type { AgentKey } from "../contracts/roster";
import type { AgentContract } from "./types";
import { researchDirector } from "./research-director";
import { evidenceAdjudicator } from "./adjudicator";
import { decisionRoute, objectiveStrategist, powerStakeholder, pressureAnalysis } from "./analysis";
import { strategyArchitect } from "./strategy";
import { organisingDesigner, tacticsPlanner } from "./delivery";
import { digitalProducer, lobbyingProducer, mediaProducer } from "./producers";
import { synthesisReviewer } from "./reviewer";
import { specialistContracts } from "./specialists";

export const AGENT_CONTRACTS: Record<AgentKey, AgentContract> = {
  research_director: researchDirector,
  evidence_adjudicator: evidenceAdjudicator,
  objective_strategist: objectiveStrategist,
  decision_route: decisionRoute,
  power_stakeholder: powerStakeholder,
  pressure_analysis: pressureAnalysis,
  strategy_architect: strategyArchitect,
  tactics_planner: tacticsPlanner,
  organising_designer: organisingDesigner,
  lobbying_producer: lobbyingProducer,
  media_producer: mediaProducer,
  digital_producer: digitalProducer,
  synthesis_reviewer: synthesisReviewer,
  ...specialistContracts,
};

export function getAgentContract(key: AgentKey): AgentContract {
  const c = AGENT_CONTRACTS[key];
  if (!c) throw new Error(`No agent contract registered for key: ${key}`);
  return c;
}

// Types
export type { AgentContract, AgentParseContext, AgentResultBody } from "./types";
export type { JSchema } from "./schema";

// Schema utilities the runtime uses (validation gate, prompt-shape describer)
export { describeSchema, validateAgainst } from "./schema";

// Reviewer surface (parsed by the worker's reviewer node, not the executor)
export {
  REVIEW_SCHEMA,
  SYNTHESIS_REVIEWER_SYSTEM,
  formatProposalsForReview,
  parseReview,
  reviewerUserMessage,
  type ReviewParsed,
} from "./reviewer";
