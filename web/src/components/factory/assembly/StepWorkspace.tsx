"use client";

// Step Workspace (W4) — the active work surface rendered directly ABOVE the
// section it is building (parameters §6, Public Campaign Assembly View):
// one expanded W5 AgentWorkCard + up to four compact contributing cards inline.
// W4 owns this layout decision (which agent expands); W5 owns the cards.
// The page never auto-scrolls; the workspace just appears in place.

import { AgentWorkCard, CompactAgentCard } from "@/components/factory/cards";
import type { AgentCardVM as CardVM } from "@/components/factory/cards";
import type { AgentCardVM as FoldAgentVM } from "@/lib/factory/client";

const MAX_COMPACT = 4;

export function StepWorkspace({
  title,
  agents,
  toCardVm,
  now,
}: {
  title: string;
  agents: FoldAgentVM[]; // active, priority-ordered (expanded first)
  toCardVm: (a: FoldAgentVM) => CardVM;
  now: number;
}) {
  if (agents.length === 0) return null;
  const [primary, ...rest] = agents;
  const compact = rest.slice(0, MAX_COMPACT);
  const overflow = rest.length - compact.length;

  return (
    <div className="fa-workspace fa-enter" aria-label={`Building ${title}`}>
      <div className="fa-workspace__bar">
        <b>Building</b>
        {title}
        <span className="fa-workspace__live">
          {agents.length} agent{agents.length === 1 ? "" : "s"} active
        </span>
      </div>
      <div className="fa-workspace__cards">
        <AgentWorkCard vm={toCardVm(primary)} now={now} />
        {compact.length > 0 ? (
          <div className="fa-workspace__compacts">
            {compact.map((a) => (
              <CompactAgentCard key={a.agentRunId} vm={toCardVm(a)} now={now} />
            ))}
            {overflow > 0 ? <div className="fa-pill">+{overflow} more contributing</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
