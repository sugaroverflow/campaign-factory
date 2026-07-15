"use client";

// Dev preview harness (W4). Feeds the canned FactoryEvent fixture through the
// REAL fold and the REAL AssemblyView, revealing events over time so the UI is
// demonstrable before the worker is live. It is clearly labelled as a fixture
// and makes no network calls — it never fabricates a real run.

import { useEffect, useMemo, useState } from "react";
import { foldEvents } from "@/lib/factory/client";
import type { FactoryEvent } from "@/lib/factory/contracts";
import { AssemblyView } from "@/components/factory/assembly/AssemblyView";
import { FIXTURE_CAMPAIGN_ID, FIXTURE_EVENTS, FIXTURE_SEED } from "@/lib/factory/client/fixtures";

const REVEAL_MS = 1100;

// Shift fixture timestamps so elapsed clocks read plausibly against a live now.
function shift(events: FactoryEvent[], offsetMs: number): FactoryEvent[] {
  return events.map((e) => {
    const t = Date.parse(e.at);
    return Number.isNaN(t) ? e : { ...e, at: new Date(t + offsetMs).toISOString() };
  });
}

export function FixturePreview() {
  // one-time offset so the fixture's fixed timestamps read as "seconds ago"
  // against the live clock (lazy initializer — computed once, not per render).
  const [shifted] = useState<FactoryEvent[]>(() => {
    const first = Date.parse(FIXTURE_EVENTS[0]?.at ?? new Date().toISOString());
    return shift(FIXTURE_EVENTS, Date.now() - first - 4000);
  });

  const [count, setCount] = useState(2);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    if (count >= shifted.length) return;
    const t = setTimeout(() => setCount((c) => Math.min(c + 1, shifted.length)), REVEAL_MS);
    return () => clearTimeout(t);
  }, [count, playing, shifted.length]);

  const run = useMemo(
    () => foldEvents(FIXTURE_CAMPAIGN_ID, shifted.slice(0, count), FIXTURE_SEED),
    [shifted, count],
  );

  const noop = async () => true;

  return (
    <main className="min-h-dvh">
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 60,
          display: "flex",
          gap: ".6rem",
          alignItems: "center",
          flexWrap: "wrap",
          background: "var(--pale-yellow)",
          padding: ".5rem 1rem",
          fontSize: ".82rem",
        }}
      >
        <b>DEV PREVIEW · fixture events</b>
        <span>
          {count} / {shifted.length} events revealed
        </span>
        <button className="toolbtn" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button className="toolbtn" onClick={() => setCount((c) => Math.min(c + 1, shifted.length))}>
          Step +1
        </button>
        <button className="toolbtn" onClick={() => setCount(shifted.length)}>
          Reveal all
        </button>
        <button
          className="toolbtn"
          onClick={() => {
            setCount(2);
            setPlaying(true);
          }}
        >
          Restart
        </button>
      </div>
      <AssemblyView run={run} connection="live" onAnswer={noop} isFixture />
    </main>
  );
}
