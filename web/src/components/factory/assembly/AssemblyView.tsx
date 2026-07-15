"use client";

// Public Campaign Assembly View (W4) — presentational. Given a folded RunVM +
// connection state, it renders the ten-step Campaign Brief immediately (all
// sections skeletoned), lays the active Step Workspaces directly above the
// sections they build, shows accepted content as it lands, and never
// auto-jumps. Desktop = Journey rail/rung layout + dark overlay; below ~768px =
// Mobile Compact Build View (no spatial overlay). Pure: no fetching here — the
// live hook (AssemblyClient) or the fixture preview supplies `run`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { foldAgentToCardVM } from "@/components/factory/cards";
import type { AgentCardVM as CardVM } from "@/components/factory/cards";
import {
  JOURNEY_STEPS,
  type JourneyStepKey,
  type JudgementAnswerRequest,
} from "@/lib/factory/contracts";
import {
  activeAgentCount,
  activeAgentsForStep,
  isTerminal,
  unassignedActiveAgents,
  type AgentCardVM as FoldAgentVM,
  type ConnectionState,
  type JudgementVM,
  type RunVM,
} from "@/lib/factory/client";
import { BriefSection } from "./BriefSection";
import { JudgementCard } from "./JudgementCard";
import { StepWorkspace } from "./StepWorkspace";
import { EvidencePanel } from "./EvidencePanel";
import { DocumentLibrary } from "./DocumentLibrary";
import { MobileCompactView } from "./MobileCompactView";
import { ConnectionBadge } from "./ConnectionBadge";
import { campaignShortName } from "./format";
import "./assembly.css";

const JOURNEY_KEYS = new Set<string>(JOURNEY_STEPS.map((s) => s.key));

// one shared ticking clock so W5 cards' elapsed / "Analysis in progress" advance
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [active]);
  return now;
}

