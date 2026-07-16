"use client";

// Rung 12 (final) — "Next steps" (original-brief redesign, 15 Jul 2026). The
// fact-check material presented the way the legacy page presents Sources: the
// three plain-English categories (sources disagree / not yet double-checked /
// couldn't be checked from public sources), then the specific things to check
// next, then work that didn't finish, then everything the research settled —
// ALL collapsed <details> dropdowns. This rung REPLACES the old bottom "Fact
// checks" roll-up. Two data sources:
//  - live run: evidence tallies + checks/gaps folded from events;
//  - terminal run: W6's full EvidenceAndNextChecks ledger from W2's durable
//    read route — passed in as `compiled` and preferred when present.
// Honest by construction: unresolved conflicts and unfinished work show as
// visible entries rather than being hidden. Canonical labels stay on the data;
// only the display copy is plain English (language.ts). Calm, never red.

import type { ReactNode } from "react";
import type { NextCheck, TerminalGap } from "@/lib/factory/contracts";
import type { EvidenceTally } from "@/lib/factory/client";
import {
  SETTLED_EVIDENCE_GROUP,
  TERMINAL_GAPS_NOTE,
  TERMINAL_GAPS_TITLE,
  UNRESOLVED_EVIDENCE_GROUPS,
  claimDetailLines,
  type EvidenceAndNextChecks,
  type EvidenceClaimView,
} from "@/lib/factory/documents";
import { NEXT_STEPS_COPY } from "./stepCopy";
import "@/components/factory/documents/documents.css";

/** One category: plain-English header + count, caption, dropdown, bullets. */
function Category({
  title,
  caption,
  count,
  children,
}: {
  title: string;
  caption: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="fa-evgroup">
      <summary>
        {title} ({count})
      </summary>
      <p className="fa-evgroup__cap">{caption}</p>
      {children}
    </details>
  );
}

function ClaimBullets({ claims }: { claims: EvidenceClaimView[] }) {
  return (
    <ul className="fa-factlist">
      {claims.map((c) => (
        <li key={c.id}>
          {c.text}
          <span className="fa-factlist__meta">{claimDetailLines(c).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

export function NextStepsSection({
  id,
  stageKey,
  n,
  evidence,
  nextChecks,
  terminalGaps,
  compiled,
  active = false,
  revealed = true,
}: {
  id: string;
  stageKey: string;
  n: number;
  evidence: EvidenceTally;
  nextChecks: NextCheck[];
  terminalGaps: TerminalGap[];
  /** Full ledger for a terminal run (W6 compiler via W2 read route). */
  compiled?: EvidenceAndNextChecks;
  active?: boolean;
  revealed?: boolean;
}) {
  const checks = compiled ? compiled.nextChecks : nextChecks;
  const gaps = compiled ? compiled.terminalGaps : terminalGaps;
  const draftNotes = compiled?.draftNotes ?? [];
  const liveTally = evidence.found + evidence.conflicted + evidence.gaps;
  const hasAny = compiled
    ? compiled.totals.claims > 0 || checks.length > 0 || gaps.length > 0 || draftNotes.length > 0
    : liveTally > 0 || checks.length > 0 || gaps.length > 0;

  return (
    <section
      className={`rung cf-reveal${active ? " active" : ""}`}
      id={id}
      data-stage={stageKey}
      data-on={revealed ? "1" : "0"}
    >
      <div className="jcontainer rung-grid">
        <aside>
          <div className="n">{n}</div>
          <h2>{NEXT_STEPS_COPY.title}</h2>
          {NEXT_STEPS_COPY.limit ? <p className="limit">{NEXT_STEPS_COPY.limit}</p> : null}
        </aside>
        {/* no data-anim gate: the FINAL rung sits at the page bottom, where the
            reveal band may never reach it — its content must always be visible */}
        <div className="rc">
          {!hasAny ? (
            <p className="fa-skeleton__hint">
              Next steps appear here as the research comes in — sorted into what to double-check before you rely on
              the campaign.
            </p>
          ) : null}

          {compiled ? (
            <p className="hint-sm">
              {compiled.totals.claims} fact{compiled.totals.claims === 1 ? "" : "s"} recorded during research ·{" "}
              {compiled.totals.loadBearing} key fact{compiled.totals.loadBearing === 1 ? "" : "s"} the campaign leans
              on ({compiled.totals.verifiedLoadBearing} settled, {compiled.totals.unresolvedLoadBearing} still to
              check). Anything unresolved is listed here — shown, never quietly filled in.
            </p>
          ) : liveTally > 0 ? (
            <p className="hint-sm">
              {evidence.found} fact{evidence.found === 1 ? "" : "s"} recorded so far · {evidence.conflicted} where
              sources disagree · {evidence.gaps} flagged for a human to check. The full list appears here when the
              run finishes.
            </p>
          ) : null}

          {/* the fact-check categories, all collapsed dropdowns.
              Order (15 Jul 2026): "Confirmed facts" leads, then "Things to
              verify", then the remaining honest-construction groups (they show
              only when non-empty). The old "Things to check next" category was
              removed — its items are not re-homed. */}
          {compiled ? <SettledGroup data={compiled} /> : null}
          {compiled ? <UnresolvedGroups data={compiled} /> : null}

          {/* work that did not finish — visible, never filled in */}
          <Category title={TERMINAL_GAPS_TITLE} caption={TERMINAL_GAPS_NOTE} count={gaps.length}>
            <ul className="fa-factlist">
              {gaps.map((g) => (
                <li key={g.id}>{g.description}</li>
              ))}
            </ul>
          </Category>
        </div>
      </div>
    </section>
  );
}

// ---- full ledger (terminal runs): the claim categories ----

// Brief-page display order for the unresolved groups: "Things to verify" leads
// (renamed from the canonical "Not yet double-checked"); the other honest-
// construction groups keep their canonical titles and follow. Canonical labels
// on the data are unchanged — only the display order/title differ here.
const UNRESOLVED_ORDER = [
  "Verification incomplete",
  "Conflicting evidence",
  "External information unavailable",
] as const;
const UNRESOLVED_TITLE_OVERRIDE: Partial<Record<string, string>> = {
  "Verification incomplete": "Things to verify",
};

function UnresolvedGroups({ data }: { data: EvidenceAndNextChecks }) {
  const byLabel = new Map(data.groups.map((g) => [g.label, g.claims]));
  return (
    <>
      {UNRESOLVED_ORDER.map((label) => {
        const spec = UNRESOLVED_EVIDENCE_GROUPS.find((g) => g.label === label);
        if (!spec) return null;
        const claims = byLabel.get(spec.label) ?? [];
        return (
          <Category
            key={spec.label}
            title={UNRESOLVED_TITLE_OVERRIDE[spec.label] ?? spec.title}
            caption={spec.caption}
            count={claims.length}
          >
            <ClaimBullets claims={claims} />
          </Category>
        );
      })}
    </>
  );
}

function SettledGroup({ data }: { data: EvidenceAndNextChecks }) {
  const unresolvedLabels = new Set(UNRESOLVED_EVIDENCE_GROUPS.map((g) => g.label));
  const settled = data.groups.filter((g) => !unresolvedLabels.has(g.label)).flatMap((g) => g.claims);
  return (
    <Category title="Confirmed facts" caption={SETTLED_EVIDENCE_GROUP.caption} count={settled.length}>
      <ClaimBullets claims={settled} />
    </Category>
  );
}
