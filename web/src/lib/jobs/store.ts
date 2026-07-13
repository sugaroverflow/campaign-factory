import { randomUUID } from "node:crypto";
import { initialRunState, runPipeline } from "@/lib/pipeline/run";
import { type RunInput, type RunState } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// DEV JOB STORE — in-memory. This is a shim, NOT the production architecture.
//
// It survives only within a single warm serverless instance, so it works for
// local dev and single-instance demos but WILL lose runs across cold starts and
// won't fan out across instances. It is replaced in M4 by Vercel Workflow (WDK)
// for durable, crash-safe orchestration + Neon Postgres for run/campaign state.
// runPipeline() is already written as pure stage calls over a mutator so it
// drops into a Workflow unchanged.
// ---------------------------------------------------------------------------

const runs = new Map<string, RunState>();

export function startRun(input: RunInput): RunState {
  const id = randomUUID();
  const state = initialRunState(id, input);
  runs.set(id, state);

  // Fire-and-forget. In prod this is a Workflow step, not a floating promise.
  void runPipeline(input, (patch) => {
    const s = runs.get(id);
    if (s) patch(s);
  }).catch((e) => {
    const s = runs.get(id);
    if (s) {
      s.status = "failed";
      s.notes.push(`Run crashed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  return state;
}

export function getRun(id: string): RunState | undefined {
  return runs.get(id);
}
