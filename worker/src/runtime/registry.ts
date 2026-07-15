// In-process registry of currently-executing runs, for cooperative cancellation.
// Single worker replica ⇒ this is authoritative for in-flight aborts. Durable
// truth is the run status in Postgres (checked at node boundaries and on
// resume), so a restart doesn't lose a cancellation.

export interface RunHandle {
  campaignId: string;
  controller: AbortController;
}

const active = new Map<string, RunHandle>();

// Returns null if the campaign is ALREADY executing in this process — the
// caller must treat that as "someone else is driving this run" and no-op, so a
// duplicate queue delivery can never execute the same graph thread concurrently.
export function registerRun(campaignId: string): RunHandle | null {
  if (active.has(campaignId)) return null;
  const handle: RunHandle = { campaignId, controller: new AbortController() };
  active.set(campaignId, handle);
  return handle;
}

export function getRun(campaignId: string): RunHandle | undefined {
  return active.get(campaignId);
}

export function abortRun(campaignId: string): boolean {
  const handle = active.get(campaignId);
  if (!handle) return false;
  handle.controller.abort();
  return true;
}

export function releaseRun(campaignId: string): void {
  active.delete(campaignId);
}
