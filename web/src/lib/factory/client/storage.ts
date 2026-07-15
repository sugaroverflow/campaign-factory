// localStorage recovery for an in-flight factory run, mirroring the existing
// cf_run pattern (see web/src/lib/client/api.ts). After POST /api/factory/runs
// returns a StartRunResponse, the intake page stores the campaignId + stream
// coordinates + intake echo here, then redirects to /factory/c/[campaignId].
// On (accidental) refresh the Assembly View recovers the stream token and shows
// the problem/place hero immediately instead of an empty page.

export const CF_FACTORY_RUN_KEY = "cf_factory_run";

// How long after a run starts we still auto-recover it. Matches the campaign
// hard execution limit (20 min) plus review headroom, and comfortably exceeds
// the 15-minute stream-token TTL — an expired token just drops us to polling.
export const FACTORY_RUN_RECOVER_MS = 90 * 60 * 1000;

export interface StoredFactoryRun {
  campaignId: string;
  batchId?: string;
  streamUrl?: string;
  streamToken?: string;
  intake?: { problem: string; place: string };
  ts: number;
}

export function rememberFactoryRun(data: Omit<StoredFactoryRun, "ts">): void {
  try {
    localStorage.setItem(CF_FACTORY_RUN_KEY, JSON.stringify({ ...data, ts: Date.now() }));
  } catch {
    /* best-effort: quota / private mode / SSR */
  }
}

export function forgetFactoryRun(): void {
  try {
    localStorage.removeItem(CF_FACTORY_RUN_KEY);
  } catch {
    /* ignore */
  }
}

/** Return the stored run if it is fresh and (optionally) matches campaignId.
 *  A stale or mismatched pointer returns null and is left untouched so a shared
 *  link to a different campaign never clobbers the opener's own run pointer. */
export function getStoredFactoryRun(campaignId?: string): StoredFactoryRun | null {
  let raw: string | null = null;
  try {
    raw = typeof window !== "undefined" ? localStorage.getItem(CF_FACTORY_RUN_KEY) : null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredFactoryRun>;
    if (!parsed.campaignId || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > FACTORY_RUN_RECOVER_MS) return null;
    if (campaignId && parsed.campaignId !== campaignId) return null;
    return parsed as StoredFactoryRun;
  } catch {
    return null;
  }
}
