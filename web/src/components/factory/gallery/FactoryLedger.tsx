// Agent Factory Ledger — the full stats table pinned at the BOTTOM of the
// floor (unchanged position), plus FactoryStatsStrip: the slim always-visible
// strip stuck to the TOP (below the fixed nav) so the projector and phones
// always show the headline numbers. Live counts derived ONLY from events (via
// RunVM). Spend is the worker cost-guard dollar total; never token counts
// (task rules).

import { mono } from "@/components/factory/cards/chrome";
import styles from "./gallery.module.css";
import type { LedgerCounts } from "./viewModel";

function formatSpend(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ ...mono, fontSize: 14, fontWeight: 600, color: accent ?? "#f2f3f5" }}>{value}</span>
      <span style={{ fontSize: 10.5, color: "rgba(242,243,245,0.6)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
    </span>
  );
}

function StripStat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <span className={styles.stripStat}>
      <span className={styles.stripValue} style={{ ...mono, color: accent ?? "#f2f3f5" }}>
        {value}
      </span>
      <span className={styles.stripLabel}>{label}</span>
    </span>
  );
}

/** Slim sticky stats strip (top of the floor): the four headline numbers only.
 *  The full ledger table stays at the bottom — this never replaces it. */
export function FactoryStatsStrip({ counts }: { counts: LedgerCounts }) {
  return (
    <div className={styles.statsStrip} role="status" aria-label="Agent factory live stats">
      <StripStat label="agents working" value={counts.activeAgents} accent="#8ad0ff" />
      <StripStat label="sections accepted" value={counts.sectionsAccepted} accent="#8fe08a" />
      <StripStat label="docs ready" value={counts.docsReady} />
      <StripStat label="spend" value={formatSpend(counts.spendUsd)} accent="#f6d873" />
    </div>
  );
}

export function FactoryLedger({
  counts,
  connectionLabel,
}: {
  counts: LedgerCounts;
  connectionLabel?: string; // e.g. "live", "polling", "recorded run"
}) {
  return (
    <div className={styles.ledger} role="status" aria-label="Agent Factory Ledger">
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(242,243,245,0.5)" }}>
        Agent Factory Ledger
      </span>
      <Stat label="active agents" value={counts.activeAgents} accent="#8ad0ff" />
      <Stat label="sources fetched" value={counts.sourcesFetched} />
      <Stat label="sections accepted" value={counts.sectionsAccepted} accent="#8fe08a" />
      <Stat label="docs ready" value={counts.docsReady} />
      <Stat label="spend" value={formatSpend(counts.spendUsd)} accent="#f6d873" />
      <Stat label="campaigns live" value={counts.campaignsActive} />
      <Stat label="complete" value={counts.campaignsComplete} />
      {connectionLabel ? (
        <span style={{ ...mono, marginLeft: "auto", fontSize: 10.5, color: "rgba(242,243,245,0.55)" }}>
          {connectionLabel}
        </span>
      ) : null}
    </div>
  );
}
