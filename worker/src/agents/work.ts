// Coalescing work.update emitter. Parameters §4: an agent may emit at most two
// visible work updates per second; rapid updates coalesce to the latest, while
// tool/state-transition events (source.*, evidence.*) bypass this and are never
// dropped. work.update is best-effort (fire-and-forget) so it never blocks the
// turn or reorders semantic events.

import type { ExecutorDeps } from "./deps.js";

export class WorkEmitter {
  private lastAt = 0;
  private pending: { summary: string; verb?: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: ExecutorDeps,
    private readonly agentKey: string,
    private readonly journeyStep: number | undefined,
    private readonly minIntervalMs = 500, // ≤2/sec
  ) {}

  private nowMs(): number {
    return (this.deps.now?.() ?? new Date()).getTime();
  }

  work(summary: string, verb?: string): void {
    const t = this.nowMs();
    if (t - this.lastAt >= this.minIntervalMs) {
      this.lastAt = t;
      this.pending = null;
      this.send(summary, verb);
      return;
    }
    this.pending = { summary, verb };
    if (!this.timer) {
      const wait = Math.max(0, this.minIntervalMs - (t - this.lastAt));
      this.timer = setTimeout(() => this.flushPending(), wait);
      // Don't keep the worker process alive for a trailing work update.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  private flushPending(): void {
    this.timer = null;
    if (!this.pending) return;
    this.lastAt = this.nowMs();
    const p = this.pending;
    this.pending = null;
    this.send(p.summary, p.verb);
  }

  private send(summary: string, verb?: string): void {
    this.deps
      .emit({
        type: "work.update",
        journeyStep: this.journeyStep,
        payload: { summary, verb, agentKey: this.agentKey },
      })
      .catch((err) => console.error(`[agents] ${this.agentKey}: work.update emit failed:`, err));
  }

  /** Emit any pending update immediately (call at turn end). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushPending();
  }
}
