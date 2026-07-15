"use client";

// Replay renderer. Drives the ReplayPlayer over the manifest's stored public
// events and folds the emitted slice through the SAME W4 fold + W5 gallery as a
// live run — so a recorded run and a live run are visually identical. No
// fetching, no model calls, no writes: onCancel/onAnswerJudgement are omitted so
// the gallery is read-only here.
//
// Playback defaults to CONDENSED mode: the recorded run (20–46 min) plays in
// exactly 15 minutes via a playback-side timeline remap (gaps capped, then
// uniformly scaled — player.ts; the manifest itself is never mutated). An
// honest chip states the compression and toggles back to real time.
//
// Folding is INCREMENTAL: each emitted batch folds only the new events into a
// per-campaign accumulator (fold.ts createFold/foldInto) instead of refolding
// the whole buffer — O(new) per batch, which matters now that worker events are
// 5–10x more verbose.
//
// The "Recorded real run · <date>" label is PERSISTENT and non-dismissable:
// it is shown in the Factory Ledger (connectionLabel), pinned as a fixed badge
// visible in every viewport regardless of scroll, and set as document.title.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFold, foldEvents, foldInto, type FoldAccumulator } from "@/lib/factory/client";
import type { FactoryEvent } from "@/lib/factory/contracts";
import { FactoryGallery, deriveShortName, type GalleryCampaign } from "@/components/factory/gallery";
import { hueIndexForPosition } from "@/components/factory/cards";
import { useReplayPlayer } from "@/lib/factory/replay/useReplayPlayer";
import type { ReplayManifestBody } from "@/lib/factory/replay";
import type { ReplaySpeed } from "@/lib/factory/replay";

const SPEEDS: ReplaySpeed[] = [1, 2, 4];

