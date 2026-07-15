"use client";

// React binding for the framework-neutral ReplayPlayer. Owns the accumulated
// event buffer that the player feeds; the consuming route folds this buffer
// through the SAME W4 fold + W5 gallery as a live run. Keeping the player itself
// react-free (player.ts) means this hook is the only client-coupled piece.
//
// Emitted events are batched and flushed to React state at most once per
// FLUSH_INTERVAL_MS — condensed playback can cross many events per animation
// frame, and per-frame setState would re-fold and re-render the whole gallery
// at frame rate. Status changes (pause/ended) flush immediately.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FactoryEvent } from "../contracts/core";
import {
  ReplayPlayer,
  initialReplayState,
  type ReplayMode,
  type ReplayPlayerState,
  type ReplaySpeed,
} from "./player";

const FLUSH_INTERVAL_MS = 120;

const EMPTY_EVENTS: FactoryEvent[] = [];

export interface UseReplayPlayerResult {
  events: FactoryEvent[]; // emitted so far, oldest → newest
  state: ReplayPlayerState;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  jumpToEnd: () => void;
  restart: () => void;
  setSpeed: (speed: ReplaySpeed) => void;
  setMode: (mode: ReplayMode) => void;
}

export interface UseReplayPlayerOptions {
  autoStart?: boolean;
  /** Initial playback mode; runtime toggles go through setMode (no player
   *  teardown, position preserved). */
  initialMode?: ReplayMode;
  condensedTargetMs?: number;
  condensedMaxGapMs?: number;
  /** Called OUTSIDE render with each flushed batch (the same events appended to
   *  `events`), so consumers can fold incrementally instead of re-deriving from
   *  the whole buffer. Invoked from timers/handlers, never during render. */
  onBatch?: (batch: FactoryEvent[]) => void;
  /** Called when playback resets (restart) and the buffer clears. */
  onBufferReset?: () => void;
}

export function useReplayPlayer(
  allEvents: FactoryEvent[],
  opts: UseReplayPlayerOptions = {},
): UseReplayPlayerResult {
  const autoStart = opts.autoStart ?? false;
  const initialMode = opts.initialMode ?? "realtime";
  const condensedTargetMs = opts.condensedTargetMs;
  const condensedMaxGapMs = opts.condensedMaxGapMs;

  const initialState = useMemo<ReplayPlayerState>(
    () => initialReplayState(allEvents, { mode: initialMode, condensedTargetMs, condensedMaxGapMs }),
    [allEvents, initialMode, condensedTargetMs, condensedMaxGapMs],
  );

  // The emitted buffer is keyed by its source array: when `allEvents` changes
  // the stale buffer is ignored at derivation time (no setState-in-effect) and
  // replaced by the new player's first flush.
  const [buffer, setBuffer] = useState<{ source: FactoryEvent[]; list: FactoryEvent[] }>({
    source: allEvents,
    list: [],
  });
  const events = buffer.source === allEvents ? buffer.list : EMPTY_EVENTS;
  const [state, setState] = useState<ReplayPlayerState>(initialState);
  const playerRef = useRef<ReplayPlayer | null>(null);
  const pendingRef = useRef<FactoryEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest consumer callbacks, held in refs (updated in an effect) so the
  // player never needs rebuilding when a consumer re-memoizes a handler.
  const onBatchRef = useRef<UseReplayPlayerOptions["onBatch"]>(undefined);
  const onBufferResetRef = useRef<UseReplayPlayerOptions["onBufferReset"]>(undefined);
  useEffect(() => {
    onBatchRef.current = opts.onBatch;
    onBufferResetRef.current = opts.onBufferReset;
  });

  useEffect(() => {
    pendingRef.current = [];

    const flushNow = () => {
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      const batch = pendingRef.current;
      if (batch.length === 0) return;
      pendingRef.current = [];
      setBuffer((prev) =>
        prev.source === allEvents
          ? { source: allEvents, list: [...prev.list, ...batch] }
          : { source: allEvents, list: [...batch] },
      );
      onBatchRef.current?.(batch);
    };

    const player = new ReplayPlayer(
      allEvents,
      {
        onEmit: (batch) => {
          if (batch.length === 0) return;
          pendingRef.current.push(...batch);
          if (flushTimerRef.current == null) {
            flushTimerRef.current = setTimeout(flushNow, FLUSH_INTERVAL_MS);
          }
        },
        onReset: () => {
          pendingRef.current = [];
          if (flushTimerRef.current != null) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          setBuffer({ source: allEvents, list: [] });
          onBufferResetRef.current?.();
        },
        onState: (s) => {
          // Terminal/paused states should render their final events immediately
          // (jump-to-end must not wait out the flush interval).
          if (s.status === "ended" || s.status === "paused") flushNow();
          setState(s);
        },
      },
      { autoStart, mode: initialMode, condensedTargetMs, condensedMaxGapMs },
    );
    playerRef.current = player;
    setState(player.getState());
    return () => {
      player.dispose();
      playerRef.current = null;
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingRef.current = [];
    };
    // initialMode/target/gap are initial-config only: changing them mid-flight
    // goes through setMode, not a player rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEvents, autoStart]);

  const play = useCallback(() => playerRef.current?.play(), []);
  const pause = useCallback(() => playerRef.current?.pause(), []);
  const toggle = useCallback(() => playerRef.current?.toggle(), []);
  const jumpToEnd = useCallback(() => playerRef.current?.jumpToEnd(), []);
  const restart = useCallback(() => playerRef.current?.restart(), []);
  const setSpeed = useCallback((speed: ReplaySpeed) => playerRef.current?.setSpeed(speed), []);
  const setMode = useCallback((mode: ReplayMode) => playerRef.current?.setMode(mode), []);

  return { events, state, play, pause, toggle, jumpToEnd, restart, setSpeed, setMode };
}
