import { randomUUID } from "node:crypto";
import { initialRunState, runPipeline } from "@/lib/pipeline/run";
import { saveRun, getRunState, setRunOwner } from "@/lib/db/runs";
import { type RunInput, type RunState } from "@/lib/pipeline/types";

// Durable job store. Run state lives in Postgres (source of truth for polling
// and /c/[id]); the executing instance keeps an in-memory copy and write-through
// persists it (debounced) on each mutation. Reads always come from the DB, so
// any instance/route can serve progress.
//
// NOTE (durability, M4b): the pipeline still runs as a fire-and-forget promise.
// On Vercel a floating promise after the response can be killed — Vercel
// Workflow (WDK) will drive the run so execution itself survives, but state is
// already durable here.

const mem = new Map<string, RunState>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(id: string) {
  if (timers.has(id)) return; // debounce: coalesce the burst of mutations
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      const s = mem.get(id);
      if (s) void saveRun(s).catch(() => {});
    }, 300),
  );
}

export interface StartedRun {
  state: RunState;
  // The pipeline execution promise. The caller (route) hands this to `after()`
  // so Vercel keeps the function alive until it settles (bounded by maxDuration).
  work: Promise<void>;
}

export async function startRun(input: RunInput, ownerSid?: string): Promise<StartedRun> {
  const id = randomUUID();
  const state = initialRunState(id, input);
  mem.set(id, state);
  await saveRun(state); // initial persist so the run is pollable immediately
  if (ownerSid) await setRunOwner(id, ownerSid); // browser-session owner (share/delete)

  const work = runPipeline(input, (patch) => {
    patch(state);
    scheduleSave(id);
  })
    .catch((e) => {
      state.status = "failed";
      state.notes.push(`Run crashed: ${e instanceof Error ? e.message : String(e)}`);
    })
    .finally(async () => {
      const t = timers.get(id);
      if (t) {
        clearTimeout(t);
        timers.delete(id);
      }
      await saveRun(state).catch(() => {}); // final flush
      mem.delete(id);
    });

  return { state, work };
}

export async function getRun(id: string): Promise<RunState | undefined> {
  return (await getRunState(id)) ?? undefined;
}
