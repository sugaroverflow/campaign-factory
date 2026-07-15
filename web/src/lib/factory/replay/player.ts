// Replay playback engine (ADR 0001 / parameters §7). Pure client-side: it takes
// a manifest's public Factory Event array and re-emits the events over time.
// Two playback modes, both leaving the manifest untouched:
//
//  - "realtime": preserves the ORIGINAL inter-event timing relative to run
//    start. A recording of real work, uncompressed (1x). A presenter-only speed
//    multiplier (1x/2x/4x) is offered for rehearsal.
//  - "condensed": a playback-side remap of the recorded timeline into a fixed
//    target duration (default 15 minutes). Each inter-event gap is capped at a
//    maximum (default 8s: long silent model turns become short beats), then the
//    capped timeline is uniformly scaled so the whole run plays in EXACTLY the
//    target. The mapping recordedMs ⇄ condensedMs is a monotonic piecewise-
//    linear function over precomputed per-event offsets (binary search), so
//    pause/seek/speed all keep working against the condensed clock, and the
//    emitted `virtualNowMs` stays in the run's ORIGINAL time frame — the fold
//    and gallery see the same clock a live viewer saw.
//
// The emitted events feed the SAME pure fold W4 built (foldEvents) through the
// SAME W5 gallery renderer, so live and recorded runs render identically. The
// player itself is framework-neutral (no react, no next, no EventSource); the
// clock + frame scheduler are injectable so it is unit-testable off the DOM.

import type { FactoryEvent } from "../contracts/core";

export type ReplaySpeed = 1 | 2 | 4;

export type ReplayStatus = "idle" | "playing" | "paused" | "ended";

export type ReplayMode = "realtime" | "condensed";

/** Condensed-mode defaults: play any recorded run in exactly 15 minutes,
 *  capping dead air between events at 8 seconds before uniform scaling. */
export const CONDENSED_TARGET_MS = 15 * 60000;
export const CONDENSED_MAX_GAP_MS = 8000;

export interface ReplayPlayerState {
  status: ReplayStatus;
  speed: ReplaySpeed;
  mode: ReplayMode;
  /** Playback position in the run's ORIGINAL time frame, ms (0 .. totalMs). */
  virtualMs: number;
  /** Full recorded duration (last event offset), ms. */
  totalMs: number;
  /** startMs + virtualMs — the playback clock in the run's ORIGINAL time frame.
   *  Pass this as `now` to the gallery so completion choreography matches live. */
  virtualNowMs: number;
  /** ms of the first recorded event (the run-start anchor). */
  startMs: number;
  /** Position on the ACTIVE playback clock (condensed ms in condensed mode,
   *  recorded ms in realtime). This is what the transport clock should show. */
  playbackMs: number;
  /** Total duration of the active playback clock (the condensed target in
   *  condensed mode, the recorded total in realtime). */
  playbackTotalMs: number;
  emittedCount: number;
  total: number;
}

export interface ReplayPlayerCallbacks {
  /** Newly crossed events, in order. The consumer appends them to its buffer. */
  onEmit?: (events: FactoryEvent[]) => void;
  /** State change (status/speed/mode) or throttled progress tick. */
  onState?: (state: ReplayPlayerState) => void;
  /** Playback was reset to the start; the consumer clears its buffer. */
  onReset?: () => void;
}

export interface ReplayPlayerOptions {
  autoStart?: boolean;
  speed?: ReplaySpeed;
  /** Initial playback mode (default "realtime"; the pinned conference replay
   *  passes "condensed"). Toggle at runtime with setMode(). */
  mode?: ReplayMode;
  condensedTargetMs?: number;
  condensedMaxGapMs?: number;
  /** Minimum ms between progress `onState` ticks (default 200). Status changes
   *  always fire immediately regardless of this. */
  progressIntervalMs?: number;
  clock?: () => number; // monotonic ms
  schedule?: (cb: () => void) => unknown; // frame scheduler
  cancel?: (handle: unknown) => void;
}

export interface ReplayTimeline {
  ordered: FactoryEvent[];
  offsets: number[]; // per-event run-relative ms, monotonic non-decreasing
  startMs: number;
  totalMs: number;
}

function parseAt(e: FactoryEvent): number {
  const t = Date.parse(e.at);
  return Number.isFinite(t) ? t : NaN;
}

/** Sort events by wall time (then sequence) and compute run-relative offsets.
 *  Tolerates missing/invalid timestamps by holding the previous offset. */
export function prepareReplayTimeline(events: FactoryEvent[]): ReplayTimeline {
  const withT = events.map((e) => ({ e, t: parseAt(e) }));
  const valid = withT.filter((x) => Number.isFinite(x.t));
  const startMs = valid.length ? Math.min(...valid.map((x) => x.t)) : 0;

  const sorted = [...withT].sort((a, b) => {
    const at = Number.isFinite(a.t) ? a.t : startMs;
    const bt = Number.isFinite(b.t) ? b.t : startMs;
    if (at !== bt) return at - bt;
    return (a.e.sequence ?? 0) - (b.e.sequence ?? 0);
  });

  const ordered: FactoryEvent[] = [];
  const offsets: number[] = [];
  let prev = 0;
  for (const { e, t } of sorted) {
    const off = Number.isFinite(t) ? Math.max(0, t - startMs) : prev;
    const mono = Math.max(off, prev);
    ordered.push(e);
    offsets.push(mono);
    prev = mono;
  }
  const totalMs = offsets.length ? offsets[offsets.length - 1] : 0;
  return { ordered, offsets, startMs, totalMs };
}

