// Internal cost + latency instrument (task #9d). NOT product UI — deliberately
// plain, no overlay styling. Gated by CF_ADMIN_KEY supplied as ?key= or the
// x-cf-admin-key header (same convention as /api/admin/hide). Read-only: it only
// aggregates W1's cost_ledger + factory_events. Shows per-campaign spend vs the
// $4/$8 guards, per-batch spend vs $20/$35, cache tokens if recorded, and the
// §8 latency milestone table.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { config } from "@/lib/config";
import { factorySql } from "@/lib/factory/store";
import {
  ledgerOverview,
  COST_GUARDS,
  LATENCY_TARGETS,
  type CampaignLedger,
  type BatchLedger,
  type Percentiles,
} from "@/lib/factory/ledger";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Factory costs (internal)" };

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}
function secs(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
function pctl(p: Percentiles): string {
  if (p.n === 0) return "—";
  return `${secs(p.p50)} / ${secs(p.p95)} (n=${p.n})`;
}

const cell: React.CSSProperties = { padding: "4px 10px", borderBottom: "1px solid #e5e7eb", textAlign: "left", verticalAlign: "top" };
const num: React.CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const th: React.CSSProperties = { ...cell, fontWeight: 600, borderBottom: "2px solid #cbd5e1", whiteSpace: "nowrap" };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 };

function CostFlag({ warn, stop }: { warn: boolean; stop: boolean }) {
  if (stop) return <span style={{ color: "#b91c1c", fontWeight: 700 }}> STOP</span>;
  if (warn) return <span style={{ color: "#b45309", fontWeight: 700 }}> WARN</span>;
  return null;
}

