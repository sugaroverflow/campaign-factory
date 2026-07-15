"use client";

// Live gallery wrapper. Owns the browser side: one W4 useFactoryRun stream per
// campaign (reusing the exact fold/transport the public Assembly View uses),
// lifts each RunVM up, and renders the pure FactoryGallery. Fetching lives here,
// never inside the renderer — so W7 replay can render the same component from
// stored events.

import { useCallback, useEffect, useMemo, useState } from "react";
import { foldEvents, useFactoryRun, type RunVM, type ConnectionState } from "@/lib/factory/client";
import { REPLAY_ROUTE, type JudgementAnswerRequest } from "@/lib/factory/contracts";
import { hueIndexForPosition } from "@/components/factory/cards";
import { FactoryGallery } from "./FactoryGallery";
import { deriveShortName, type GalleryCampaign } from "./viewModel";
import type { StoredBatchConnection } from "./batchStorage";

const NOW_TICK_MS = 1000;

function connectionLabel(states: ConnectionState[]): string {
  if (states.some((s) => s === "live")) return "live";
  if (states.some((s) => s === "polling")) return "polling";
  if (states.some((s) => s === "reconnecting")) return "reconnecting";
  if (states.length > 0 && states.every((s) => s === "error")) return "offline · showing intake";
  if (states.some((s) => s === "closed")) return "complete";
  return "connecting";
}

// One invisible stream per campaign; reports its folded RunVM + connection up.
function CampaignStream({
  campaignId,
  streamUrl,
  streamToken,
  seed,
  onRun,
}: {
  campaignId: string;
  streamUrl?: string;
  streamToken?: string;
  seed?: { problem?: string; place?: string };
  onRun: (campaignId: string, run: RunVM, connection: ConnectionState) => void;
}) {
  const { run, connection } = useFactoryRun({ campaignId, streamUrl, streamToken, seed });
  useEffect(() => {
    onRun(campaignId, run, connection);
  }, [run, connection, campaignId, onRun]);
  return null;
}

export function GalleryLive({
  batchId,
  connections,
  presenter = false,
}: {
  batchId: string;
  connections: StoredBatchConnection[];
  presenter?: boolean;
}) {
  const [runs, setRuns] = useState<Record<string, RunVM>>({});
  const [states, setStates] = useState<Record<string, ConnectionState>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const onRun = useCallback((campaignId: string, run: RunVM, connection: ConnectionState) => {
    setRuns((prev) => (prev[campaignId] === run ? prev : { ...prev, [campaignId]: run }));
    setStates((prev) => (prev[campaignId] === connection ? prev : { ...prev, [campaignId]: connection }));
  }, []);

  // Seeded placeholders so anchors + intake echo paint before the first event.
  const seeded = useMemo(() => {
    const m: Record<string, RunVM> = {};
    for (const c of connections) m[c.campaignId] = foldEvents(c.campaignId, [], c.intake);
    return m;
  }, [connections]);

  const campaigns: GalleryCampaign[] = useMemo(() => {
    return connections.map((c, i) => {
      const run = runs[c.campaignId] ?? seeded[c.campaignId];
      return { run, hue: hueIndexForPosition(i), shortName: deriveShortName(run, i) };
    });
  }, [connections, runs, seeded]);

  const label = useMemo(
    () => connectionLabel(connections.map((c) => states[c.campaignId]).filter(Boolean) as ConnectionState[]),
    [connections, states],
  );

  const onCancel = useCallback((campaignId: string) => {
    if (!confirm("Cancel this campaign? Accepted work stays readable.")) return;
    void fetch(`/api/factory/runs/${encodeURIComponent(campaignId)}/cancel`, { method: "POST" }).catch(
      () => {},
    );
  }, []);

  const onAnswerJudgement = useCallback(
    (campaignId: string, judgementId: string, action: JudgementAnswerRequest["action"], answer?: string) => {
      const body: JudgementAnswerRequest = { action, ...(answer ? { answer } : {}) };
      void fetch(
        `/api/factory/runs/${encodeURIComponent(campaignId)}/judgements/${encodeURIComponent(judgementId)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      ).catch(() => {});
    },
    [],
  );

  return (
    <div>
      {connections.map((c) => (
        <CampaignStream
          key={c.campaignId}
          campaignId={c.campaignId}
          streamUrl={c.streamUrl}
          streamToken={c.streamToken}
          seed={c.intake}
          onRun={onRun}
        />
      ))}

      <FactoryGallery
        campaigns={campaigns}
        now={now}
        connectionLabel={label}
        onCancel={presenter ? onCancel : undefined}
        onAnswerJudgement={presenter ? onAnswerJudgement : undefined}
      />

      {presenter ? (
        <PresenterControls batchId={batchId} />
      ) : null}
    </div>
  );
}

// Visually quiet presenter-only controls: link to the recorded run (W7 owns the
// route) and a way back to intake. No destructive admin.
function PresenterControls({ batchId }: { batchId: string }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        left: 12,
        zIndex: 40,
        display: "flex",
        gap: 8,
        alignItems: "center",
        fontSize: 11,
        background: "rgba(22,24,27,0.9)",
        color: "rgba(242,243,245,0.75)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 999,
        padding: "5px 12px",
      }}
    >
      <span style={{ opacity: 0.55 }} title={`batch ${batchId}`}>
        presenter
      </span>
      <a href={REPLAY_ROUTE} style={{ color: "#8ad0ff", textDecoration: "none" }}>
        Use recorded run
      </a>
      <span style={{ opacity: 0.3 }}>·</span>
      <a href="/factory/multi-campaign-demo" style={{ color: "rgba(242,243,245,0.7)", textDecoration: "none" }}>
        New batch
      </a>
    </div>
  );
}