/** Build condensed per-event offsets: cap every inter-event gap at maxGapMs,
 *  then uniformly scale so the last event lands EXACTLY on targetMs. Pure math
 *  over the recorded offsets — the manifest is never mutated. */
export function buildCondensedOffsets(
  offsets: number[],
  targetMs: number = CONDENSED_TARGET_MS,
  maxGapMs: number = CONDENSED_MAX_GAP_MS,
): { offsets: number[]; totalMs: number } {
  if (offsets.length === 0) return { offsets: [], totalMs: 0 };
  const capped: number[] = new Array(offsets.length);
  let acc = 0;
  let prev = 0;
  for (let i = 0; i < offsets.length; i++) {
    const gap = Math.max(0, offsets[i] - prev);
    acc += Math.min(gap, maxGapMs);
    capped[i] = acc;
    prev = offsets[i];
  }
  const cappedTotal = capped[capped.length - 1];
  if (cappedTotal <= 0) {
    // Degenerate single-instant recording: everything plays at once.
    return { offsets: capped.map(() => 0), totalMs: 0 };
  }
  const scale = targetMs / cappedTotal;
  return { offsets: capped.map((c) => c * scale), totalMs: targetMs };
}

/** Monotonic piecewise-linear map through the breakpoints (xs[i], ys[i]).
 *  Clamps outside the domain; tolerates flat (duplicate-x) segments. */
export function mapMonotonic(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  // Clamp below the first breakpoint (in practice both frames start at 0).
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo];
  const x1 = xs[hi];
  const y0 = ys[lo];
  const y1 = ys[hi];
  if (x1 <= x0) return y1;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

export interface InitialReplayStateOptions {
  mode?: ReplayMode;
  condensedTargetMs?: number;
  condensedMaxGapMs?: number;
}

/** The pre-playback state a consumer can render before constructing a player. */
export function initialReplayState(
  events: FactoryEvent[],
  opts: InitialReplayStateOptions = {},
): ReplayPlayerState {
  const tl = prepareReplayTimeline(events);
  const mode = opts.mode ?? "realtime";
  const cond = buildCondensedOffsets(tl.offsets, opts.condensedTargetMs, opts.condensedMaxGapMs);
  return {
    status: "idle",
    speed: 1,
    mode,
    virtualMs: 0,
    totalMs: tl.totalMs,
    virtualNowMs: tl.startMs,
    startMs: tl.startMs,
    playbackMs: 0,
    playbackTotalMs: mode === "condensed" ? cond.totalMs : tl.totalMs,
    emittedCount: 0,
    total: tl.ordered.length,
  };
}

const defaultClock = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const defaultSchedule = (cb: () => void): unknown =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => cb()) : setTimeout(cb, 16);

const defaultCancel = (h: unknown): void => {
  if (h == null) return;
  if (typeof cancelAnimationFrame === "function" && typeof h === "number") cancelAnimationFrame(h);
  else clearTimeout(h as ReturnType<typeof setTimeout>);
};

export class ReplayPlayer {
  private readonly timeline: ReplayTimeline;
  private readonly condensedOffsets: number[];
  private readonly condensedTotalMs: number;
  private readonly cb: ReplayPlayerCallbacks;
  private readonly clock: () => number;
  private readonly schedule: (cb: () => void) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly progressIntervalMs: number;

  private status: ReplayStatus = "idle";
  private speed: ReplaySpeed;
  private mode: ReplayMode;
  private playbackMs = 0; // position on the ACTIVE playback clock
  private cursor = 0; // index of next unemitted event

  private anchorReal = 0; // clock() at the last play/rebaseline
  private anchorPlayback = 0; // playbackMs at the last play/rebaseline
  private frame: unknown = null;
  private lastTickAt = 0;

  constructor(events: FactoryEvent[], callbacks: ReplayPlayerCallbacks = {}, opts: ReplayPlayerOptions = {}) {
    this.timeline = prepareReplayTimeline(events);
    const cond = buildCondensedOffsets(
      this.timeline.offsets,
      opts.condensedTargetMs,
      opts.condensedMaxGapMs,
    );
    this.condensedOffsets = cond.offsets;
    this.condensedTotalMs = cond.totalMs;
    this.cb = callbacks;
    this.clock = opts.clock ?? defaultClock;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.cancel = opts.cancel ?? defaultCancel;
    this.progressIntervalMs = opts.progressIntervalMs ?? 200;
    this.speed = opts.speed ?? 1;
    this.mode = opts.mode ?? "realtime";
    this.emitState(true);
    if (opts.autoStart) this.play();
  }

  // ---- clock frame helpers ----

