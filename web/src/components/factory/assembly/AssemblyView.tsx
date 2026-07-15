"use client";

// Public Campaign Brief (14 Jul 2026 redesign) — presentational. The page IS
// the original Journey design: fixed number rail, hero, and a calm scrollable
// flow of campaign materials as the spine, with exactly four factory grafts:
//   1. the Agent Build Bar near the top carries ALL live theatre (live runs
//      only; it disappears when the run is terminal) — sections below stay the
//      clean original design with skeletons until content lands;
//   2. Decision point cards render inline where they occur;
//   3. Fact checks — the whole evidence/claims apparatus — as ONE section at
//      the bottom;
//   4. a graded receipt as a slim header line (campaignGrade, never red).
// No inline agent workspaces, no contributor pills, no status chips on rungs.
// Pure: no fetching here — the live hook (AssemblyClient) or the fixture
// preview supplies `run`. The page never auto-jumps between sections.

import { useEffect, useMemo, useState } from "react";
import {
  JOURNEY_STEPS,
  type JourneyStepKey,
  type JudgementAnswerRequest,
} from "@/lib/factory/contracts";
import {
  activeAgentCount,
  isTerminal,
  type CompiledCampaignBundle,
  type ConnectionState,
  type JudgementVM,
  type RunVM,
} from "@/lib/factory/client";
import { campaignGrade } from "@/lib/factory/documents";
import { DocumentLibrary as CompiledDocumentLibrary } from "@/components/factory/documents/DocumentLibrary";
import { BriefSection } from "./BriefSection";
import { YourJudgementCard } from "@/components/factory/judgement/YourJudgementCard";
import { AgentBuildBar } from "./AgentBuildBar";
import { EvidencePanel } from "./EvidencePanel";
import { DocumentLibrary } from "./DocumentLibrary";
import { MobileCompactView } from "./MobileCompactView";
import { ConnectionBadge } from "./ConnectionBadge";
import "./assembly.css";

const JOURNEY_KEYS = new Set<string>(JOURNEY_STEPS.map((s) => s.key));

// The nine acceptable sections (step 10 is compiled from document statuses,
// never reviewer-accepted — same denominator as buildCampaignReceipt).
const ACCEPTABLE_STEPS = JOURNEY_STEPS.filter((s) => s.key !== "documents");

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

export function AssemblyView({
  run,
  connection,
  onAnswer,
  compiled = null,
  isFixture = false,
}: {
  run: RunVM;
  connection: ConnectionState;
  onAnswer: (jid: string, action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
  /** W6-compiled document bodies + evidence ledger for a TERMINAL run (from
   *  W2's durable read route). Null during a live run or until the route
   *  responds — the view then keeps its status-only documents grid and tally. */
  compiled?: CompiledCampaignBundle | null;
  isFixture?: boolean;
}) {
  const isMobile = useIsMobile();
  const railKeys = useMemo(() => JOURNEY_STEPS.map((s) => s.key as string), []);
  const activeKey = useScrollSpy(railKeys);
  const terminal = isTerminal(run.status);

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

  const problem = run.problem || "Building your campaign";
  const agents = activeAgentCount(run);
  const liveLine = `${agents} agent${agents === 1 ? "" : "s"} at work`;

  // graded receipt (graft 4): a slim header line, never a card wall
  const acceptedCount = ACCEPTABLE_STEPS.filter(
    (s) => run.sections[s.key as JourneyStepKey].status === "accepted",
  ).length;
  const grade = campaignGrade(acceptedCount, ACCEPTABLE_STEPS.length);

  const hero = (
    <header className="jhero">
      <div className="eyebrow" style={{ display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
        Live campaign · built by the agent factory · every output requires human review
        <ConnectionBadge state={connection} />
        {isFixture ? <span className="tag mock">Dev preview · fixture events</span> : null}
      </div>
      <h1>{problem}</h1>
      <p className="obj">
        {run.place ? <b>{run.place}</b> : null}
        {run.place && !terminal ? " · " : null}
        {!terminal ? liveLine : null}
      </p>
      {terminal ? (
        <p className="fa-grade" data-tone={grade.tone}>
          <span className="fa-grade__dot" aria-hidden />
          {grade.label}
          {grade.tone !== "neutral" ? (
            <span className="fa-grade__detail">
              · {acceptedCount} of {ACCEPTABLE_STEPS.length} sections built
            </span>
          ) : null}
        </p>
      ) : null}
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

  // the Agent Build Bar (graft 1): live runs only, gone once terminal
  const buildBar = !terminal ? <AgentBuildBar run={run} /> : null;

  if (isMobile) {
    return (
      <div className="pb-24">
        {hero}
        {buildBar}
        <div className="jcontainer">
          <MobileCompactView run={run} onAnswer={onAnswer} compiled={compiled} />
        </div>
        <EvidencePanel
          id="fa-evidence-checks"
          evidence={run.evidence}
          nextChecks={run.nextChecks}
          terminalGaps={run.terminalGaps}
          compiled={compiled?.evidence}
        />
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
      {buildBar}

      {/* orphan decision points (affect documents / whole campaign) shown up top */}
      {orphans.length ? (
        <div className="jcontainer" style={{ paddingTop: "0.5rem" }}>
          {orphans.map((j) => (
            <YourJudgementCard key={j.id} judgement={j} onAnswer={(action, answer) => onAnswer(j.id, action, answer)} />
          ))}
        </div>
      ) : null}

      {JOURNEY_STEPS.map((s) => {
        const section = run.sections[s.key as JourneyStepKey];
        // Step 10 footer: full compiled library (bodies + export) once the
        // terminal-run read path responds; honest status-only grid until then.
        const footer =
          s.step === 10 ? (
            compiled ? (
              <CompiledDocumentLibrary
                documents={compiled.documents}
                intro="Built from your accepted campaign brief — copy or download each document once it's ready."
              />
            ) : (
              <DocumentLibrary documents={run.documents} />
            )
          ) : undefined;
        return (
          <BriefSection
            key={s.key}
            id={`fa-${s.key}`}
            section={section}
            judgements={bySection[s.key] ?? []}
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
        compiled={compiled?.evidence}
      />
    </div>
  );
}
