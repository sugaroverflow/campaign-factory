// Deterministic finalisation node. Runs even on cancellation / cost hard stop
// (no model calls). Compiles the nine canonical documents via w6's compiler,
// persists document versions, emits document.status with the AUTHORITATIVE
// status + full content, records Terminal Gaps, emits the Campaign Completion
// Receipt, and is the SINGLE WRITER of the terminal run.* event + run status.

import type { RunnableConfig } from "@langchain/core/runnables";
import type { RunStatus } from "@web/lib/factory/contracts/core.js";
// Direct-module imports (not the documents/store index barrels) so tsx can
// statically link these VALUE imports.
import { compileDocuments } from "@web/lib/factory/documents/compile.js";
import { buildCampaignReceipt } from "@web/lib/factory/documents/receipts.js";
import { contextFrom } from "./context.js";
import type { GraphStateType } from "./state.js";
import * as store from "../store/index.js";

const MAX_INLINE_DOC_BYTES = 32 * 1024;

export function finaliseNode() {
  return async (state: GraphStateType, config?: RunnableConfig): Promise<Partial<GraphStateType>> => {
    const ctx = contextFrom(config);
    const campaignId = state.campaignId;
    const finalState = await store.getAcceptedState(ctx.sql, campaignId);
    const claims = await store.getClaims(ctx.sql, campaignId);

    // Surface any halt-recorded Terminal Gaps (deduped) as events.
    const seenGaps = new Set<string>();
    for (const gap of state.terminalGaps) {
      if (seenGaps.has(gap)) continue;
      seenGaps.add(gap);
      await ctx.emitter.emit({ type: "gap.terminal", payload: { summary: gap } });
    }

    // Compile all nine documents (deterministic; authoritative statuses).
    const docs = compileDocuments(finalState, claims);
    let documentsReady = 0;
    for (const doc of docs) {
      if (doc.status === "ready") documentsReady++;
      const resources = doc.isPack
        ? finalState.documents.find((d) => d.key === doc.key)?.resources ?? []
        : undefined;
      await store.saveDocumentVersion(ctx.sql, {
        campaignId,
        documentKey: doc.key,
        version: finalState.version,
        status: doc.status,
        html: doc.isPack ? undefined : doc.html,
        resources,
        stateVersion: finalState.version,
      });
      const inlineHtml = !doc.isPack && doc.html.length <= MAX_INLINE_DOC_BYTES;
      const inlineResources =
        doc.isPack && JSON.stringify(resources ?? []).length <= MAX_INLINE_DOC_BYTES;
      await ctx.emitter.emit({
        type: "document.status",
        stateVersion: finalState.version,
        payload: {
          summary: `${doc.name}: ${doc.status}`,
          documentKey: doc.key,
          documentStatus: doc.status,
          detail: {
            documentKey: doc.key,
            documentStatus: doc.status,
            version: finalState.version,
            flags: doc.flags,
            ...(inlineHtml ? { html: doc.html } : {}),
            ...(inlineResources ? { resources } : {}),
          },
        },
      });
    }

    // Decide the terminal status (single writer).
    const run = await store.getRun(ctx.sql, campaignId);
    const cancelled =
      run?.status === "cancelled" || (state.halted && (state.haltReason ?? "").includes("cancel"));
    let status: RunStatus;
    if (cancelled) status = "cancelled";
    else if (state.halted || seenGaps.size > 0 || documentsReady < docs.length) status = "partial";
    else status = "completed";

    // Mark the recurring reviewer complete (it spans the whole campaign).
    if (state.reviewerAgentRunId) {
      await store.setAgentRunStatus(ctx.sql, state.reviewerAgentRunId, "complete", {
        workSummary: "Synthesis review complete across all passes",
      });
      await ctx.emitter.emit({
        type: "agent.completed",
        agentRunId: state.reviewerAgentRunId,
        payload: {
          summary: "Campaign Synthesis Reviewer complete",
          agentKey: "synthesis_reviewer",
          agentDisplayName: "Campaign Synthesis Reviewer",
        },
      });
    }

    // Campaign Completion Receipt (w6 canonical shape). Built from the log
    // BEFORE the terminal event, so override status/partial with the decided
    // values. Emitted before the terminal event so a client that closes on the
    // terminal event has already seen the receipt.
    const costBreakdown = await store.campaignCostBreakdown(ctx.sql, campaignId);
    await store.setRunCost(ctx.sql, campaignId, costBreakdown.totalUsd);
    const events = await store.readEvents(ctx.sql, campaignId, 0, "all");
    const base = buildCampaignReceipt(events, finalState, claims);
    const receipt = {
      ...base,
      status,
      partial: status !== "completed",
      completedAt: new Date().toISOString(),
      costUSD: costBreakdown.totalUsd,
    };
    await ctx.emitter.emit({
      type: "receipt.campaign",
      stateVersion: finalState.version,
      payload: {
        summary: `Campaign ${status}: ${receipt.sections.accepted}/${receipt.sections.total} sections, ${receipt.documents.ready}/${receipt.documents.total} documents`,
        detail: receipt,
      },
    });

    // Terminal run event LAST — the single writer of run status + terminal event.
    await store.setRunStatus(ctx.sql, campaignId, status);
    const terminalType =
      status === "completed" ? "run.completed" : status === "cancelled" ? "run.cancelled" : "run.partial";
    await ctx.emitter.emit({
      type: terminalType,
      stateVersion: finalState.version,
      payload: { summary: `Run ${status}`, detail: { status } },
    });

    return { finalStatus: status };
  };
}