function Gate({ message }: { message: string }) {
  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>Factory costs — internal</h1>
      <p style={{ marginTop: 8, color: "#6b7280", fontSize: 14 }}>{message}</p>
      <form method="get" style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <input
          type="password"
          name="key"
          placeholder="CF_ADMIN_KEY"
          style={{ flex: 1, border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 10px", fontSize: 14 }}
        />
        <button type="submit" style={{ border: "1px solid #111827", borderRadius: 6, padding: "6px 14px", fontSize: 14 }}>
          Open
        </button>
      </form>
    </main>
  );
}

export default async function FactoryCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  if (!config.adminKey) {
    return <Gate message="Cost ledger is disabled — set CF_ADMIN_KEY to enable this internal page." />;
  }
  const sp = await searchParams;
  const hdrs = await headers();
  const supplied = (sp.key || hdrs.get("x-cf-admin-key") || "").trim();
  if (supplied !== config.adminKey) {
    return <Gate message="Enter the admin key (CF_ADMIN_KEY) to view the cost + latency ledger." />;
  }

  const overview = await ledgerOverview(factorySql());

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px 80px", fontFamily: "system-ui, sans-serif", color: "#111827" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Campaign Factory — cost + latency ledger</h1>
      <p style={{ marginTop: 6, color: "#6b7280", fontSize: 13 }}>
        Internal instrument. Read-only, derived from cost_ledger + factory_events. Guards:
        per-campaign warn {usd(COST_GUARDS.perCampaignWarningUSD)} / stop {usd(COST_GUARDS.perCampaignHardStopUSD)};
        batch warn {usd(COST_GUARDS.presenterBatchWarningUSD)} / stop {usd(COST_GUARDS.presenterBatchHardStopUSD)}.
        {" "}Latency targets: sourced finding {secs(LATENCY_TARGETS.firstSourcedFindingMs)},
        accepted section {secs(LATENCY_TARGETS.firstAcceptedSectionMs)},
        campaign usable {secs(LATENCY_TARGETS.firstCampaignUsableMs)}.
      </p>
      <p style={{ marginTop: 6, fontSize: 13 }}>
        <strong>{overview.totals.campaignCount}</strong> campaigns ·{" "}
        <strong>{overview.totals.batchCount}</strong> batches · total campaign spend{" "}
        <strong>{usd(overview.totals.campaignSpendUsd)}</strong>
      </p>

      <Section title="Latency milestones (p50 / p95, all listed campaigns)">
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Milestone</th>
              <th style={{ ...th, textAlign: "right" }}>p50 / p95</th>
              <th style={{ ...th, textAlign: "right" }}>Target p50</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>First sourced finding</td>
              <td style={num}>{pctl(overview.latency.firstSourcedFinding)}</td>
              <td style={num}>{secs(LATENCY_TARGETS.firstSourcedFindingMs)}</td>
            </tr>
            <tr>
              <td style={cell}>First accepted section</td>
              <td style={num}>{pctl(overview.latency.firstAcceptedSection)}</td>
              <td style={num}>{secs(LATENCY_TARGETS.firstAcceptedSectionMs)}</td>
            </tr>
            <tr>
              <td style={cell}>Campaign usable</td>
              <td style={num}>{pctl(overview.latency.usable)}</td>
              <td style={num}>{secs(LATENCY_TARGETS.firstCampaignUsableMs)}</td>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: 4, fontSize: 11, color: "#9ca3af" }}>
          &ldquo;Campaign usable&rdquo; is a documented proxy (first run.completed | run.partial) until an
          explicit usable marker is emitted.
        </p>
      </Section>

      <Section title="Per-campaign cost + milestones">
        {overview.campaigns.length === 0 ? (
          <Empty />
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Campaign</th>
                <th style={th}>Place</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Cost</th>
                <th style={{ ...th, textAlign: "right" }}>In/Out tok</th>
                <th style={{ ...th, textAlign: "right" }}>Cache r/w</th>
                <th style={{ ...th, textAlign: "right" }}>Sourced</th>
                <th style={{ ...th, textAlign: "right" }}>Accepted</th>
                <th style={{ ...th, textAlign: "right" }}>Usable</th>
              </tr>
            </thead>
            <tbody>
              {overview.campaigns.map((c: CampaignLedger) => (
                <tr key={c.campaignId}>
                  <td style={{ ...cell, ...mono }} title={c.campaignId}>{shortId(c.campaignId)}</td>
                  <td style={cell}>{c.place || "—"}</td>
                  <td style={cell}>{c.status || "—"}</td>
                  <td style={num}>
                    {usd(c.cost.totalUsd)}
                    <CostFlag warn={c.overWarning} stop={c.overHardStop} />
                  </td>
                  <td style={num}>
                    {c.cost.totalInputTokens.toLocaleString()}/{c.cost.totalOutputTokens.toLocaleString()}
                  </td>
                  <td style={num}>
                    {c.cache.recorded ? `${c.cache.read.toLocaleString()}/${c.cache.write.toLocaleString()}` : "—"}
                  </td>
                  <td style={num}>{secs(c.milestones.firstSourcedFindingMs)}</td>
                  <td style={num}>{secs(c.milestones.firstAcceptedSectionMs)}</td>
                  <td style={num}>{secs(c.milestones.usableMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Per-batch cost + latency">
        {overview.batches.length === 0 ? (
          <Empty />
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Batch</th>
                <th style={{ ...th, textAlign: "right" }}>Size</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Cost</th>
                <th style={{ ...th, textAlign: "right" }}>Cache r/w</th>
                <th style={{ ...th, textAlign: "right" }}>1st usable</th>
                <th style={{ ...th, textAlign: "right" }}>Complete</th>
                <th style={{ ...th, textAlign: "right" }}>Sourced p50/p95</th>
              </tr>
            </thead>
            <tbody>
              {overview.batches.map((b: BatchLedger) => (
                <tr key={b.batchId}>
                  <td style={{ ...cell, ...mono }} title={b.batchId}>{shortId(b.batchId)}</td>
                  <td style={num}>{b.size ?? b.campaigns.length}</td>
                  <td style={cell}>{b.status || "—"}</td>
                  <td style={num}>
                    {usd(b.totalUsd)}
                    <CostFlag warn={b.overWarning} stop={b.overHardStop} />
                  </td>
                  <td style={num}>
                    {b.cache.recorded ? `${b.cache.read.toLocaleString()}/${b.cache.write.toLocaleString()}` : "—"}
                  </td>
                  <td style={num}>{secs(b.latency.firstCampaignUsableMs)}</td>
                  <td style={num}>{secs(b.latency.batchCompleteMs)}</td>
                  <td style={num}>{pctl(b.latency.firstSourcedFinding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function Empty() {
  return <p style={{ fontSize: 13, color: "#9ca3af" }}>No rows recorded yet.</p>;
}
