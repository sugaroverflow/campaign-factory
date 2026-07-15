// Factory Ledger — fixed below the nav, ≤44px. Live counts derived ONLY from
// events (via RunVM). Spend bucket omitted; never token counts (task rules).

import { mono } from "@/components/factory/cards/chrome";
import styles from "./gallery.module.css";
import type { LedgerCounts } from "./viewModel";

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

export function FactoryLedger({
  counts,
  connectionLabel,
}: {
  counts: LedgerCounts;
  connectionLabel?: string; // e.g. "live", "polling", "recorded run"
}) {
  return (
    <div className={styles.ledger} role="status" aria-label="Factory Ledger">
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(242,243,245,0.5)" }}>
        Factory Ledger
      </span>
      <Stat label="active agents" value={counts.activeAgents} accent="#8ad0ff" />
      <Stat label="sources fetched" value={counts.sourcesFetched} />
      <Stat label="sections accepted" value={counts.sectionsAccepted} accent="#8fe08a" />
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
