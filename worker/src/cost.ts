// Cost guard (parameters §5). Checked before starting each model node. Crossing
// a HARD stop stops new model nodes, lets deterministic finalisation run, and
// records remaining work as Terminal Gaps — it never fabricates completion.

import { COST_GUARDS } from "@web/lib/factory/contracts/limits.js";
import type { Sql } from "./db/pool.js";
import { batchCostTotal, campaignCostTotal } from "./store/index.js";

export interface CostStatus {
  campaignSpendUSD: number;
  batchSpendUSD?: number;
  campaignWarning: boolean;
  campaignHardStop: boolean;
  batchWarning: boolean;
  batchHardStop: boolean;
  hardStop: boolean; // either campaign OR batch hard stop
  reason?: string;
}

export async function checkCost(
  sql: Sql,
  campaignId: string,
  batchId?: string | null,
): Promise<CostStatus> {
  const campaignSpendUSD = await campaignCostTotal(sql, campaignId);
  const campaignWarning = campaignSpendUSD >= COST_GUARDS.perCampaignWarningUSD;
  const campaignHardStop = campaignSpendUSD >= COST_GUARDS.perCampaignHardStopUSD;

  let batchSpendUSD: number | undefined;
  let batchWarning = false;
  let batchHardStop = false;
  if (batchId) {
    batchSpendUSD = await batchCostTotal(sql, batchId);
    batchWarning = batchSpendUSD >= COST_GUARDS.presenterBatchWarningUSD;
    batchHardStop = batchSpendUSD >= COST_GUARDS.presenterBatchHardStopUSD;
  }

  const hardStop = campaignHardStop || batchHardStop;
  const reason = campaignHardStop
    ? `Campaign spend $${campaignSpendUSD.toFixed(2)} reached the $${COST_GUARDS.perCampaignHardStopUSD} hard stop`
    : batchHardStop
      ? `Batch spend $${(batchSpendUSD ?? 0).toFixed(2)} reached the $${COST_GUARDS.presenterBatchHardStopUSD} hard stop`
      : undefined;

  return {
    campaignSpendUSD,
    batchSpendUSD,
    campaignWarning,
    campaignHardStop,
    batchWarning,
    batchHardStop,
    hardStop,
    reason,
  };
}
