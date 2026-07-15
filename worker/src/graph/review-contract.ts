// Graph-local review + QA contracts. w3 owns worker/src/agents (runSynthesisReview,
// runInvisibleQA) and their exact types; executor-loader.ts adapts w3's output
// into THESE shapes so the graph nodes stay decoupled. (Not ExecutorDeps —
// that stays w3's authoritative type.)

import type { ChangeProposal } from "@web/lib/factory/contracts/state.js";
import type { AgentResult, AgentTaskEnvelope } from "@web/lib/factory/contracts/envelope.js";
import type { AgentDef } from "@web/lib/factory/contracts/roster.js";
import type { ExecutorDeps } from "../agents/deps.js";

export type ReviewPass = "evidence" | "analysis" | "strategy" | "final";
export type ReviewDecision = "accept" | "return" | "reject";

export interface ReviewInput {
  campaignId: string;
  batchId?: string;
  reviewerAgentRunId: string; // stable across all reviewer turns (ADR 0003)
  pass: ReviewPass;
  journeySteps: number[];
  proposals: ChangeProposal[];
  priorStepReports?: Array<{ step: number; report: string }>;
  qaFlagsByProposalId?: Record<string, string[]>;
  profile?: "full" | "express"; // express reviews stay on the roster model (no Opus escalation)
}

export interface ProposalReviewResult {
  proposalId: string;
  decision: ReviewDecision;
  rationale: string;
  stepReport?: string;
}

export interface ReviewOutcome {
  reviews: ProposalReviewResult[];
  passStepReport?: string;
}

export type ReviewFn = (input: ReviewInput, deps: ExecutorDeps) => Promise<ReviewOutcome>;

// Invisible QA (w3). Runs after each agent turn; flags feed the reviewer.
export interface QAInput {
  result: AgentResult;
  def: AgentDef;
  campaignId: string;
  agentRunId: string;
  batchId?: string;
}
export type QAFn = (input: QAInput, deps: ExecutorDeps) => Promise<string[]>;

// Kept for envelope typing symmetry (unused export guard).
export type { AgentTaskEnvelope };
