// Campaign graph topology (parameters §4). Checkpoint after every completed
// superstep (PostgresSaver, thread_id = campaignId) so a worker restart resumes
// each campaign from its last checkpoint.
//
//   research_director ‖ specialists (2 selected)   [one superstep, 3 agents wide]
//     → evidence_adjudicator                        [joins BOTH branches]
//     → reviewer(evidence)                 [acceptance pass after research cluster]
//     → analysis (objective ‖ decision_route ‖ power ‖ pressure)
//     → reviewer(analysis)                 [acceptance pass after analysis cluster]
//     → strategy_architect
//     → reviewer(strategy)  ──return?──▶ strategy_architect   (ONE bounded loop,
//                                         skipped past the soft time target)
//     → planning_production (tactics ‖ organising ‖ lobbying ‖ media ‖ digital)
//     → reviewer(final)
//     → finalise (deterministic: compile documents + receipt + terminal status)
//
// Specialist selection is a deterministic regex over problem+place, so the
// specialist wave does NOT need the director's output — it runs concurrently
// with the director and both feed the adjudicator (which joins on both).
// Planning and production are ONE 5-wide cluster: no reviewer sits between
// them, so production never saw accepted planning content anyway, and the
// per-campaign active-call cap (8) fits 5 concurrent calls.
//
// Clusters are single graph nodes that fan their agents out with Promise.all
// (real concurrent, gated model calls) — this keeps state writes serial and
// gives one checkpoint per cluster boundary.

import { StateGraph, START, END } from "@langchain/langgraph";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { RunnableConfig } from "@langchain/core/runnables";
import { contextFrom } from "./context.js";
import { GraphState, type GraphStateType } from "./state.js";
import {
  researchDirectorNode,
  specialistsClusterNode,
  agentClusterNode,
  reviewerNode,
} from "./nodes.js";
import { finaliseNode } from "./finalise.js";

export function buildCampaignGraph(checkpointer: PostgresSaver) {
  const graph = new StateGraph(GraphState)
    .addNode("research_director", researchDirectorNode())
    .addNode("specialists", specialistsClusterNode())
    .addNode("evidence_adjudicator", agentClusterNode(["evidence_adjudicator"], ["evidence"]))
    .addNode("reviewer_evidence", reviewerNode("evidence", [1, 2]))
    .addNode(
      "analysis",
      agentClusterNode(
        ["objective_strategist", "decision_route", "power_stakeholder", "pressure_analysis"],
        ["objective", "decision_route", "power", "pressure"],
      ),
    )
    .addNode("reviewer_analysis", reviewerNode("analysis", [3, 4, 5, 6]))
    .addNode("strategy_architect", agentClusterNode(["strategy_architect"], ["strategy"]))
    .addNode("reviewer_strategy", reviewerNode("strategy", [7]))
    .addNode(
      "planning_production",
      agentClusterNode(
        ["tactics_planner", "organising_designer", "lobbying_producer", "media_producer", "digital_producer"],
        ["tactics", "organising", "documents"],
      ),
    )
    .addNode("reviewer_final", reviewerNode("final", [8, 9, 10]))
    .addNode("finalise", finaliseNode())
    // Director and specialists start together; the adjudicator waits for BOTH.
    .addEdge(START, "research_director")
    .addEdge(START, "specialists")
    .addEdge(["research_director", "specialists"], "evidence_adjudicator")
    .addEdge("evidence_adjudicator", "reviewer_evidence")
    .addEdge("reviewer_evidence", "analysis")
    .addEdge("analysis", "reviewer_analysis")
    .addEdge("reviewer_analysis", "strategy_architect")
    .addEdge("strategy_architect", "reviewer_strategy")
    .addConditionalEdges("reviewer_strategy", routeAfterStrategy, {
      revise: "strategy_architect",
      proceed: "planning_production",
    })
    .addEdge("planning_production", "reviewer_final")
    .addEdge("reviewer_final", "finalise")
    .addEdge("finalise", END);

  return graph.compile({ checkpointer });
}

// ONE bounded revision loop: return to strategy only if the strategy reviewer
// asked for a revision and we have not already revised once. Time-aware
// gating lives in the strategy reviewer itself (nodes.ts): past the soft
// campaign target it never sets needsStrategyRevision — a triggered revision
// adds two heavy waves the hard budget cannot afford. The EXPRESS profile
// (RuntimeContext.profile) never revises, regardless of state — that profile's
// other levers (single specialist, Sonnet strategy, medium-effort analysis,
// capped outputs, 15-min hard limit) live in the roster/limits derived views
// and the cluster nodes; the topology is shared by both profiles.
function routeAfterStrategy(state: GraphStateType, config?: RunnableConfig): "revise" | "proceed" {
  if (contextFrom(config).profile === "express") return "proceed";
  return state.needsStrategyRevision && state.strategyRevisions <= 1 ? "revise" : "proceed";
}
