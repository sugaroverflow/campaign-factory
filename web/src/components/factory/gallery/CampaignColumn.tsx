"use client";

// One campaign region: opaque anchor (sticky, above everything), then the
// factory floor. EVERY agent workspace stays open as a full-width Agent Work
// Card for the whole run AND after it ends — no pills, no compact tier, no
// collapse. The wall of concurrent choices is deliberately daunting.
//
// The published brief pieces are the paper SUBSTRATE: grid-overlaid BEHIND the
// translucent agent card layer (z 0 vs z 1, same grid cell so the column is as
// tall as the taller layer), so the campaign's output visibly assembles under
// the swarm and shows through around/behind it. When the run reaches a usable
// terminal state the Completion Receipt is added above the floor; the agent
// cards stay open, grayed by their terminal status.
//
// Judgement cards no longer render in the gallery columns (judgement UI lives
// on the brief page).

import { useMemo, useRef } from "react";
import { AgentWorkCard, hueByIndex } from "@/components/factory/cards";
import type { AgentCardVM } from "@/components/factory/cards";
import { CampaignCompletionReceipt } from "@/components/factory/receipts/CampaignCompletionReceipt";
import cardStyles from "@/components/factory/cards/factory.module.css";
import styles from "./gallery.module.css";
import { CampaignAnchor } from "./CampaignAnchor";
import { ConnectorLayer } from "./ConnectorLayer";
import { PublishedBriefStack } from "./PublishedBriefStack";
import { runVmToCampaignReceipt } from "./receiptModel";
import type { ConnectorEdge, GalleryCampaign } from "./viewModel";

export function CampaignColumn({
  campaign,
  cards,
  edges,
  now,
  onCancel,
}: {
  campaign: GalleryCampaign;
  cards: AgentCardVM[];
  edges: ConnectorEdge[];
  now: number;
  onCancel?: (campaignId: string) => void;
}) {
  const cardsRef = useRef<HTMLDivElement | null>(null);
  const { run } = campaign;

  const activeAgents = cards.filter((c) => c.status === "queued" || c.status === "running").length;
  const sectionsAccepted = Object.values(run.sections).filter((s) => s.status === "accepted").length;
  const showReceipt = run.status === "completed" || run.status === "partial" || !!run.receiptAt;

  // Chronological interleave: agent workspaces by start time, published brief
  // pieces by publish time — the brief visibly lands in between the workspaces.
  type FlowItem =
    | { kind: "agent"; at: string; card: (typeof cards)[number] }
    | { kind: "published"; at: string; card: (typeof run.publishedCards)[number] };
  const flow = useMemo<FlowItem[]>(() => {
    const items: FlowItem[] = [
      ...cards.map((c) => ({ kind: "agent" as const, at: c.startedAt ?? "9999", card: c })),
      ...run.publishedCards.map((p) => ({ kind: "published" as const, at: p.at, card: p })),
    ];
    return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }, [cards, run.publishedCards]);

  // Layout signature: recompute connectors only when the set of cards changes
  // (every card is always a full workspace now, so identity is the only input).
  const revision = useMemo(() => cards.map((c) => c.agentRunId).join("|"), [cards]);

  return (
    <div className={styles.column}>
      <CampaignAnchor
        campaign={campaign}
        activeAgents={activeAgents}
        sectionsAccepted={sectionsAccepted}
        onCancel={onCancel}
      />

      {showReceipt ? (
        <CampaignCompletionReceipt
          receipt={runVmToCampaignReceipt(run)}
          accent={hueByIndex(campaign.hue).accent}
        />
      ) : null}

      <div className={styles.cardsArea} ref={cardsRef}>
        <ConnectorLayer containerRef={cardsRef} edges={edges} revision={revision} />

        {/* One chronological flow: published brief pieces drop in BETWEEN the
            agent workspaces as they're drafted — no overlay layers. */}
        <div className={styles.cardStack}>
          {flow.map((item) =>
            item.kind === "agent" ? (
              <div
                key={item.card.agentRunId}
                data-agent-run-id={item.card.agentRunId}
                className={cardStyles.reposition}
              >
                <AgentWorkCard vm={item.card} now={now} fill />
              </div>
            ) : (
              <div key={`pub-${item.card.key}`} className={cardStyles.reposition}>
                <PublishedBriefStack cards={[item.card]} hue={campaign.hue} />
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
