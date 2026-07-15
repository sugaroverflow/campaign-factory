"use client";

// Fact checks (14 Jul 2026 redesign, graft 3). The whole evidence/claims
// apparatus as ONE cohesive section at the bottom of the brief, in one visual
// style: a plain-English category header, a one-line caption under it saying
// what the category means for the campaigner, a dropdown per category, and
// bullets per claim. Calm, not alarming — no red anywhere. Two data sources:
//  - live run: evidence tallies + checks/gaps folded from events;
//  - terminal run: W6's full EvidenceAndNextChecks ledger from W2's durable
//    read route — passed in as `compiled` and preferred when present.
// Honest by construction: unresolved conflicts and unfinished work show as
// visible entries rather than being hidden. Canonical labels stay on the data;
// only the display copy is plain English (language.ts).

import type { ReactNode } from "react";
import type { NextCheck, TerminalGap } from "@/lib/factory/contracts";
import type { EvidenceTally } from "@/lib/factory/client";
import {
  NEXT_CHECKS_GROUP,
  SETTLED_EVIDENCE_GROUP,
  TERMINAL_GAPS_NOTE,
  TERMINAL_GAPS_TITLE,
  UNRESOLVED_EVIDENCE_GROUPS,
  claimDetailLines,
  plainOutputName,
  type EvidenceAndNextChecks,
  type EvidenceClaimView,
} from "@/lib/factory/documents";
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

export function EvidencePanel({
  evidence,
  nextChecks,
  terminalGaps,
  compiled,
  id,
}: {
  evidence: EvidenceTally;
  nextChecks: NextCheck[];
  terminalGaps: TerminalGap[];
  /** Full ledger for a terminal run (W6 compiler via W2 read route). */
  compiled?: EvidenceAndNextChecks;
  id: string;
}) {
  const checks = compiled ? compiled.nextChecks : nextChecks;
  const gaps = compiled ? compiled.terminalGaps : terminalGaps;
  const draftNotes = compiled?.draftNotes ?? [];
  const liveTally = evidence.found + evidence.conflicted + evidence.gaps;
  const hasAny = compiled
    ? compiled.totals.claims > 0 || checks.length > 0 || gaps.length > 0 || draftNotes.length > 0
    : liveTally > 0 || checks.length > 0 || gaps.length > 0;

  return (
    <section className="rung fa-evidence" id={id} data-stage="fact-checks">
      <div className="jcontainer rung-grid">
        <aside>
          <h2>
            Fact <span className="serif">checks</span>
          </h2>
          <p className="whatsnew">What the research found — and what to double-check before you rely on it.</p>
        </aside>
        <div className="rc">
          {!hasAny ? (
            <p className="fa-skeleton__hint">Fact checks will appear here as the research comes in.</p>
          ) : null}

          {compiled ? (
            <Ledger data={compiled} />
          ) : liveTally > 0 ? (
            <p className="hint-sm">
              {evidence.found} fact{evidence.found === 1 ? "" : "s"} recorded so far ·{" "}
              {evidence.conflicted} where sources disagree · {evidence.gaps} flagged for a human to
              check. The full fact-check list appears here when the run finishes.
            </p>
          ) : null}

          <Category
            title={NEXT_CHECKS_GROUP.title}
            caption={NEXT_CHECKS_GROUP.caption}
            count={checks.length + draftNotes.length}
          >
            <ul className="fa-factlist">
              {checks.map((c) => (
                <li key={c.id}>
                  {c.description}
                  {c.reason ? <> — {c.reason}</> : null}
                  {c.affectedSections?.length ? (
                    <span className="fa-factlist__meta">
                      Affects: {c.affectedSections.map(plainOutputName).join(", ")}
                    </span>
                  ) : null}
                </li>
              ))}
              {draftNotes.map((n, i) => (
                <li key={`dn-${i}`}>
                  {n.text}
                  <span className="fa-factlist__meta">Flagged while drafting {n.section}</span>
                </li>
              ))}
            </ul>
          </Category>

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

function Ledger({ data }: { data: EvidenceAndNextChecks }) {
  const t = data.totals;
  const byLabel = new Map(data.groups.map((g) => [g.label, g.claims]));
  const unresolvedLabels = new Set(UNRESOLVED_EVIDENCE_GROUPS.map((g) => g.label));
  const settled = data.groups.filter((g) => !unresolvedLabels.has(g.label)).flatMap((g) => g.claims);

  return (
    <>
      <p className="hint-sm">
        {t.claims} fact{t.claims === 1 ? "" : "s"} recorded during research · {t.loadBearing} key fact
        {t.loadBearing === 1 ? "" : "s"} the campaign leans on ({t.verifiedLoadBearing} settled,{" "}
        {t.unresolvedLoadBearing} still to check). Anything unresolved is listed here — shown, never
        quietly filled in.
      </p>

      {UNRESOLVED_EVIDENCE_GROUPS.map((spec) => {
        const claims = byLabel.get(spec.label) ?? [];
        return (
          <Category key={spec.label} title={spec.title} caption={spec.caption} count={claims.length}>
            <ClaimBullets claims={claims} />
          </Category>
        );
      })}

      <Category
        title={SETTLED_EVIDENCE_GROUP.title}
        caption={SETTLED_EVIDENCE_GROUP.caption}
        count={settled.length}
      >
        <ClaimBullets claims={settled} />
      </Category>
    </>
  );
}
