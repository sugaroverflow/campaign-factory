"use client";

// useFactoryRun — the client event runtime (W4). Owns the browser side of the
// SSE/polling protocol and folds FactoryEvents into the RunVM via the pure fold.
// W5's gallery builds on this hook; W7's replay reuses foldEvents directly.
//
// Transport (parameters §4, contracts/api.ts):
//  - Bootstrap: GET /api/factory/runs/[id]?after=0 → RunReadModel, fold the full
//    public log so late joiners / refreshes paint immediately.
//  - Live: EventSource on the run-scoped SSE stream (event name "factory",
//    id = sequence). Native reconnect resumes via Last-Event-ID.
//  - Fallback: if SSE cannot stay connected, poll the web read API every 2.5s
//    with ?after=<lastSeq>. Polling never affects worker execution.
//  - Everything folds through the SAME foldEvents — live and replay are identical.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SSE_EVENT_NAME,
  WORKER_PATHS,
  type FactoryEvent,
  type JudgementAnswerRequest,
  type RunReadModel,
} from "@/lib/factory/contracts";
import { foldEvents, type FoldSeed, type RunVM } from "./fold";

export type ConnectionState =
  | "connecting"
  | "live" // SSE open
  | "polling" // SSE unavailable, polling the read API
  | "reconnecting" // SSE dropped, trying to recover before falling back
  | "closed" // run reached a terminal state; streams stopped
  | "error"; // no transport available (worker/route not reachable)

const POLL_INTERVAL_MS = 2500;
const SSE_RECONNECT_GRACE_MS = 6000; // if SSE can't reconnect within this, poll
const POLL_ENDPOINT = (id: string, after: number) =>
  `/api/factory/runs/${encodeURIComponent(id)}?after=${after}`;

export interface UseFactoryRunOptions {
  campaignId: string;
  streamUrl?: string; // absolute SSE URL incl. token + after (StartRunResponse)
  streamToken?: string; // used to build the SSE URL if streamUrl is absent
  seed?: FoldSeed; // problem/place echo, shown before the first event lands
  enabled?: boolean; // default true; false for fixture-driven previews
}

export interface UseFactoryRunResult {
  run: RunVM;
  connection: ConnectionState;
  answerJudgement: (
    judgementId: string,
    action: JudgementAnswerRequest["action"],
    answer?: string,
  ) => Promise<boolean>;
}

function isTerminalStatus(s: RunVM["status"]): boolean {
  return s === "completed" || s === "partial" || s === "failed" || s === "cancelled";
}

/** Rewrite the `after` query param of an absolute SSE URL to resume by sequence. */
function withAfter(url: string, after: number): string {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : undefined);
    u.searchParams.set("after", String(after));
    return u.toString();
  } catch {
    return url;
  }
}

