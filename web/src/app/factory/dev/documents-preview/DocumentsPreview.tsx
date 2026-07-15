"use client";

// Fixture-driven preview of every W6 documents surface. Runs the REAL pure
// compiler + receipt builders over the Leicester fixture and renders the REAL
// components. Clearly labelled; makes no network calls and no model calls.

import { useMemo } from "react";
import {
  buildBatchReceipt,
  buildCampaignReceipt,
  compileDocuments,
  type BatchReceiptCampaignInput,
} from "@/lib/factory/documents";
import {
  FIXTURE_CLAIMS,
  FIXTURE_EVENTS,
  FIXTURE_JUDGEMENTS,
  FIXTURE_STATE,
} from "@/lib/factory/documents/fixtures";
import type { FactoryEvent } from "@/lib/factory/contracts";
import { DocumentLibrary } from "@/components/factory/documents/DocumentLibrary";
import { YourJudgementCard } from "@/components/factory/judgement/YourJudgementCard";
import { CampaignCompletionReceipt } from "@/components/factory/receipts/CampaignCompletionReceipt";
import { BatchReceipt } from "@/components/factory/receipts/BatchReceipt";
import "@/app/journey.css";

/** Clone the fixture events, overriding the final run.* event, to give the batch
 *  table honest status variety (completed / partial / failed) in the preview. */
function withFinalRun(type: FactoryEvent["type"]): FactoryEvent[] {
  const out = [...FIXTURE_EVENTS];
  out[out.length - 1] = { ...out[out.length - 1], type };
  return out;
}

export function DocumentsPreview() {
  const docs = useMemo(() => compileDocuments(FIXTURE_STATE, FIXTURE_CLAIMS), []);
  const receipt = useMemo(
    () => buildCampaignReceipt(FIXTURE_EVENTS, FIXTURE_STATE, FIXTURE_CLAIMS),
    [],
  );
  const batch = useMemo(() => {
    const variants: Array<{ place: string; id: string; final: FactoryEvent["type"] }> = [
      { place: "Leicester", id: "fx-leicester", final: "run.partial" },
      { place: "Stratford", id: "fx-stratford", final: "run.completed" },
      { place: "Barnes", id: "fx-barnes", final: "run.failed" },
    ];
    const inputs: BatchReceiptCampaignInput[] = variants.map((v) => ({
      events: withFinalRun(v.final).map((e) => ({ ...e, campaignId: v.id })),
      state: { ...FIXTURE_STATE, campaignId: v.id, place: v.place },
      claims: FIXTURE_CLAIMS,
    }));
    return buildBatchReceipt(inputs, { batchId: "fixture-batch" });
  }, []);

  const noop = async () => true;

  return (
    <main className="min-h-dvh">
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 60,
          display: "flex",
          gap: ".6rem",
          alignItems: "center",
          flexWrap: "wrap",
          background: "var(--pale-yellow)",
          padding: ".5rem 1rem",
          fontSize: ".82rem",
        }}
      >
        <b>DEV PREVIEW · W6 documents / judgements / receipts</b>
        <span>Fixture: Leicester school-street (partial run). No real run, no model calls.</span>
      </div>

      <div className="jcontainer" style={{ paddingTop: "1.5rem", paddingBottom: "4rem" }}>
        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 500, marginBottom: ".4rem" }}>
            Campaign Completion Receipt
          </h2>
          <p className="hint-sm" style={{ marginBottom: "1rem" }}>
            Event-derived counts; honest about partial completion, failed agents, and terminal gaps.
          </p>
          <CampaignCompletionReceipt receipt={receipt} accent="var(--brand)" />
        </section>

        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 500, marginBottom: ".4rem" }}>
            Your Judgement Card — three states
          </h2>
          <p className="hint-sm" style={{ marginBottom: "1rem" }}>
            Unanswered, provisional default in effect, and an accepted human decision are visually
            distinct — silence is never rendered as approval (ADR 0005).
          </p>
          {FIXTURE_JUDGEMENTS.map((j) => (
            <YourJudgementCard key={j.id} judgement={j} onAnswer={noop} />
          ))}
        </section>

        <section style={{ marginBottom: "2.5rem" }}>
          <DocumentLibrary
            documents={docs}
            intro="Nine canonical documents. Status chips and the ready count are derived from real compiler output; export is disabled until the reviewer pass completes."
          />
        </section>

        <section>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 500, marginBottom: ".4rem" }}>Batch Receipt</h2>
          <p className="hint-sm" style={{ marginBottom: "1rem" }}>
            Three campaigns (partial / completed / failed) reported honestly side by side.
          </p>
          <BatchReceipt batch={batch} />
        </section>
      </div>
    </main>
  );
}
