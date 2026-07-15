"use client";

// Mobile Compact Build View (14 Jul 2026 redesign): below ~768px a single calm
// column shows the brief itself — decision point cards, the document library,
// and the accepted campaign content. Live theatre is carried by the Agent
// Build Bar rendered above this view (AssemblyView); Fact checks render below
// it. No inline agent workspaces, no status chips.

import { JOURNEY_STEPS, type JudgementAnswerRequest } from "@/lib/factory/contracts";
import type { CompiledCampaignBundle, RunVM } from "@/lib/factory/client";
import { YourJudgementCard } from "@/components/factory/judgement/YourJudgementCard";
import { DocumentLibrary as CompiledDocumentLibrary } from "@/components/factory/documents/DocumentLibrary";
import { DocumentLibrary } from "./DocumentLibrary";
import { SectionContent } from "./SectionContent";

export function MobileCompactView({
  run,
  onAnswer,
  compiled = null,
}: {
  run: RunVM;
  onAnswer: (jid: string, action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
  /** W6-compiled document bodies for a terminal run (see AssemblyView). */
  compiled?: CompiledCampaignBundle | null;
}) {
  const openJudgements = run.judgements.filter((j) => j.status === "open");
  const builtSteps = JOURNEY_STEPS.map((s) => run.sections[s.key]).filter(
    (sec) => sec.content != null,
  );

  return (
    <div className="fa-mobile">
      {openJudgements.length ? (
        <div>
          <p className="fa-mobile__h">Decision points</p>
          {openJudgements.map((j) => (
            <YourJudgementCard key={j.id} judgement={j} onAnswer={(action, answer) => onAnswer(j.id, action, answer)} />
          ))}
        </div>
      ) : null}

      {builtSteps.length ? (
        <div>
          <p className="fa-mobile__h">Campaign brief so far</p>
          {builtSteps.map((sec) => (
            <div key={sec.key} style={{ marginBottom: "1.2rem" }}>
              <h3 style={{ fontSize: "1.1rem", margin: "0 0 .3rem", fontWeight: 500 }}>{sec.title}</h3>
              <SectionContent stepKey={sec.key} content={sec.content} />
            </div>
          ))}
        </div>
      ) : (
        <p className="fa-skeleton__hint">
          Nothing built yet — sections appear here as the agents finish their work.
        </p>
      )}

      <div>
        <p className="fa-mobile__h">Campaign documents</p>
        {compiled ? (
          <CompiledDocumentLibrary documents={compiled.documents} />
        ) : (
          <DocumentLibrary documents={run.documents} />
        )}
      </div>
    </div>
  );
}
