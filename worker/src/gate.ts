// Concurrency gate (parameters §4). A single in-process fair scheduler:
//   - global active model calls        ≤ 25
//   - per-campaign active model calls   ≤ 8 (public) / 5 (presenter)
//   - concurrent research/tool calls    ≤ 10 (a research call also counts as a
//     model call against the global + per-campaign caps)
//
// Fairness: when slots free up, the waiter belonging to the campaign with the
// FEWEST active grants is served first, so one campaign cannot starve the
// others (campaign-aware round-robin). Single worker replica ⇒ in-memory state
// is authoritative.

import { RUNTIME_LIMITS } from "@web/lib/factory/contracts/limits.js";

export type GateKind = "model" | "research";
export type CampaignMode = "public" | "presenter";

export interface AcquireOptions {
  campaignId: string;
  mode: CampaignMode;
  kind?: GateKind; // default "model"
  signal?: AbortSignal;
}

export type Release = () => void;

interface Waiter {
  campaignId: string;
  mode: CampaignMode;
  kind: GateKind;
  resolve: (release: Release) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class FactoryGate {
  private globalActive = 0;
  private researchActive = 0;
  private readonly perCampaign = new Map<string, number>();
  private readonly waiters: Waiter[] = [];

  private capForMode(mode: CampaignMode): number {
    return mode === "presenter"
      ? RUNTIME_LIMITS.activeCallsPerPresenterCampaign
      : RUNTIME_LIMITS.activeCallsPerPublicCampaign;
  }

  private activeFor(campaignId: string): number {
    return this.perCampaign.get(campaignId) ?? 0;
  }

  private canGrant(w: Waiter): boolean {
    if (this.globalActive >= RUNTIME_LIMITS.globalActiveModelCalls) return false;
    if (this.activeFor(w.campaignId) >= this.capForMode(w.mode)) return false;
    if (w.kind === "research" && this.researchActive >= RUNTIME_LIMITS.concurrentResearchCalls) {
      return false;
    }
    return true;
  }

  private grant(w: Waiter): void {
    this.globalActive++;
    this.perCampaign.set(w.campaignId, this.activeFor(w.campaignId) + 1);
    if (w.kind === "research") this.researchActive++;
    if (w.onAbort && w.signal) w.signal.removeEventListener("abort", w.onAbort);

    let released = false;
    const release: Release = () => {
      if (released) return;
      released = true;
      this.globalActive--;
      const n = this.activeFor(w.campaignId) - 1;
      if (n <= 0) this.perCampaign.delete(w.campaignId);
      else this.perCampaign.set(w.campaignId, n);
      if (w.kind === "research") this.researchActive--;
      this.schedule();
    };
    w.resolve(release);
  }

  private schedule(): void {
    // Greedily grant while any waiter fits, always serving the fewest-active
    // campaign first for fairness.
    // eslint-disable-next-line no-constant-condition
    for (;;) {
      let best: { idx: number; active: number } | null = null;
      for (let i = 0; i < this.waiters.length; i++) {
        const w = this.waiters[i];
        if (!this.canGrant(w)) continue;
        const active = this.activeFor(w.campaignId);
        if (best === null || active < best.active) best = { idx: i, active };
      }
      if (best === null) return;
      const [w] = this.waiters.splice(best.idx, 1);
      this.grant(w);
    }
  }

  acquire(opts: AcquireOptions): Promise<Release> {
    const kind: GateKind = opts.kind ?? "model";
    return new Promise<Release>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(abortError());
        return;
      }
      const waiter: Waiter = {
        campaignId: opts.campaignId,
        mode: opts.mode,
        kind,
        resolve,
        reject,
        signal: opts.signal,
      };
      if (opts.signal) {
        waiter.onAbort = () => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) {
            this.waiters.splice(idx, 1);
            reject(abortError());
          }
        };
        opts.signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      this.schedule();
    });
  }

  snapshot() {
    return {
      globalActive: this.globalActive,
      researchActive: this.researchActive,
      waiting: this.waiters.length,
      campaigns: Object.fromEntries(this.perCampaign),
    };
  }
}

function abortError(): Error {
  const e = new Error("Gate acquire aborted");
  e.name = "AbortError";
  return e;
}

// One gate per worker process.
export const gate = new FactoryGate();
