"use client";

// Agent Build Bar (14 Jul 2026 redesign, graft 1). ALL the live theatre in one
// slim bar near the top of the campaign brief: which agents are working and
// what each is doing right now, read straight from the fold's AgentCardVMs
// (names, present-tense verbs, last event summaries — nothing invented). The
// sections below stay the calm original Journey design; the bar is rendered
// only while the run is live and disappears once it is terminal.

import { useEffect, useMemo, useState } from "react";
import type { AgentCardVM, RunVM } from "@/lib/factory/client";

const ACTIVE = new Set<AgentCardVM["status"]>(["queued", "running"]);
const MAX_CHIPS = 6;
const ROTATE_MS = 4000;

function tMs(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** What an agent is doing right now, in its own words (fold summary → real
 *  bounded task → roster responsibility). */
function doingLine(a: AgentCardVM): string | undefined {
  return a.lastEvent?.summary || a.task || a.responsibility;
}

export function AgentBuildBar({ run }: { run: RunVM }) {
  const active = useMemo(
    () =>
      run.agents
        .filter((a) => ACTIVE.has(a.status))
        .sort((x, y) => tMs(y.lastEventAt) - tMs(x.lastEventAt)),
    [run.agents],
  );

  // Rotate the "now" line through the active agents so everyone's work gets a
  // moment; a fresh event naturally resurfaces its agent (sorted most-recent
  // first, and the animation keys on the summary).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (active.length < 2) return;
    const iv = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => clearInterval(iv);
  }, [active.length]);

  const current = active.length ? active[tick % active.length] : undefined;
  const currentDoing = current ? doingLine(current) : undefined;

  const chips = active.slice(0, MAX_CHIPS);
  const overflow = active.length - chips.length;

  return (
    <div className="jcontainer">
      <div className="fa-buildbar fa-enter" role="status" aria-live="polite">
        <div className="fa-buildbar__row">
          <span className="fa-buildbar__live">
            {active.length
              ? `${active.length} agent${active.length === 1 ? "" : "s"} at work`
              : "Starting up"}
          </span>
          <span className="fa-buildbar__chips">
            {chips.map((a) => (
              <span className="fa-buildbar__chip" key={a.agentRunId}>
                {a.shortName}
                {a.currentVerb ? (
                  // keyed on the verb so a change re-mounts and re-animates
                  <em className="fa-buildbar__verb" key={a.currentVerb}>
                    {a.currentVerb}
                  </em>
                ) : null}
              </span>
            ))}
            {overflow > 0 ? (
              <span className="fa-buildbar__chip fa-buildbar__chip--more">+{overflow} more</span>
            ) : null}
          </span>
        </div>
        {current && currentDoing ? (
          <div className="fa-buildbar__now" key={`${current.agentRunId}:${currentDoing}`}>
            <b>{current.shortName}</b>
            <span>{currentDoing}</span>
          </div>
        ) : null}
      </div>
      <p className="fa-buildbar__hint">
        This page updates itself — your campaign is usually ready in about 20 minutes. Bookmark it
        and come back.
      </p>
    </div>
  );
}
