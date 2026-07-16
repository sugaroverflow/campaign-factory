"use client";

// One rung of the Campaign Brief, in the ORIGINAL legacy Journey anatomy
// (original-brief redesign, 15 Jul 2026): sticky aside on the left with the
// number badge, the serif-italic title, a one-paragraph plain-English
// explainer, and a small bordered principle note — NO agent chip, no status
// chips (user decision; agent attribution lives in the Agent Build Bar).
// Right column: Decision point cards inline above the bespoke section content,
// a quiet skeleton until content lands, and an optional footer (the step-10
// Document Library). Reveal + scrollspy are driven by the parent observer via
// data-stage / data-on / the .active class, exactly like the legacy Journey.
// The page NEVER auto-jumps between sections.

import { type ReactNode } from "react";
import type { JudgementVM, SectionVM } from "@/lib/factory/client";
import type { JudgementAnswerRequest } from "@/lib/factory/contracts";
import { YourJudgementCard } from "@/components/factory/judgement/YourJudgementCard";
import { SectionContent, type EvidenceExtras } from "./SectionContent";
import type { RungCopy } from "./stepCopy";

export function BriefSection({
  section,
  copy,
  judgements,
  onAnswer,
  canDecide = true,
  id,
  footer,
  active = false,
  revealed = true,
  evidenceExtras,
}: {
  section: SectionVM;
  copy: RungCopy;
  judgements: JudgementVM[];
  onAnswer: (jid: string, action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
  /** False for a shared-link viewer with no run token (see AssemblyView). */
  canDecide?: boolean;
  id: string;
  footer?: ReactNode;
  active?: boolean;
  revealed?: boolean;
  /** Register-backed claim rows for the evidence rung's framed card. */
  evidenceExtras?: EvidenceExtras;
}) {
  const hasContent = section.content != null;

  return (
    <section
      className={`rung cf-reveal${active ? " active" : ""}`}
      id={id}
      data-stage={section.key}
      data-on={revealed ? "1" : "0"}
    >
      <div className="jcontainer rung-grid">
        <aside>
          <div className="n">{section.step}</div>
          <h2>{copy.title}</h2>
          {copy.limit ? <p className="limit">{copy.limit}</p> : null}
        </aside>
        <div className="rc">
          {judgements.map((j) => (
            <YourJudgementCard key={j.id} judgement={j} canDecide={canDecide} onAnswer={(action, answer) => onAnswer(j.id, action, answer)} />
          ))}

          {hasContent ? (
            <div data-anim="1">
              <SectionContent stepKey={section.key} content={section.content} evidenceExtras={evidenceExtras} />
            </div>
          ) : null}

          {footer ? <div data-anim="2">{footer}</div> : null}

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