function useIsMobile(breakpoint = 768): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 0.02}px)`);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [breakpoint]);
  return mobile;
}

// lightweight scrollspy for the rail "cur" highlight (no auto-scroll)
function useScrollSpy(keys: string[]): string {
  const [active, setActive] = useState("");
  useEffect(() => {
    const els = keys
      .map((k) => document.getElementById(`fa-${k}`))
      .filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id.replace(/^fa-/, ""));
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: 0.01 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [keys]);
  return active;
}

const TERMINAL_STATUSES = new Set(["complete", "partial", "failed"]);

export function AssemblyView({
  run,
  connection,
  onAnswer,
  isFixture = false,
}: {
  run: RunVM;
  connection: ConnectionState;
  onAnswer: (jid: string, action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
  isFixture?: boolean;
}) {
  const now = useNow(!isTerminal(run.status));
  const isMobile = useIsMobile();
  const railKeys = useMemo(() => JOURNEY_STEPS.map((s) => s.key as string), []);
  const activeKey = useScrollSpy(railKeys);

  const shortName = campaignShortName(run.place, run.problem);
  const agentsById = useMemo(() => new Map(run.agents.map((a) => [a.agentRunId, a])), [run.agents]);

  const toCardVm = useCallback(
    (a: FoldAgentVM): CardVM =>
      foldAgentToCardVM(a, {
        campaignId: run.campaignId,
        hue: 0, // single public campaign owns the brand hue
        campaignShortName: shortName,
        parentShortName: a.parentAgentRunId ? agentsById.get(a.parentAgentRunId)?.shortName : undefined,
      }),
    [run.campaignId, shortName, agentsById],
  );

  // route each judgement to a home section by its first affected step key
  const { bySection, orphans } = useMemo(() => {
    const bySection: Record<string, JudgementVM[]> = {};
    const orphans: JudgementVM[] = [];
    for (const j of run.judgements) {
      const home = j.affectedOutputs.find((o) => JOURNEY_KEYS.has(o));
      if (home) (bySection[home] ??= []).push(j);
      else orphans.push(j);
    }
    return { bySection, orphans };
  }, [run.judgements]);

  const completedForStep = useCallback(
    (step: number) => run.agents.filter((a) => TERMINAL_STATUSES.has(a.status) && a.journeyStep === step),
    [run.agents],
  );

  const unassigned = unassignedActiveAgents(run);
  const problem = run.problem || "Building your campaign";
  const statusLine = terminalLine(run) || `${activeAgentCount(run)} agent${activeAgentCount(run) === 1 ? "" : "s"} at work`;

  const hero = (
    <header className="jhero">
      <div className="eyebrow" style={{ display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
        Live campaign assembly · every output requires human review
        <ConnectionBadge state={connection} />
        {isFixture ? <span className="tag mock">Dev preview · fixture events</span> : null}
      </div>
      <h1>{problem}</h1>
      <p className="obj">
        {run.place ? (
          <>
            <b>{run.place}</b> · {statusLine}
          </>
        ) : (
          statusLine
        )}
      </p>
      {isFixture ? (
        <div className="jbanner" style={{ maxWidth: "72ch" }}>
          This is a labelled <b>dev preview</b>. The events are fixtures replayed through the real fold and UI — it
          is not a live run and makes no model calls.
        </div>
      ) : null}
      {run.status === "partial" || run.status === "failed" || run.status === "cancelled" ? (
        <div className="jbanner" style={{ maxWidth: "72ch" }}>
          {run.status === "cancelled"
            ? "This run was cancelled. What completed is kept and shown below — nothing was invented to fill the gaps."
            : "This run didn't fully complete. What's shown is real; unfinished work is listed as gaps, not filled in."}
        </div>
      ) : null}
    </header>
  );

  if (isMobile) {
    return (
      <div className="pb-24">
        {hero}
        <div className="jcontainer">
          <MobileCompactView run={run} now={now} onAnswer={onAnswer} />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <nav className="rail">
        {JOURNEY_STEPS.map((s, i) => (
          <a key={s.key} href={`#fa-${s.key}`} className={activeKey === s.key ? "cur" : ""} title={s.title}>
            {i + 1}
          </a>
        ))}
      </nav>

      {hero}

      {/* active agents not yet mapped to a step (e.g. queued before first step event) */}
      {unassigned.length ? (
        <div className="jcontainer" style={{ paddingTop: "1rem" }}>
          <StepWorkspace title="Getting started" agents={unassigned} toCardVm={toCardVm} now={now} />
        </div>
      ) : null}

      {/* orphan judgements (affect documents / whole campaign) shown up top */}
      {orphans.length ? (
        <div className="jcontainer" style={{ paddingTop: "0.5rem" }}>
          {orphans.map((j) => (
            <JudgementInline key={j.id} judgement={j} onAnswer={onAnswer} />
          ))}
        </div>
      ) : null}

      {JOURNEY_STEPS.map((s) => {
        const section = run.sections[s.key as JourneyStepKey];
        const footer = s.step === 10 ? <DocumentLibrary documents={run.documents} /> : undefined;
        return (
          <BriefSection
            key={s.key}
            id={`fa-${s.key}`}
            section={section}
            activeAgents={activeAgentsForStep(run, s.step)}
            completedAgents={completedForStep(s.step)}
            judgements={bySection[s.key] ?? []}
            toCardVm={toCardVm}
            now={now}
            onAnswer={onAnswer}
            footer={footer}
          />
        );
      })}

      <EvidencePanel
        id="fa-evidence-checks"
        evidence={run.evidence}
        nextChecks={run.nextChecks}
        terminalGaps={run.terminalGaps}
      />
    </div>
  );
}

// small wrapper so orphan judgements reuse the same card without the
// per-section indirection
function JudgementInline({
  judgement,
  onAnswer,
}: {
  judgement: JudgementVM;
  onAnswer: (jid: string, action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
}) {
  return <JudgementCard judgement={judgement} onAnswer={(action, answer) => onAnswer(judgement.id, action, answer)} />;
}

function terminalLine(run: RunVM): string | null {
  switch (run.status) {
    case "completed":
      return "Campaign assembled";
    case "partial":
      return "Partly assembled";
    case "failed":
      return "Run failed";
    case "cancelled":
      return "Run cancelled";
    default:
      return null;
  }
}
