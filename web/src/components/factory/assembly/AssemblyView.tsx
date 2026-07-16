"use client";

// Public Campaign Brief (original-brief redesign, 15 Jul 2026) — presentational.
// The page IS the original legacy Journey design: the fixed number rail, the
// hero, pastel at-a-glance tiles, and one rung per step — sticky numbered aside
// (serif-italic title, plain-English explainer, bordered principle note; NO
// agent chip) with bespoke legacy-vocabulary content on the right. The rail
// carries the ten journey steps PLUS two more in the legacy Sources pattern:
//  11. Sources — the full source register (URLs, dates, tiers), all collapsed;
//  12. Next steps — the fact-check material as plain-English categories, all
//      collapsed. This replaces the old bottom "Fact checks" roll-up.
// The factory grafts stay, restyled into the legacy language: the Agent Build
// Bar during live runs, Decision point cards inline, the slim graded receipt
// line, and the compiled Document Library on step 10.
// Name flip: the hero title is the factory-generated campaign name once it
// exists (fold or register), with the user's original ask + place as the
// caption beneath; before then the problem text is the honest title.
// Pure: no fetching here — the live hook (AssemblyClient) or the fixture
// preview supplies `run`. The page never auto-jumps between sections.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  JOURNEY_STEPS,
  type JourneyStepKey,
  type JudgementAnswerRequest,
} from "@/lib/factory/contracts";
import {
  isTerminal,
  type CompiledCampaignBundle,
  type ConnectionState,
  type JudgementVM,
  type RunVM,
} from "@/lib/factory/client";
import { campaignGrade } from "@/lib/factory/documents";
import { DocumentLibrary as CompiledDocumentLibrary } from "@/components/factory/documents/DocumentLibrary";
import { YourJudgementCard } from "@/components/factory/judgement/YourJudgementCard";
import { AgentBuildBar } from "./AgentBuildBar";
import { BriefSection } from "./BriefSection";
import { ConnectionBadge } from "./ConnectionBadge";
import { DocumentLibrary } from "./DocumentLibrary";
import { NextStepsSection } from "./NextStepsSection";
import { SourcesSection } from "./SourcesSection";
import { EMPTY_BRIEF_REGISTER, type BriefRegister } from "./briefData";
import { NEXT_STEPS_COPY, SOURCES_COPY, STEP_COPY } from "./stepCopy";
import "./assembly.css";

const JOURNEY_KEYS = new Set<string>(JOURNEY_STEPS.map((s) => s.key));
const SOURCES_KEY = "sources";
const NEXT_STEPS_KEY = "next-steps";

// The nine acceptable sections (step 10 is compiled from document statuses,
// never reviewer-accepted — same denominator as buildCampaignReceipt).
const ACCEPTABLE_STEPS = JOURNEY_STEPS.filter((s) => s.key !== "documents");

/** Scroll-reveal + scrollspy in ONE observer (the legacy Journey pattern):
 *  every [data-stage] section reveals once and the top visible one is active. */
function useRevealSpy(): { rootRef: React.RefObject<HTMLDivElement | null>; active: string; revealed: Set<string> } {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-stage]"));
    if (!sections.length) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(new Set(sections.map((s) => s.dataset.stage!)));
    }
    const io = new IntersectionObserver(
      (entries) => {
        setRevealed((prev) => {
          const next = new Set(prev);
          for (const e of entries) if (e.isIntersecting) next.add((e.target as HTMLElement).dataset.stage!);
          return next;
        });
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive((vis[0].target as HTMLElement).dataset.stage!);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: 0.01 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
    // sections mount once (all twelve rungs render skeletons before content)
  }, []);
  return { rootRef, active, revealed };
}

function contentArrayLength(content: unknown, key: string): number {
  if (!content || typeof content !== "object") return 0;
  const v = (content as Record<string, unknown>)[key];
  return Array.isArray(v) ? v.length : 0;
}

