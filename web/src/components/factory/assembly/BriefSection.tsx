"use client";

// One rung of the ten-step Campaign Brief, returned to the ORIGINAL Journey
// design (14 Jul 2026 redesign): a calm scrollable flow of campaign materials —
// sticky numbered aside on the left, accepted content on the right, a quiet
// skeleton until content lands. All live theatre lives in the Agent Build Bar
// at the top of the page: no inline agent workspaces here, no contributor
// pills, no status chips on the rung (user decision), no step receipts.
// Decision point cards still render inline, above the section they affect.
// The page NEVER auto-jumps between sections.

import { type ReactNode } from "react";
import type { JudgementVM, SectionVM } from "@/lib/factory/client";
import type { JudgementAnswerRequest } from "@/lib/factory/contracts";
import { SectionContent } from "./SectionContent";
import { YourJudgementCard } from "@/components/factory/judgement/YourJudgementCard";

export function BriefSection({
  section,
  judgements,
  onAnswer,
  id,
  footer,
}: {
  section: SectionVM;
  judgements: JudgementVM[];
  onAnswer: (jid: string, action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
  id: string;
  footer?: ReactNode;
}) {
  const hasContent = section.content != null;

  return (
    <section className="rung" id={id} data-stage={section.key}>
      <div className="jcontainer rung-grid">
        <aside>
          <div className="n">{section.step}</div>
          <h2>{section.title}</h2>
        </aside>
        <div className="rc">
          {judgements.map((j) => (
            <YourJudgementCard key={j.id} judgement={j} onAnswer={(action, answer) => onAnswer(j.id, action, answer)} />
          ))}

          {hasContent ? <SectionContent stepKey={section.key} content={section.content} /> : null}

          {footer}

          {!hasContent && !footer ? (
            <div>
              <div className="fa-skeleton" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <p className="fa-skeleton__hint">Not built yet — this section fills in as the agents finish their work.</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