  private playbackOffsets(): number[] {
    return this.mode === "condensed" ? this.condensedOffsets : this.timeline.offsets;
  }

  private playbackTotal(): number {
    return this.mode === "condensed" ? this.condensedTotalMs : this.timeline.totalMs;
  }

  /** Active playback clock → the run's original (recorded) time frame. */
  private toRecorded(pb: number): number {
    if (this.mode !== "condensed") return pb;
    return mapMonotonic(this.condensedOffsets, this.timeline.offsets, pb);
  }

  /** Recorded time frame → active playback clock. */
  private toPlayback(rec: number): number {
    if (this.mode !== "condensed") return rec;
    return mapMonotonic(this.timeline.offsets, this.condensedOffsets, rec);
  }

  getState(): ReplayPlayerState {
    const rec = this.toRecorded(this.playbackMs);
    return {
      status: this.status,
      speed: this.speed,
      mode: this.mode,
      virtualMs: rec,
      totalMs: this.timeline.totalMs,
      virtualNowMs: this.timeline.startMs + rec,
      startMs: this.timeline.startMs,
      playbackMs: this.playbackMs,
      playbackTotalMs: this.playbackTotal(),
      emittedCount: this.cursor,
      total: this.timeline.ordered.length,
    };
  }

  play(): void {
    if (this.status === "playing") return;
    if (this.playbackMs >= this.playbackTotal() && this.cursor >= this.timeline.ordered.length) {
      // Nothing left to play; a fresh viewing needs restart().
      return;
    }
    this.status = "playing";
    this.anchorReal = this.clock();
    this.anchorPlayback = this.playbackMs;
    this.emitState(true);
    this.tick();
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.advanceToNow();
    this.status = "paused";
    this.cancelFrame();
    this.emitState(true);
  }

  toggle(): void {
    if (this.status === "playing") this.pause();
    else if (this.status === "ended") this.restart();
    else this.play();
  }

  jumpToEnd(): void {
    this.cancelFrame();
    this.playbackMs = this.playbackTotal();
    this.emitUpTo(Number.POSITIVE_INFINITY);
    this.status = "ended";
    this.emitState(true);
  }

  /** Reset to the start and begin playing again. Fires onReset so the consumer
   *  clears its accumulated event buffer. */
  restart(): void {
    this.cancelFrame();
    this.cursor = 0;
    this.playbackMs = 0;
    this.status = "idle";
    this.cb.onReset?.();
    this.emitState(true);
    this.play();
  }

  setSpeed(speed: ReplaySpeed): void {
    if (this.status === "playing") this.advanceToNow(); // rebaseline before switching rate
    this.speed = speed;
    if (this.status === "playing") {
      this.anchorReal = this.clock();
      this.anchorPlayback = this.playbackMs;
    }
    this.emitState(true);
  }

  /** Switch between condensed and realtime playback, preserving the current
   *  position in the run's ORIGINAL time frame (the fold's clock never jumps). */
  setMode(mode: ReplayMode): void {
    if (mode === this.mode) return;
    if (this.status === "playing") this.advanceToNow();
    const rec = this.toRecorded(this.playbackMs);
    this.mode = mode;
    this.playbackMs = Math.min(this.toPlayback(rec), this.playbackTotal());
    if (this.status === "playing") {
      this.anchorReal = this.clock();
      this.anchorPlayback = this.playbackMs;
    }
    this.emitState(true);
  }

  dispose(): void {
    this.cancelFrame();
  }

  // ---- internals ----

  private advanceToNow(): void {
    const real = this.clock();
    let v = this.anchorPlayback + (real - this.anchorReal) * this.speed;
    if (v < 0) v = 0;
    const total = this.playbackTotal();
    if (v > total) v = total;
    this.playbackMs = v;
    this.emitUpTo(v);
  }

  private tick = (): void => {
    this.frame = null;
    if (this.status !== "playing") return;
    const real = this.clock();
    let v = this.anchorPlayback + (real - this.anchorReal) * this.speed;
    if (v < 0) v = 0;
    const total = this.playbackTotal();
    const ended = v >= total;
    if (ended) v = total;
    this.playbackMs = v;
    this.emitUpTo(ended ? Number.POSITIVE_INFINITY : v);
    if (ended) {
      this.status = "ended";
      this.emitState(true);
      return;
    }
    this.emitState(false);
    this.frame = this.schedule(this.tick);
  };

  private emitUpTo(v: number): void {
    const offsets = this.playbackOffsets();
    const batch: FactoryEvent[] = [];
    while (this.cursor < this.timeline.ordered.length && offsets[this.cursor] <= v) {
      batch.push(this.timeline.ordered[this.cursor]);
      this.cursor += 1;
    }
    if (batch.length) this.cb.onEmit?.(batch);
  }

  private cancelFrame(): void {
    if (this.frame != null) {
      this.cancel(this.frame);
      this.frame = null;
    }
  }

  private emitState(force: boolean): void {
    if (!this.cb.onState) return;
    const now = this.clock();
    if (!force && now - this.lastTickAt < this.progressIntervalMs) return;
    this.lastTickAt = now;
    this.cb.onState(this.getState());
  }
}
