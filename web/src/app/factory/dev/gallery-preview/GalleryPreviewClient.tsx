"use client";

// Fixture-driven gallery preview. Canned events → the SAME W4 fold → the pure
// W5 FactoryGallery renderer (the exact path W7 replay uses). No network, no
// live run. Demonstrates ≥15 cards across five campaigns with expansion
// priority, connectors, a judgement, a failure, and a completion receipt.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { foldEvents } from "@/lib/factory/client";
import { hueIndexForPosition } from "@/components/factory/cards";
import { FactoryGallery, deriveShortName, type GalleryCampaign } from "@/components/factory/gallery";
import { buildFixtureCampaigns } from "./fixtures";

const noopSubscribe = () => () => {};

export function GalleryPreviewClient() {
  // Client-only mount gate: fixtures anchor timestamps to Date.now(), so the
  // gallery renders only after hydration to avoid a server/client mismatch.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [base] = useState(() => Date.now());
  const [now, setNow] = useState(base);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const fixtures = useMemo(() => buildFixtureCampaigns(base), [base]);
  const campaigns: GalleryCampaign[] = useMemo(
    () =>
      fixtures.map((f, i) => {
        const run = foldEvents(f.campaignId, f.events, f.intake);
        return { run, hue: hueIndexForPosition(i), shortName: deriveShortName(run, i) };
      }),
    [fixtures],
  );

  const totalCards = campaigns.reduce((n, c) => n + c.run.agents.length, 0);

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "#f6e683",
          color: "#1b1d1e",
          padding: "6px 16px",
          fontSize: 12,
          fontWeight: 600,
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <span>FIXTURE PREVIEW — canned events, no live run</span>
        <span style={{ fontWeight: 400, opacity: 0.75 }}>
          {campaigns.length} campaigns · {totalCards} agent cards
        </span>
      </div>
      {mounted ? (
        <FactoryGallery
          campaigns={campaigns}
          now={now}
          connectionLabel="fixture preview"
          onCancel={(id) => console.log("[preview] cancel", id)}
          onAnswerJudgement={(cid, jid, action, answer) =>
            console.log("[preview] judgement", cid, jid, action, answer)
          }
        />
      ) : null}
    </div>
  );
}
