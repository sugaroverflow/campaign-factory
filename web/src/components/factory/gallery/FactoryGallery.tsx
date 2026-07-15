"use client";

// FactoryGallery — the pure renderer. It is a function of the event view model
// (GalleryCampaign[] = W4-folded RunVMs + hue + short name) plus `now`, and does
// NO fetching. The live gallery and W7 replay both render through this exact
// component so live and recorded runs look identical.

import { useMemo } from "react";
import type { JudgementAnswerRequest } from "@/lib/factory/contracts";
import { FactoryLedger } from "./FactoryLedger";
import { CampaignColumn } from "./CampaignColumn";
import {
  buildLedger,
  campaignCards,
  campaignEdges,
  type GalleryCampaign,
} from "./viewModel";
import { selectPresentation } from "./presentation";
import styles from "./gallery.module.css";

export interface FactoryGalleryProps {
  campaigns: GalleryCampaign[];
  now: number;
  connectionLabel?: string; // shown quietly in the ledger (e.g. "live", "recorded run")
  /** Readable window (in `now`'s time frame) before terminal cards pill.
   *  Condensed replay passes a value scaled by effective playback speed, since
   *  its `now` is a compressed virtual clock. Live omits it (default). */
  completionReadableMs?: number;
  onCancel?: (campaignId: string) => void; // presenter-only per-campaign cancel
  onAnswerJudgement?: (
    campaignId: string,
    judgementId: string,
    action: JudgementAnswerRequest["action"],
    answer?: string,
  ) => void;
}

export function FactoryGallery({
  campaigns,
  now,
  connectionLabel,
  completionReadableMs,
  onCancel,
  onAnswerJudgement,
}: FactoryGalleryProps) {
  const perCampaign = useMemo(
    () => campaigns.map((c) => ({ campaign: c, cards: campaignCards(c), edges: campaignEdges(c) })),
    [campaigns],
  );

  const allCards = useMemo(() => perCampaign.flatMap((p) => p.cards), [perCampaign]);
  const presentation = useMemo(
    () => selectPresentation(allCards, { now, readableMs: completionReadableMs }),
    [allCards, now, completionReadableMs],
  );
  const ledger = useMemo(() => buildLedger(campaigns), [campaigns]);

  return (
    <div>
      <div className={styles.field}>
        {perCampaign.map(({ campaign, cards, edges }) => (
          <CampaignColumn
            key={campaign.run.campaignId}
            campaign={campaign}
            cards={cards}
            presentation={presentation}
            edges={edges}
            now={now}
            onCancel={onCancel}
            onAnswerJudgement={onAnswerJudgement}
          />
        ))}
      </div>
      <FactoryLedger counts={ledger} connectionLabel={connectionLabel} />
    </div>
  );
}
