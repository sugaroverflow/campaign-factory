"use client";

// Evidence and Next Checks + Terminal Gaps (parameters §6, ADR 0006). Renders
// alongside the ten steps, near the end. Two data sources:
//  - live run: evidence tallies + checks/gaps folded from events;
//  - terminal run: W6's full EvidenceAndNextChecks ledger (claims grouped by
//    the seven verification labels, conflicts, checks, gaps, totals) from W2's
//    durable read route — passed in as `compiled` and preferred when present.
// Honest by construction: unresolved conflicts and dead-lettered work show as
// visible gaps rather than being hidden.

import type { NextCheck, TerminalGap } from "@/lib/factory/contracts";
import type { EvidenceTally } from "@/lib/factory/client";
import { LABEL_TAG_CLASS, type EvidenceAndNextChecks } from "@/lib/factory/documents";
import type { EvidenceClaimView } from "@/lib/factory/documents";
import { fmtClock } from "./format";

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
  const hasAny = compiled
    ? compiled.totals.claims > 0 || checks.length > 0 || gaps.length > 0
    : evidence.found + evidence.conflicted + evidence.gaps > 0 || checks.length > 0 || gaps.length > 0;

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

          {compiled ? (
            <Ledger data={compiled} />
          ) : evidence.found + evidence.conflicted + evidence.gaps > 0 ? (
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

          {checks.length ? (
            <>
              <h3>Next checks</h3>
              {checks.map((c) => (
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

          {gaps.length ? (
            <>
              <h3>Terminal gaps</h3>
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

// ---- full source ledger (terminal runs) ----

function claimMeta(c: EvidenceClaimView): string {
  const parts: string[] = [];
  if (c.loadBearing) parts.push("load-bearing");
  if (c.sourceCount) parts.push(`${c.sourceCount} source${c.sourceCount === 1 ? "" : "s"}`);
  if (c.confidence) parts.push(`confidence ${c.confidence}`);
  return parts.join(" · ");
}

function Ledger({ data }: { data: EvidenceAndNextChecks }) {
  const t = data.totals;
  return (
    <>
      <div className="tiles3">
        <div className="ptile b">
          <div className="big">{t.claims}</div>
          <div className="s">claims, each carrying one of the seven verification labels</div>
        </div>
        <div className="ptile y">
          <div className="big">{t.verifiedLoadBearing}</div>
          <div className="s">load-bearing claims settled</div>
        </div>
        <div className="ptile p">
          <div className="big">{t.unresolvedLoadBearing}</div>
          <div className="s">load-bearing claims still unresolved — shown, not filled in</div>
        </div>
      </div>

      <h3>Source ledger</h3>
      {data.groups.map((g) => (
        <div key={g.label} style={{ marginBottom: "0.9rem" }}>
          <p style={{ margin: "0 0 0.35rem" }}>
            <span className={`tag ${LABEL_TAG_CLASS[g.label]}`}>{g.label}</span>{" "}
            <span className="fa-mono">{g.count}</span>
          </p>
          <ul className="fa-gaplist">
            {g.claims.map((c) => (
              <li key={c.id}>
                {c.text}
                {claimMeta(c) ? <span className="hint-sm"> ({claimMeta(c)})</span> : null}
                {c.excerpt ? <span className="src-ev"> &ldquo;{c.excerpt}&rdquo;</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {data.conflicts.length ? (
        <>
          <h3>Unresolved conflicts</h3>
          <ul className="fa-gaplist">
            {data.conflicts.map((c) => (
              <li key={c.id}>
                {c.text} <span className="tag verify">Conflicting evidence</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
