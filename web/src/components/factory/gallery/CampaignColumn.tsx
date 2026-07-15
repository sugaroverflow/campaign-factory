"use client";

// One campaign region: opaque anchor (sticky, above everything), any open
// Judgement cards (also above), the published brief pieces assembling as
// sections are accepted, then the agent cards grouped by presentation
// (expanded → compact → pills), with a per-campaign connector overlay behind
// the cards. When the campaign reaches a usable terminal state the cluster
// resolves to: full Completion Receipt + the persistent published-brief stack +
// identity pills. Pills are click-to-expand everywhere, so the end state never
// collapses into unreadable chrome.

import { useMemo, useRef, useState } from "react";
import { AgentWorkCard, CompactAgentCard, AgentIdentityPill, hueByIndex } from "@/components/factory/cards";
import type { AgentCardVM, CardPresentation } from "@/components/factory/cards";
import type { JudgementAnswerRequest } from "@/lib/factory/contracts";
import { CampaignCompletionReceipt } from "@/components/factory/receipts/CampaignCompletionReceipt";
import cardStyles from "@/components/factory/cards/factory.module.css";
import styles from "./gallery.module.css";
import { CampaignAnchor } from "./CampaignAnchor";
import { JudgementCard } from "./JudgementCard";
import { ConnectorLayer } from "./ConnectorLayer";
import { PublishedBriefStack } from "./PublishedBriefStack";
import { runVmToCampaignReceipt } from "./receiptModel";
import type { ConnectorEdge, GalleryCampaign } from "./viewModel";

export function CampaignColumn({
  campaign,
  cards,
  presentation,
  edges,
  now,
  onCancel,
  onAnswerJudgement,
}: {
  campaign: GalleryCampaign;
  cards: AgentCardVM[];
  presentation: Map<string, CardPresentation>;
  edges: ConnectorEdge[];
  now: number;
  onCancel?: (campaignId: string) => void;
  onAnswerJudgement?: (
    campaignId: string,
    judgementId: string,
    action: JudgementAnswerRequest["action"],
    answer?: string,
  ) => void;
}) {
  const cardsRef = useRef<HTMLDivElement | null>(null);
  const { run } = campaign;

  // Pills the viewer has toggled back open into readable cards.
  const [openPills, setOpenPills] = useState<Set<string>>(() => new Set());
  const togglePill = (agentRunId: string) =>
    setOpenPills((prev) => {
      const next = new Set(prev);
      if (next.has(agentRunId)) next.delete(agentRunId);
      else next.add(agentRunId);
      return next;
    });

  const activeAgents = cards.filter((c) => c.status === "queued" || c.status === "running").length;
  const sectionsAccepted = Object.values(run.sections).filter((s) => s.status === "accepted").length;
  const showReceipt = run.status === "completed" || run.status === "partial" || !!run.receiptAt;

  const expanded = cards.filter((c) => presentation.get(c.agentRunId) === "expanded");
  const compact = cards.filter((c) => presentation.get(c.agentRunId) === "compact");
  const pills = cards.filter((c) => presentation.get(c.agentRunId) === "pill");

  const openJudgements = run.judgements.filter((j) => j.status === "open" || j.status === "defaulted");

  // Layout signature: recompute connectors only when something that moves cards
  // changes (which cards exist and how each is presented).
  const revision = useMemo(
    () => cards.map((c) => `${c.agentRunId}:${presentation.get(c.agentRunId) ?? "?"}`).join("|"),
    [cards, presentation],
  );

  const pillGroup = (pillVms: AgentCardVM[]) =>
    pillVms.length > 0 ? (
      <div className={styles.pillGroup}>
        {pillVms.map((vm) => (
          <button
            key={vm.agentRunId}
            type="button"
            data-agent-run-id={vm.agentRunId}
            className={`${styles.pillToggle} ${cardStyles.reposition}`}
            onClick={() => togglePill(vm.agentRunId)}
            aria-expanded={openPills.has(vm.agentRunId)}
            title={
              openPills.has(vm.agentRunId)
                ? `Collapse ${vm.shortName}`
                : `Show ${vm.shortName}'s work`
            }
          >
            {openPills.has(vm.agentRunId) ? (
              <AgentWorkCard vm={vm} now={now} />
            ) : (
              <AgentIdentityPill vm={vm} now={now} />
            )}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className={styles.column}>
      <CampaignAnchor
        campaign={campaign}
        activeAgents={activeAgents}
        sectionsAccepted={sectionsAccepted}
        onCancel={onCancel}
      />

      {openJudgements.length > 0 ? (
        <div className={styles.judgementStack}>
          {openJudgements.map((j) => (
            <JudgementCard
              key={j.id}
              judgement={j}
              hue={campaign.hue}
              onAnswer={
                onAnswerJudgement
                  ? (jid, action, answer) => onAnswerJudgement(run.campaignId, jid, action, answer)
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}

      {showReceipt ? (
        <>
          <CampaignCompletionReceipt
            receipt={runVmToCampaignReceipt(run)}
            accent={hueByIndex(campaign.hue).accent}
          />
          <PublishedBriefStack cards={run.publishedCards} hue={campaign.hue} />
          {/* Done mode keeps EVERY agent workspace readable (grayed by its
              terminal status) so the finished factory floor can be browsed. */}
          {cards.length > 0 ? (
            <div className={styles.cardGroup}>
              {cards.map((vm) => (
                <div key={vm.agentRunId} data-agent-run-id={vm.agentRunId} className={cardStyles.reposition}>
                  <AgentWorkCard vm={vm} now={now} />
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className={styles.cardsArea} ref={cardsRef}>
            <ConnectorLayer containerRef={cardsRef} edges={edges} revision={revision} />

            {expanded.length > 0 ? (
              <div className={styles.cardGroup}>
                {expanded.map((vm) => (
                  <div
                    key={vm.agentRunId}
                    data-agent-run-id={vm.agentRunId}
                    className={cardStyles.reposition}
                  >
                    <AgentWorkCard vm={vm} now={now} />
                  </div>
                ))}
              </div>
            ) : null}

            {compact.length > 0 ? (
              <div className={styles.cardGroup}>
                {compact.map((vm) => (
                  <div
                    key={vm.agentRunId}
                    data-agent-run-id={vm.agentRunId}
                    className={cardStyles.reposition}
                  >
                    <CompactAgentCard vm={vm} now={now} />
                  </div>
                ))}
              </div>
            ) : null}

            {pillGroup(pills)}

            {/* The brief accumulates as a paper substrate BENEATH the agent
                swarm — glassy dark cards above, output stacking up below. */}
            {run.publishedCards.length > 0 ? (
              <div className={styles.briefSubstrate}>
                <PublishedBriefStack cards={run.publishedCards} hue={campaign.hue} />
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