export function AssemblyView({
  run,
  connection,
  onAnswer,
  canDecide = true,
  compiled = null,
  register = EMPTY_BRIEF_REGISTER,
  isFixture = false,
}: {
  run: RunVM;
  connection: ConnectionState;
  onAnswer: (jid: string, action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
  /** False for a shared-link viewer (no run token): decision cards show an
   *  honest "only the starter can decide" message instead of a doomed POST. */
  canDecide?: boolean;
  /** W6-compiled document bodies + evidence ledger for a TERMINAL run (from
   *  W2's durable read route). Null during a live run or until the route
   *  responds — the view then keeps its status-only documents grid. */
  compiled?: CompiledCampaignBundle | null;
  /** Server-built source register + claim rows (AssemblyClient keeps it fresh). */
  register?: BriefRegister;
  isFixture?: boolean;
}) {
  const { rootRef, active, revealed } = useRevealSpy();
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

  // Name flip: generated campaign name (fold beats register — it's fresher on
  // a live stream), falling back to the user's problem text while none exists.
  const campaignName = run.campaignName || register.campaignName;
  const problem = run.problem || "";
  const title = campaignName || problem || "Building your campaign";

  // graded receipt (kept graft): a slim header line, never a card wall
  const acceptedCount = ACCEPTABLE_STEPS.filter(
    (s) => run.sections[s.key as JourneyStepKey].status === "accepted",
  ).length;
  const grade = campaignGrade(acceptedCount, ACCEPTABLE_STEPS.length);

  // at-a-glance pastel tiles (honest counts; rendered only when all three exist)
  const tiles = useMemo(() => {
    const out: { cls: string; big: number; s: string }[] = [];
    const nSources = register.sources.length;
    if (nSources) {
      out.push({
        cls: "b",
        big: nSources,
        s: nSources === 1 ? "source checked & labelled" : "sources checked & labelled",
      });
    }
    const nStake = contentArrayLength(run.sections.power.content, "stakeholders");
    if (nStake) out.push({ cls: "p", big: nStake, s: "people & institutions mapped" });
    const nTactics = contentArrayLength(run.sections.tactics.content, "tactics");
    if (nTactics) out.push({ cls: "y", big: nTactics, s: "sequenced tactics" });
    return out;
  }, [register.sources.length, run.sections.power.content, run.sections.tactics.content]);

  const rail: { key: string; title: string }[] = [
    ...JOURNEY_STEPS.map((s) => ({ key: s.key as string, title: STEP_COPY[s.key].short })),
    { key: SOURCES_KEY, title: SOURCES_COPY.short },
    { key: NEXT_STEPS_KEY, title: NEXT_STEPS_COPY.short },
  ];

  return (
    <div className="pb-24" ref={rootRef}>
      {/* fixed number rail (scrollspy) — ten steps + Sources + Next steps */}
      <nav className="rail">
        {rail.map((r, i) => (
          <a key={r.key} href={`#fa-${r.key}`} className={active === r.key ? "cur" : ""} title={r.title}>
            {i + 1}
          </a>
        ))}
      </nav>

      {/* hero */}
      <header className="jhero">
        <div className="eyebrow" style={{ display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
          Live campaign · built by the agent factory · every output requires human review
          <ConnectionBadge state={connection} />
          {isFixture ? <span className="tag mock">Dev preview · fixture events</span> : null}
        </div>
        <h1>{title}</h1>
        {campaignName && (problem || run.place) ? (
          // caption: the user's original ask + place beneath the generated name
          <p className="obj">
            {problem}
            {problem && run.place ? " — " : null}
            {run.place ? <b>{run.place}</b> : null}
          </p>
        ) : run.place ? (
          <p className="obj">
            <b>{run.place}</b>
          </p>
        ) : null}
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
        {/* The graded receipt + honest per-item pills communicate run state;
            the "didn't fully complete" banner is intentionally not rendered. */}
      </header>

      {/* the Agent Build Bar (kept graft): live runs only, gone once terminal */}
      {!terminal ? <AgentBuildBar run={run} /> : null}

      {/* at-a-glance pastel stat tiles (honest counts from the built plan) */}
      {tiles.length >= 3 ? (
        <div className="jcontainer">
          <div className="tiles3">
            {tiles.slice(0, 3).map((t, i) => (
              <div key={i} className={`ptile ${t.cls}`}>
                <div className="big">{t.big}</div>
                <div className="s">{t.s}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* orphan decision points (affect documents / whole campaign) shown up top */}
      {orphans.length ? (
        <div className="jcontainer" style={{ paddingTop: "0.5rem" }}>
          {orphans.map((j) => (
            <YourJudgementCard key={j.id} judgement={j} canDecide={canDecide} onAnswer={(action, answer) => onAnswer(j.id, action, answer)} />
          ))}
        </div>
      ) : null}

      {/* rungs 1–10: the journey steps */}
      {JOURNEY_STEPS.map((s) => {
        const section = run.sections[s.key as JourneyStepKey];
        // Step 10 footer: full compiled library (bodies + Word export) once the
        // terminal-run read path responds; honest status-only grid until then.
        const footer =
          s.step === 10 ? (
            compiled ? (
              <CompiledDocumentLibrary
                documents={compiled.documents}
                intro="Built from your accepted campaign brief — copy or download each document once it's ready."
                showHeading={false}
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
            copy={STEP_COPY[s.key]}
            judgements={bySection[s.key] ?? []}
            onAnswer={onAnswer}
            canDecide={canDecide}
            footer={footer}
            active={active === s.key}
            revealed={revealed.has(s.key)}
            evidenceExtras={
              s.key === "evidence"
                ? { claims: register.claims, sourceCount: register.sources.length }
                : undefined
            }
          />
        );
      })}

      {/* rung 11: the full source register, legacy Sources pattern */}
      <SourcesSection
        id={`fa-${SOURCES_KEY}`}
        stageKey={SOURCES_KEY}
        n={11}
        sources={register.sources}
        terminal={terminal}
        active={active === SOURCES_KEY}
        revealed={revealed.has(SOURCES_KEY)}
      />

      {/* rung 12 (final): Next steps — the fact-check material, all collapsed */}
      <NextStepsSection
        id={`fa-${NEXT_STEPS_KEY}`}
        stageKey={NEXT_STEPS_KEY}
        n={12}
        evidence={run.evidence}
        nextChecks={run.nextChecks}
        terminalGaps={run.terminalGaps}
        compiled={compiled?.evidence}
        active={active === NEXT_STEPS_KEY}
        revealed={revealed.has(NEXT_STEPS_KEY)}
      />
    </div>
  );
}
