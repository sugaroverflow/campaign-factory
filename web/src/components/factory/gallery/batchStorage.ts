// Presenter batch recovery (mirrors W4's cf_factory_run localStorage pattern).
// After POST /api/factory/batches returns a StartBatchResponse, the presenter
// intake page stores the per-campaign stream coordinates + intake echo here,
// then redirects to /factory/gallery/[batchId]. On refresh the gallery recovers
// the streams and repaints immediately.
//
// NOTE: this stores short-lived, run-scoped STREAM TOKENS only. The presenter
// CODE is never written here (ADR 0013) — it lives only in the HttpOnly cookie.

export interface StoredBatchConnection {
  campaignId: string;
  streamUrl?: string;
  streamToken?: string;
  intake?: { problem: string; place: string };
}

export interface StoredBatch {
  batchId: string;
  connections: StoredBatchConnection[];
  ts: number;
}

const KEY = (batchId: string) => `cf_factory_batch:${batchId}`;
// Matches the campaign hard limit + headroom; an expired stream token just drops
// the gallery to the polling read model.
const RECOVER_MS = 90 * 60 * 1000;

export function rememberBatch(batchId: string, connections: StoredBatchConnection[]): void {
  try {
    localStorage.setItem(KEY(batchId), JSON.stringify({ batchId, connections, ts: Date.now() }));
  } catch {
    /* best-effort: quota / private mode / SSR */
  }
}

export function getBatch(batchId: string): StoredBatch | null {
  let raw: string | null = null;
  try {
    raw = typeof window !== "undefined" ? localStorage.getItem(KEY(batchId)) : null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBatch>;
    if (!parsed.batchId || !Array.isArray(parsed.connections) || typeof parsed.ts !== "number") {
      return null;
    }
    if (Date.now() - parsed.ts > RECOVER_MS) return null;
    return parsed as StoredBatch;
  } catch {
    return null;
  }
}

export function forgetBatch(batchId: string): void {
  try {
    localStorage.removeItem(KEY(batchId));
  } catch {
    /* ignore */
  }
}
