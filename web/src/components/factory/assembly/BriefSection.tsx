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
import { AgentIdentityPill, AgentWorkCard } from "@/components/factory/cards";
import type { AgentCardVM as CardVM } from "@/components/factory/cards";
import type { AgentCardVM as FoldAgentVM, JudgementVM, SectionVM } from "@/lib/factory/client";
import type { JudgementAnswerRequest, SectionStatus } from "@/lib/factory/contracts";
import { PLAIN_SECTION_STATUS } from "@/lib/factory/documents";
import { StepWorkspace } from "./StepWorkspace";
import { SectionContent } from "./SectionContent";
import { YourJudgementCard } from "@/components/factory/judgement/YourJudgementCard";
import { fmtClock } from "./format";

// Plain-English chips (language.ts); the canonical SectionStatus strings stay
// on the data / events unchanged.
const STATUS_LABEL: Record<SectionStatus, string> = PLAIN_SECTION_STATUS;

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
  // Contributor pills toggle open into full Agent Work Cards on click.
  const [openAgents, setOpenAgents] = useState<Set<string>>(() => new Set());
  const toggleAgent = (id: string) =>
    setOpenAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
              {r.sourceCount ? <span className="fa-mono"> · {r.sourceCount} sources</span> : null}
              {section.acceptedAtVersion ? (
                <span className="fa-mono"> · revision {section.acceptedAtVersion}</span>
              ) : null}
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
            <button
              key={a.agentRunId}
              type="button"
              className="fa-receipt__agentToggle"
              onClick={() => toggleAgent(a.agentRunId)}
              aria-expanded={openAgents.has(a.agentRunId)}
              title={openAgents.has(a.agentRunId) ? `Collapse ${a.shortName}` : `Show ${a.shortName}'s work`}
            >
              {openAgents.has(a.agentRunId) ? (
                <AgentWorkCard vm={toCardVm(a)} now={now} />
              ) : (
                <AgentIdentityPill vm={toCardVm(a)} now={now} />
              )}
            </button>
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
            <YourJudgementCard key={j.id} judgement={j} onAnswer={(action, answer) => onAnswer(j.id, action, answer)} />
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