export function useFactoryRun(opts: UseFactoryRunOptions): UseFactoryRunResult {
  const { campaignId, streamUrl, streamToken, seed, enabled = true } = opts;

  const [events, setEvents] = useState<FactoryEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionState>(enabled ? "connecting" : "closed");

  // mutable buffers (avoid stale closures inside listeners/timers)
  const eventMapRef = useRef<Map<number, FactoryEvent>>(new Map());
  const lastSeqRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<number | null>(null);
  const terminalRef = useRef(false);
  const modeRef = useRef<"idle" | "sse" | "polling">("idle");

  // `seed` (problem/place echo from localStorage) is a stable object across
  // renders (callers memoize it), so it is safe as a direct memo dependency.
  const run = useMemo(() => foldEvents(campaignId, events, seed), [campaignId, events, seed]);

  // keep terminal flag in sync so timers/listeners can stop cleanly
  useEffect(() => {
    terminalRef.current = isTerminalStatus(run.status);
  }, [run.status]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let disposed = false;

    const flush = () => {
      flushRef.current = null;
      setEvents(Array.from(eventMapRef.current.values()));
    };
    const scheduleFlush = () => {
      if (flushRef.current != null) return;
      flushRef.current =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(flush)
          : (setTimeout(flush, 16) as unknown as number);
    };
    const ingest = (incoming: FactoryEvent[]) => {
      let changed = false;
      for (const e of incoming) {
        if (typeof e.sequence !== "number") continue;
        const prev = eventMapRef.current.get(e.sequence);
        if (!prev) {
          eventMapRef.current.set(e.sequence, e);
          changed = true;
        } else if (
          // Resends carry the freshest payload (fold contract, fold.ts
          // normaliseEvents): OVERWRITE duplicates, never drop them. Skip the
          // flush only for byte-identical repeats (routine poll overlap).
          prev.eventId !== e.eventId ||
          prev.at !== e.at ||
          prev.stateVersion !== e.stateVersion ||
          JSON.stringify(prev.payload) !== JSON.stringify(e.payload)
        ) {
          eventMapRef.current.set(e.sequence, e);
          changed = true;
        }
        if (e.sequence > lastSeqRef.current) lastSeqRef.current = e.sequence;
      }
      if (changed) scheduleFlush();
    };

    const clearGrace = () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
    const stopPolling = () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    const closeSse = () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };

    const finishIfTerminal = () => {
      if (terminalRef.current && !disposed) {
        // one more poll happens on the next tick to catch trailing events, then stop
        setTimeout(() => {
          if (disposed) return;
          closeSse();
          stopPolling();
          clearGrace();
          modeRef.current = "idle";
          setConnection("closed");
        }, POLL_INTERVAL_MS);
      }
    };

    const pollOnce = async () => {
      try {
        const r = await fetch(POLL_ENDPOINT(campaignId, lastSeqRef.current), { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as RunReadModel;
        if (disposed) return;
        if (Array.isArray(data.events)) ingest(data.events);
        if (typeof data.lastSequence === "number" && data.lastSequence > lastSeqRef.current) {
          lastSeqRef.current = data.lastSequence;
        }
        if (modeRef.current === "polling") setConnection("polling");
        finishIfTerminal();
      } catch {
        // A single failed poll is not fatal; keep trying. If we never reach the
        // worker/route at all we surface "error" but retain the seed hero.
        if (!disposed && modeRef.current === "polling" && eventMapRef.current.size === 0) {
          setConnection("error");
        }
      }
    };

    const startPolling = () => {
      if (modeRef.current === "polling") return;
      modeRef.current = "polling";
      closeSse();
      clearGrace();
      setConnection("polling");
      void pollOnce();
      stopPolling();
      pollTimerRef.current = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
    };

    const startSse = () => {
      const base =
        streamUrl ||
        (streamToken && process.env.NEXT_PUBLIC_FACTORY_WORKER_URL
          ? `${process.env.NEXT_PUBLIC_FACTORY_WORKER_URL}${WORKER_PATHS.events(campaignId)}?token=${encodeURIComponent(streamToken)}&after=0`
          : undefined);
      if (!base || typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      modeRef.current = "sse";
      setConnection((c) => (c === "closed" ? c : "connecting"));
      let es: EventSource;
      try {
        es = new EventSource(withAfter(base, lastSeqRef.current));
      } catch {
        startPolling();
        return;
      }
      esRef.current = es;

      es.onopen = () => {
        if (disposed) return;
        clearGrace();
        setConnection("live");
      };
      es.addEventListener(SSE_EVENT_NAME, (ev) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse((ev as MessageEvent).data) as FactoryEvent;
          ingest([parsed]);
          setConnection("live");
          finishIfTerminal();
        } catch {
          /* ignore malformed frame */
        }
      });
      es.onerror = () => {
        if (disposed) return;
        if (terminalRef.current) return; // expected close at end of run
        // EventSource will retry on its own; give it a grace window, then poll.
        setConnection("reconnecting");
        if (!graceTimerRef.current) {
          graceTimerRef.current = setTimeout(() => {
            graceTimerRef.current = null;
            if (!disposed && modeRef.current === "sse") startPolling();
          }, SSE_RECONNECT_GRACE_MS);
        }
      };
    };

    // Bootstrap the full public log (late joiners + first paint), then go live.
    const boot = async () => {
      try {
        const r = await fetch(POLL_ENDPOINT(campaignId, 0), { cache: "no-store" });
        if (r.ok) {
          const data = (await r.json()) as RunReadModel;
          if (!disposed && Array.isArray(data.events)) ingest(data.events);
          if (!disposed && typeof data.lastSequence === "number") {
            lastSeqRef.current = Math.max(lastSeqRef.current, data.lastSequence);
          }
        }
      } catch {
        /* read API not up yet — SSE (if any) is still our path */
      }
      if (disposed) return;
      if (terminalRef.current) {
        setConnection("closed");
        return;
      }
      startSse();
    };

    void boot();

    return () => {
      disposed = true;
      closeSse();
      stopPolling();
      clearGrace();
      if (flushRef.current != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(flushRef.current);
      }
    };
    // Re-establish only when the run identity or stream coordinates change.
  }, [campaignId, streamUrl, streamToken, enabled]);

  const answerJudgement = useCallback(
    async (
      judgementId: string,
      action: JudgementAnswerRequest["action"],
      answer?: string,
    ): Promise<boolean> => {
      try {
        const body: JudgementAnswerRequest = { action, ...(answer ? { answer } : {}) };
        const r = await fetch(
          `/api/factory/runs/${encodeURIComponent(campaignId)}/judgements/${encodeURIComponent(judgementId)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        return r.ok;
      } catch {
        return false;
      }
    },
    [campaignId],
  );

  return { run, connection, answerJudgement };
}
