"use client";

// Evidence and Next Checks + terminal gaps (parameters §6, ADR 0006). Renders
// alongside the ten steps, near the end. Two data sources:
//  - live run: evidence tallies + checks/gaps folded from events;
//  - terminal run: W6's full EvidenceAndNextChecks ledger from W2's durable
//    read route — passed in as `compiled` and preferred when present.
// Honest by construction: unresolved conflicts and dead-lettered work show as
// visible gaps rather than being hidden.
//
// Display redesign (product decision, 15 Jul 2026): the terminal ledger leads
// with three COLLAPSED plain-English groups — "Sources disagree", "Not yet
// double-checked", "Couldn't be checked from public sources" — then the settled
// claims. Each claim collapses to one line and expands to full detail. Copy is
// plain UK English (language.ts); the canonical labels stay on the data.

import type { NextCheck, TerminalGap } from "@/lib/factory/contracts";
import type { EvidenceTally } from "@/lib/factory/client";
import {
  SETTLED_EVIDENCE_GROUP,
  TERMINAL_GAPS_TITLE,
  UNRESOLVED_EVIDENCE_GROUPS,
  claimDetailLines,
  plainOutputName,
  type EvidenceAndNextChecks,
  type EvidenceClaimView,
} from "@/lib/factory/documents";
import { fmtClock } from "./format";
import "@/components/factory/documents/documents.css";

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
  const hasAny = compiled
    ? compiled.totals.claims > 0 || checks.length > 0 || gaps.length > 0 || draftNotes.length > 0
    : evidence.found + evidence.conflicted + evidence.gaps > 0 || checks.length > 0 || gaps.length > 0;

  return (
    <section className="rung fa-evidence" id={id} data-stage="evidence-checks">
      <div className="jcontainer rung-grid">
        <aside>
          <h2>
            Evidence &amp; next <span className="serif">checks</span>
          </h2>
          <p className="whatsnew">What the campaign rests on, and what still needs a human to check.</p>
        </aside>
        <div className="rc">
          {!hasAny ? (
            <p className="fa-skeleton__hint">Evidence and open checks will appear here as the research comes in.</p>
          ) : null}

          {compiled ? (
            <Ledger data={compiled} />
          ) : evidence.found + evidence.conflicted + evidence.gaps > 0 ? (
            <div className="tiles3">
              <div className="ptile b">
                <div className="big">{evidence.found}</div>
                <div className="s">pieces of evidence found and labelled</div>
              </div>
              <div className="ptile y">
                <div className="big">{evidence.conflicted}</div>
                <div className="s">points where sources disagree — kept visible, not hidden</div>
              </div>
              <div className="ptile p">
                <div className="big">{evidence.gaps}</div>
                <div className="s">gaps flagged for a human to check</div>
              </div>
            </div>
          ) : null}

          {checks.length || draftNotes.length ? (
            <>
              <h3>Next checks</h3>
              {checks.map((c) => (
                <p className="fa-nextcheck" key={c.id}>
                  <b>{c.description}</b>
                  {c.reason ? <> — {c.reason}</> : null}
                  {c.affectedSections?.length ? (
                    <span className="fa-mono"> · {c.affectedSections.map(plainOutputName).join(", ")}</span>
                  ) : null}
                </p>
              ))}
              {draftNotes.map((n, i) => (
                <p className="fa-nextcheck" key={`dn-${i}`}>
                  <b>{n.text}</b> — flagged while drafting {n.section}
                </p>
              ))}
            </>
          ) : null}

          {gaps.length ? (
            <>
              <h3>{TERMINAL_GAPS_TITLE}</h3>
              <ul className="fa-gaplist">
                {gaps.map((g) => (
                  <li key={g.id} className="fa-gap--terminal">
                    {g.description}
                    <span className="fa-mono"> · {fmtClock(g.at)}</span>
                  </li>
                ))}
              </ul>
              <p className="fa-skeleton__hint">
                These didn&apos;t finish. What did complete is kept and shown — nothing was invented to fill the gaps.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ---- full ledger (terminal runs): collapsed plain-English groups ----

function ClaimRow({ claim }: { claim: EvidenceClaimView }) {
  return (
    <details className="fa-evclaim">
      <summary>{claim.text}</summary>
      <ul className="fa-evclaim__meta">
        {claimDetailLines(claim).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

function ClaimGroup({
  title,
  caption,
  claims,
}: {
  title: string;
  caption: string;
  claims: EvidenceClaimView[];
}) {
  if (!claims.length) return null;
  return (
    <details className="fa-evgroup">
      <summary>
        {title} ({claims.length})
      </summary>
      <p className="fa-evgroup__cap">{caption}</p>
      {claims.map((c) => (
        <ClaimRow key={c.id} claim={c} />
      ))}
    </details>
  );
}

function Ledger({ data }: { data: EvidenceAndNextChecks }) {
  const t = data.totals;
  const byLabel = new Map(data.groups.map((g) => [g.label, g.claims]));
  const unresolvedLabels = new Set(UNRESOLVED_EVIDENCE_GROUPS.map((g) => g.label));
  const settled = data.groups.filter((g) => !unresolvedLabels.has(g.label)).flatMap((g) => g.claims);

  return (
    <>
      <div className="tiles3">
        <div className="ptile b">
          <div className="big">{t.claims}</div>
          <div className="s">facts recorded during the research</div>
        </div>
        <div className="ptile y">
          <div className="big">{t.verifiedLoadBearing}</div>
          <div className="s">key facts settled</div>
        </div>
        <div className="ptile p">
          <div className="big">{t.unresolvedLoadBearing}</div>
          <div className="s">key facts still to check — shown, not filled in</div>
        </div>
      </div>

      {UNRESOLVED_EVIDENCE_GROUPS.map((spec) => (
        <ClaimGroup
          key={spec.label}
          title={spec.title}
          caption={spec.caption}
          claims={byLabel.get(spec.label) ?? []}
        />
      ))}

      <ClaimGroup
        title={SETTLED_EVIDENCE_GROUP.title}
        caption={SETTLED_EVIDENCE_GROUP.caption}
        claims={settled}
      />
    </>
  );
}
