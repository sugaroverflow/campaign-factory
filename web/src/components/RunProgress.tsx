"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { pollRun } from "@/lib/client/api";
import { type RunState, type StageId, type StageStatus } from "@/lib/pipeline/types";

const STAGES: { id: StageId; title: string; desc: string; agent: string }[] = [
  { id: "research", title: "Researching live", desc: "Searching official sources and verifying facts", agent: "scout · verifier" },
  { id: "plan", title: "Building the campaign plan", desc: "Objective, power map, pressure, tactics, organising", agent: "strategy · power · tactics" },
  { id: "drafts", title: "Drafting the materials", desc: "Decision-maker, press and supporter packs", agent: "lobbying · media · digital" },
  { id: "lint", title: "Checking consistency", desc: "Flagging anything unverified", agent: "verifier" },
];

const TERMINAL = new Set(["complete", "partial", "failed"]);

function Dot({ status }: { status: StageStatus }) {
  if (status === "done") return <span className="text-[var(--good)]">✓</span>;
  if (status === "failed") return <span className="text-[var(--bad)]">✕</span>;
  if (status === "running") return <span className="inline-block size-2.5 animate-pulse rounded-full bg-brand" />;
  return <span className="inline-block size-2.5 rounded-full border border-muted-foreground/40" />;
}

export function RunProgress({
  runId,
  onComplete,
  onRetry,
}: {
  runId: string;
  onComplete: (s: RunState) => void;
  onRetry: () => void;
}) {
  const [state, setState] = useState<RunState | null>(null);
  const done = useRef(false);

  useEffect(() => {
    done.current = false;
    let alive = true;
    const tick = async () => {
      const s = await pollRun(runId);
      if (!alive || !s) return;
      setState(s);
      if (TERMINAL.has(s.status) && !done.current) {
        done.current = true;
        // Small delay so the final ticks are visible before we swap views.
        setTimeout(() => alive && onComplete(s), 600);
      }
    };
    void tick();
    const iv = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [runId, onComplete]);

  const notes = state?.notes ?? [];
  const failed = state ? STAGES.filter((s) => state.stages[s.id]?.status === "failed") : [];

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-12">
      <h2 className="text-2xl font-semibold tracking-tight">Building your campaign…</h2>
      <p className="mt-2 text-muted-foreground">
        This runs live and takes a few minutes. You can leave this open — research appears first, then the
        plan and materials.
      </p>

      <ol className="mt-8 space-y-4">
        {STAGES.map((s) => {
          const st = state?.stages[s.id]?.status ?? "pending";
          return (
            <li
              key={s.id}
              className={`flex items-start gap-3 rounded-[var(--r-xl)] border p-4 transition-colors ${
                st === "running" ? "border-brand/40 bg-accent" : "bg-card/40"
              }`}
            >
              <span className="mt-1 flex size-5 items-center justify-center text-sm">
                <Dot status={st} />
              </span>
              <div className="min-w-0">
                <div className="font-medium">{s.title}</div>
                <div className="text-sm text-muted-foreground">{s.desc}</div>
                <div className="mt-1"><span className="agentchip">🤖 {s.agent}</span></div>
                {st === "failed" && state?.stages[s.id]?.error ? (
                  <div className="mt-1 text-xs text-[var(--bad)]">{state.stages[s.id]?.error}</div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Live research feed (secondary) */}
      {notes.length > 0 && (
        <div className="mt-8">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Live feed</div>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {notes.slice(-6).map((n, i) => (
              <li key={i} className="truncate">
                · {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failed.length > 0 && (
        <div className="mt-8 rounded-[var(--r-xl)] border border-[var(--warn)] bg-[var(--tint-yellow)] p-4 text-sm">
          <p className="font-medium text-foreground">
            {failed.length === STAGES.length ? "This run didn't complete." : "Some stages didn't complete."}
          </p>
          <p className="mt-1 text-muted-foreground">
            {failed.length === STAGES.length
              ? "Nothing usable was produced. You can try running it again."
              : "What did complete is kept and shown — nothing is invented to fill the gaps."}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