function clock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ReplayClient({
  body,
  label,
  presenter,
}: {
  body: ReplayManifestBody;
  label: string;
  presenter: boolean;
}) {
  // A stable reference for the player: the manifest events don't change.
  const allEvents = useMemo<FactoryEvent[]>(() => body.events, [body]);

  // Seeded columns (problem/place anchors) shown before the first event lands —
  // identical to the live gallery's seeded placeholders.
  const seedCampaigns = useCallback(
    (): GalleryCampaign[] =>
      body.campaigns.map((c, i) => {
        const run = foldEvents(c.campaignId, [], { problem: c.problem, place: c.place });
        return { run, hue: hueIndexForPosition(i), shortName: deriveShortName(run, i) };
      }),
    [body.campaigns],
  );

  // Incremental per-campaign fold. The accumulators live in a ref and are only
  // touched from the player's batch callbacks (timers/handlers — never render):
  // each flushed batch folds ONLY its new events (fold.ts foldInto), so verbose
  // recordings cost O(new) per flush instead of refolding the whole buffer.
  const [campaigns, setCampaigns] = useState<GalleryCampaign[]>(seedCampaigns);
  const accsRef = useRef<Map<string, FoldAccumulator> | null>(null);

  const resetAccumulators = useCallback(() => {
    accsRef.current = new Map(
      body.campaigns.map((c) => [
        c.campaignId,
        createFold(c.campaignId, { problem: c.problem, place: c.place }),
      ]),
    );
  }, [body.campaigns]);

  const onBatch = useCallback(
    (batch: FactoryEvent[]) => {
      if (!accsRef.current) resetAccumulators();
      const accs = accsRef.current!;
      const byCampaign = new Map<string, FactoryEvent[]>();
      for (const e of batch) {
        const list = byCampaign.get(e.campaignId);
        if (list) list.push(e);
        else byCampaign.set(e.campaignId, [e]);
      }
      setCampaigns(
        body.campaigns.map((c, i) => {
          const acc = accs.get(c.campaignId)!;
          const slice = byCampaign.get(c.campaignId);
          const run = slice && slice.length > 0 ? foldInto(acc, slice) : acc.snapshot;
          return { run, hue: hueIndexForPosition(i), shortName: deriveShortName(run, i) };
        }),
      );
    },
    [body.campaigns, resetAccumulators],
  );

  const onBufferReset = useCallback(() => {
    resetAccumulators();
    setCampaigns(seedCampaigns());
  }, [resetAccumulators, seedCampaigns]);

  const { state, toggle, jumpToEnd, restart, setSpeed, setMode } = useReplayPlayer(allEvents, {
    autoStart: true,
    initialMode: "condensed",
    onBatch,
    onBufferReset,
  });

  // Spectacle default (user decision, 15 Jul): the session opens at 4x.
  const speedSeeded = useRef(false);
  useEffect(() => {
    if (speedSeeded.current) return;
    speedSeeded.current = true;
    setSpeed(4);
  }, [setSpeed]);

  // Permanent, honest tab title.
  useEffect(() => {
    const prev = document.title;
    document.title = label;
    return () => {
      document.title = prev;
    };
  }, [label]);

  const isPlaying = state.status === "playing";
  const isEnded = state.status === "ended";
  const isCondensed = state.mode === "condensed";

  // Honest compression label: real recorded span → the condensed target.
  const liveMinutes = Math.max(1, Math.round(state.totalMs / 60000));
  const condensedChip = `Condensed · ${liveMinutes} min live run → ${clock(state.playbackTotalMs)}`;

  return (
    <div>
      {/* Persistent, non-dismissable label — fixed so it is present in every
          viewport regardless of horizontal ledger scroll. */}
      <div
        aria-live="off"
        style={{
          position: "fixed",
          top: 8,
          right: 12,
          zIndex: 50,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.02em",
          background: "rgba(22,24,27,0.94)",
          color: "#f2f3f5",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 999,
          padding: "5px 12px",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "#f2c14e",
            display: "inline-block",
          }}
          aria-hidden
        />
        {label}
      </div>

      {/* The gallery renderer — identical to live. connectionLabel puts the same
          permanent label into the Factory Ledger area. No live handlers. */}
      <FactoryGallery campaigns={campaigns} now={state.virtualNowMs} connectionLabel={label} />

      {/* Playback controls. Play/pause/jump/replay + condensed toggle for
          everyone; the speed multiplier is presenter-only (rehearsal aid). */}
      <div
        role="group"
        aria-label="Replay controls"
        style={{
          position: "fixed",
          bottom: 14,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(22,24,27,0.94)",
          color: "#f2f3f5",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999,
          padding: "6px 12px",
          fontSize: 12,
        }}
      >
        <button type="button" onClick={toggle} style={btn} aria-label={isPlaying ? "Pause" : isEnded ? "Replay" : "Play"}>
          {isPlaying ? "Pause" : isEnded ? "Replay" : "Play"}
        </button>
        <button type="button" onClick={jumpToEnd} style={btn} aria-label="Jump to end">
          Jump to end
        </button>
        {isEnded ? (
          <button type="button" onClick={restart} style={btn} aria-label="Restart">
            Restart
          </button>
        ) : null}
        <span
          style={{ fontVariantNumeric: "tabular-nums", opacity: 0.75, minWidth: 92, textAlign: "center" }}
        >
          {clock(state.playbackMs)} / {clock(state.playbackTotalMs)}
        </span>
        {/* Honest condensed-mode chip, doubles as the real-time toggle. */}
        <button
          type="button"
          onClick={() => setMode(isCondensed ? "realtime" : "condensed")}
          aria-pressed={isCondensed}
          title={
            isCondensed
              ? `Playing the ${liveMinutes} min recorded run in ${clock(state.playbackTotalMs)}. Click for real time.`
              : "Click to condense playback to 15 minutes"
          }
          style={{
            ...btn,
            padding: "3px 10px",
            fontSize: 11,
            whiteSpace: "nowrap",
            background: isCondensed ? "rgba(246,193,78,0.16)" : "transparent",
            borderColor: isCondensed ? "rgba(246,193,78,0.5)" : "rgba(255,255,255,0.16)",
            color: isCondensed ? "#f6d873" : "#f2f3f5",
          }}
        >
          {isCondensed ? condensedChip : `Real time · ${liveMinutes} min`}
        </button>
        {presenter ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, opacity: 0.9 }}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                aria-pressed={state.speed === s}
                style={{
                  ...btn,
                  padding: "3px 8px",
                  background: state.speed === s ? "rgba(138,208,255,0.22)" : "transparent",
                  borderColor: state.speed === s ? "rgba(138,208,255,0.5)" : "rgba(255,255,255,0.16)",
                }}
              >
                {s}x
              </button>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  appearance: "none",
  cursor: "pointer",
  background: "transparent",
  color: "#f2f3f5",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  lineHeight: 1.2,
};
