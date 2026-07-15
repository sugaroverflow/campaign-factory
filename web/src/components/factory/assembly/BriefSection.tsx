"use client";

// One rung of the ten-step Campaign Brief (W4). Reuses the Journey rail/rung
// layout (journey.css) so the light product IS the page. Surfaces in a rung,
// top to bottom (parameters §6):
//   1. Your Judgement Cards affecting this section (always on top)
//   2. active Step Workspace (dark overlay) — only while agents work here
//   3. Step Build Receipt + Step Report toggle + contributor pills — once done
//   4. accepted campaign content — appears the moment the reviewer accepts
//   5. optional footer (e.g. the nine-document library on step 10)
//   6. skeleton — until anything lands
// The page NEVER auto-jumps between sections.

import { useState, type ReactNode } from "react";
import { AgentIdentityPill } from "@/components/factory/cards";
import type { AgentCardVM as CardVM } from "@/components/factory/cards";
import type { AgentCardVM as FoldAgentVM, JudgementVM, SectionVM } from "@/lib/factory/client";
import type { JudgementAnswerRequest, SectionStatus } from "@/lib/factory/contracts";
import { StepWorkspace } from "./StepWorkspace";
import { SectionContent } from "./SectionContent";
import { JudgementCard } from "./JudgementCard";
import { fmtClock } from "./format";

const STATUS_LABEL: Record<SectionStatus, string> = {
  empty: "Waiting",
  assembling: "Assembling",
  under_review: "In review",
  accepted: "Accepted",
  needs_verification: "Needs verification",
};

function Receipt({
  section,
  contributors,
  toCardVm,
  now,
}: {
  section: SectionVM;
  contributors: FoldAgentVM[];
  toCardVm: (a: FoldAgentVM) => CardVM;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const r = section.receipt;
  const verify = section.status === "needs_verification";
  return (
    <div className="fa-receipt fa-enter">
      <div className="fa-receipt__line">
        <span className={verify ? "fa-receipt__warn" : "fa-receipt__ok"}>{verify ? "⚠ Built with gaps" : "✓ Built"}</span>
        <span>
          {STATUS_LABEL[section.status]}
          {r ? (
            <>
              {" · "}
              <span className="fa-mono">{fmtClock(r.at)}</span>
              {r.agentCount ? <span className="fa-mono"> · {r.agentCount} agents</span> : null}
              {r.sourceCount ? <span className="fa-mono"> · {r.sourceCount} src</span> : null}
              {section.acceptedAtVersion ? <span className="fa-mono"> · v{section.acceptedAtVersion}</span> : null}
            </>
          ) : null}
        </span>
        {section.stepReport ? (
          <button className="fa-receipt__toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide step report" : "Step report"}
          </button>
        ) : null}
      </div>
      {contributors.length ? (
        <div className="fa-receipt__contrib">
          {contributors.map((a) => (
            <AgentIdentityPill key={a.agentRunId} vm={toCardVm(a)} now={now} />
          ))}
        </div>
      ) : null}
      {open && section.stepReport ? <div className="fa-receipt__report">{section.stepReport}</div> : null}
    </div>
  );
}

export function BriefSection({
  section,
  activeAgents,
  completedAgents,
  judgements,
  toCardVm,
  now,
  onAnswer,
  id,
  footer,
}: {
  section: SectionVM;
  activeAgents: FoldAgentVM[];
  completedAgents: FoldAgentVM[];
  judgements: JudgementVM[];
  toCardVm: (a: FoldAgentVM) => CardVM;
  now: number;
  onAnswer: (jid: string, action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
  id: string;
  footer?: ReactNode;
}) {
  const done = section.status === "accepted" || section.status === "needs_verification";
  const hasContent = section.content != null;
  const idle = !done && activeAgents.length === 0 && !hasContent;

  return (
    <section className={`rung${activeAgents.length ? " active" : ""}`} id={id} data-stage={section.key}>
      <div className="jcontainer rung-grid">
        <aside>
          <div className="n">{section.step}</div>
          <h2>{section.title}</h2>
          <p className="whatsnew">
            <span className="fa-chip" data-status={section.status}>
              {STATUS_LABEL[section.status]}
            </span>
          </p>
        </aside>
        <div className="rc">
          {judgements.map((j) => (
            <JudgementCard key={j.id} judgement={j} onAnswer={(action, answer) => onAnswer(j.id, action, answer)} />
          ))}

          {activeAgents.length > 0 ? (
            <StepWorkspace title={section.title} agents={activeAgents} toCardVm={toCardVm} now={now} />
          ) : null}

          {done ? (
            <Receipt section={section} contributors={completedAgents} toCardVm={toCardVm} now={now} />
          ) : null}

          {hasContent ? <SectionContent stepKey={section.key} content={section.content} /> : null}

          {footer}

          {idle ? (
            <div>
              <div className="fa-skeleton" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <p className="fa-skeleton__hint">Not built yet — agents will assemble this section from accepted evidence.</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
