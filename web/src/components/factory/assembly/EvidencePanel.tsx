"use client";

// Evidence and Next Checks + Terminal Gaps (parameters §6, ADR 0006). Renders
// alongside the ten steps, near the end. Evidence tallies and gaps are folded
// from events; next checks arrive on event detail when the worker attaches them.
// Honest by construction: unresolved conflicts and dead-lettered work show as
// visible gaps rather than being hidden.

import type { NextCheck, TerminalGap } from "@/lib/factory/contracts";
import type { EvidenceTally } from "@/lib/factory/client";
import { fmtClock } from "./format";

export function EvidencePanel({
  evidence,
  nextChecks,
  terminalGaps,
  id,
}: {
  evidence: EvidenceTally;
  nextChecks: NextCheck[];
  terminalGaps: TerminalGap[];
  id: string;
}) {
  const hasAny = evidence.found + evidence.conflicted + evidence.gaps > 0 || nextChecks.length > 0 || terminalGaps.length > 0;

  return (
    <section className="rung fa-evidence" id={id} data-stage="evidence-checks">
      <div className="jcontainer rung-grid">
        <aside>
          <h2>
            Evidence &amp; next <span className="serif">checks</span>
          </h2>
          <p className="whatsnew">What the campaign rests on, and what still needs a human to verify.</p>
        </aside>
        <div className="rc">
          {!hasAny ? (
            <p className="fa-skeleton__hint">Evidence and open checks will appear here as agents research and adjudicate.</p>
          ) : null}

          {evidence.found + evidence.conflicted + evidence.gaps > 0 ? (
            <div className="tiles3">
              <div className="ptile b">
                <div className="big">{evidence.found}</div>
                <div className="s">evidence items found &amp; labelled</div>
              </div>
              <div className="ptile y">
                <div className="big">{evidence.conflicted}</div>
                <div className="s">conflicts left visible, not hidden</div>
              </div>
              <div className="ptile p">
                <div className="big">{evidence.gaps}</div>
                <div className="s">gaps raised for verification</div>
              </div>
            </div>
          ) : null}

          {nextChecks.length ? (
            <>
              <h3>Next checks</h3>
              {nextChecks.map((c) => (
                <p className="fa-nextcheck" key={c.id}>
                  <b>{c.description}</b>
                  {c.reason ? <> — {c.reason}</> : null}
                  {c.affectedSections?.length ? (
                    <span className="fa-mono"> · {c.affectedSections.join(", ")}</span>
                  ) : null}
                </p>
              ))}
            </>
          ) : null}

          {terminalGaps.length ? (
            <>
              <h3>Terminal gaps</h3>
              <ul className="fa-gaplist">
                {terminalGaps.map((g) => (
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
