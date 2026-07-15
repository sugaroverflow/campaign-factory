"use client";

// Batch Receipt (parameters §6, ADR 0011). Summarises a presenter batch across
// its campaigns from event-derived per-campaign receipts. Partial and failed
// campaigns are reported honestly alongside complete ones — never hidden, never
// rolled up into a fake success count.

import type { BatchReceipt as BatchReceiptData, CampaignReceipt } from "@/lib/factory/documents";
import "./receipts.css";

const STATUS_TAG: Record<CampaignReceipt["status"], string> = {
  queued: "gen",
  running: "gen",
  completed: "real",
  partial: "mock",
  failed: "verify",
  cancelled: "ext",
};

export function BatchReceipt({ batch }: { batch: BatchReceiptData }) {
  const { totals } = batch;
  return (
    <div className="fa-batch">
      <div className="fa-rcpt__head">
        <span className="fa-rcpt__title">Batch receipt</span>
        <span className="fa-mono">
          {batch.substantiallyUsable}/{batch.campaignCount} produced something usable
        </span>
      </div>

      <div className="fa-rcpt__stats fa-batch__stats">
        <div className="fa-rcpt__stat">
          <span className="fa-rcpt__big">{batch.campaignCount}</span>
          <span className="fa-rcpt__lbl">campaigns</span>
        </div>
        <div className="fa-rcpt__stat">
          <span className="fa-rcpt__big">{totals.agentsSpawned}</span>
          <span className="fa-rcpt__lbl">agents put to work</span>
        </div>
        <div className="fa-rcpt__stat">
          <span className="fa-rcpt__big">{totals.sourcesFetched}</span>
          <span className="fa-rcpt__lbl">sources fetched</span>
        </div>
        <div className="fa-rcpt__stat">
          <span className="fa-rcpt__big">{totals.documentsReady}</span>
          <span className="fa-rcpt__lbl">documents ready</span>
        </div>
      </div>

      <div className="fa-rcpt__meta">
        {totals.agentsFailed > 0 ? (
          <span className="fa-rcpt__flag">{totals.agentsFailed} agents failed</span>
        ) : null}
        {totals.terminalGaps > 0 ? (
          <span className="fa-rcpt__flag fa-rcpt__flag--gap">
            {totals.terminalGaps} item{totals.terminalGaps === 1 ? "" : "s"} not completed
          </span>
        ) : null}
        <span className="fa-rcpt__meta-item">
          {totals.sectionsAccepted} brief sections accepted across the batch
        </span>
      </div>

      <table className="fa-batch__table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Status</th>
            <th>Sections</th>
            <th>Docs</th>
            <th>Gaps</th>
            <th aria-label="Open brief" />
          </tr>
        </thead>
        <tbody>
          {batch.campaigns.map((c) => (
            <tr key={c.campaignId}>
              <td>
                <b>{c.place || c.problem || c.campaignId}</b>
              </td>
              <td>
                <span className={`tag ${STATUS_TAG[c.status]}`}>{c.status}</span>
              </td>
              <td className="fa-mono">
                {c.sections.accepted}/{c.sections.total}
              </td>
              <td className="fa-mono">
                {c.documents.ready}/{c.documents.total}
              </td>
              <td className="fa-mono">{c.terminalGaps}</td>
              <td>
                <a href={c.briefPath} target="_blank" rel="noopener noreferrer">
                  Open →
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
