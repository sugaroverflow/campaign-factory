"use client";

// Campaign Completion Receipt (parameters §6, ADR 0011). Replaces a completed
// agent cluster in the Factory Gallery and also heads the completed campaign
// page. Every figure comes from W6's event-derived buildCampaignReceipt — no
// fabricated counts. Honest about partial completion and terminal gaps. The
// full Campaign Brief opens in a NEW tab.

import type { CampaignReceipt } from "@/lib/factory/documents";
import "./receipts.css";

function fmtElapsed(ms?: number): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_HEADLINE: Record<CampaignReceipt["status"], string> = {
  queued: "Campaign queued",
  running: "Campaign in progress",
  completed: "Campaign brief ready",
  partial: "Brief partly ready",
  failed: "Run failed — partial output kept",
  cancelled: "Run cancelled — partial output kept",
};

export function CampaignCompletionReceipt({
  receipt,
  accent,
  compact = false,
  briefUrl,
}: {
  receipt: CampaignReceipt;
  /** optional campaign hue accent for the left edge (gallery) */
  accent?: string;
  /** compact = the gallery cluster-replacement size */
  compact?: boolean;
  /** override the brief link (defaults to receipt.briefPath) */
  briefUrl?: string;
}) {
  const elapsed = fmtElapsed(receipt.elapsedMs);
  const incomplete =
    receipt.status === "partial" || receipt.status === "failed" || receipt.status === "cancelled";
  const href = briefUrl ?? receipt.briefPath;

  const tiles: Array<[number | string, string]> = [
    [receipt.agents.spawned, receipt.agents.spawned === 1 ? "agent" : "agents"],
    [receipt.sourcesFetched, receipt.sourcesFetched === 1 ? "source" : "sources"],
    [`${receipt.sections.accepted}/${receipt.sections.total}`, "sections accepted"],
    [`${receipt.documents.ready}/${receipt.documents.total}`, "documents ready"],
  ];

  return (
    <div
      className={`fa-rcpt${compact ? " fa-rcpt--compact" : ""}${incomplete ? " fa-rcpt--partial" : ""}`}
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
    >
      <div className="fa-rcpt__head">
        <span className="fa-rcpt__title">{STATUS_HEADLINE[receipt.status]}</span>
        {incomplete ? <span className="tag mock">partial</span> : <span className="tag real">complete</span>}
      </div>

      {receipt.place || receipt.problem ? (
        <p className="fa-rcpt__sub">
          {receipt.place ? <b>{receipt.place}</b> : null}
          {receipt.place && receipt.problem ? " · " : null}
          {receipt.problem ? <span>{receipt.problem}</span> : null}
        </p>
      ) : null}

      <div className="fa-rcpt__stats">
        {tiles.map(([big, label], i) => (
          <div key={i} className="fa-rcpt__stat">
            <span className="fa-rcpt__big">{big}</span>
            <span className="fa-rcpt__lbl">{label}</span>
          </div>
        ))}
      </div>

      <div className="fa-rcpt__meta">
        {receipt.agents.failed > 0 ? (
          <span className="fa-rcpt__flag">
            {receipt.agents.failed} agent{receipt.agents.failed === 1 ? "" : "s"} failed
          </span>
        ) : null}
        {receipt.documents.needsVerification > 0 ? (
          <span className="fa-rcpt__flag">
            {receipt.documents.needsVerification} doc
            {receipt.documents.needsVerification === 1 ? "" : "s"} to check before use
          </span>
        ) : null}
        {receipt.terminalGaps > 0 ? (
          <span className="fa-rcpt__flag fa-rcpt__flag--gap">
            {receipt.terminalGaps} item{receipt.terminalGaps === 1 ? "" : "s"} not completed in this run
          </span>
        ) : null}
        {receipt.judgements.requested > 0 ? (
          <span className="fa-rcpt__meta-item fa-mono">
            {receipt.judgements.resolved + receipt.judgements.defaulted}/{receipt.judgements.requested}{" "}
            choices settled
          </span>
        ) : null}
        {elapsed ? <span className="fa-rcpt__meta-item fa-mono">{elapsed} elapsed</span> : null}
      </div>

      <a className="fa-rcpt__open" href={href} target="_blank" rel="noopener noreferrer">
        Open brief in new tab →
      </a>
    </div>
  );
}
