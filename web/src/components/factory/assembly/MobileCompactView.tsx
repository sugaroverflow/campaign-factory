"use client";

// Mobile Compact Build View (parameters §6): below ~768px there is NO spatial
// overlay. A single calm column shows the active-agent count, current
// assignments, the latest finding, judgement cards, receipts, and the accepted
// brief content — everything legible, nothing floating.

import { JOURNEY_STEPS, type JudgementAnswerRequest } from "@/lib/factory/contracts";
import {
  activeAgentCount,
  type AgentCardVM,
  type CompiledCampaignBundle,
  type RunVM,
} from "@/lib/factory/client";
import { YourJudgementCard } from "@/components/factory/judgement/YourJudgementCard";
import { DocumentLibrary as CompiledDocumentLibrary } from "@/components/factory/documents/DocumentLibrary";
import { SectionContent } from "./SectionContent";
import { fmtClock } from "./format";

function latestFinding(run: RunVM): AgentCardVM["lastFinding"] | undefined {
  let best: AgentCardVM["lastFinding"] | undefined;
  let bestT = -1;
  for (const a of run.agents) {
    const f = a.lastFinding;
    if (!f) continue;
    const t = Date.parse(f.at);
    if (!Number.isNaN(t) && t > bestT) {
      bestT = t;
      best = f;
    }
  }
  return best;
}

export function MobileCompactView({
  run,
  onAnswer,
  compiled = null,
}: {
  run: RunVM;
  now: number;
  onAnswer: (jid: string, action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
  /** W6-compiled document bodies for a terminal run (see AssemblyView). */
  compiled?: CompiledCampaignBundle | null;
}) {
  const active = run.agents.filter((a) => a.status === "queued" || a.status === "running");
  const finding = latestFinding(run);
  const openJudgements = run.judgements.filter((j) => j.status === "open");
  const acceptedSteps = JOURNEY_STEPS.map((s) => run.sections[s.key]).filter(
    (sec) => sec.status === "accepted" || sec.status === "needs_verification",
  );

  return (
    <div className="fa-mobile">
      <div className="fa-mobile__stat">
        <b>{activeAgentCount(run)}</b>
        <small>{activeAgentCount(run) === 1 ? "agent active now" : "agents active now"}</small>
      </div>

      {active.length ? (
        <div>
          <p className="fa-mobile__h">Current assignments</p>
          {active.map((a) => (
            <div className="fa-mobile__assign" key={a.agentRunId}>
              <b>{a.shortName}</b>
              {a.currentVerb ? <span className="fa-mono"> {a.currentVerb}</span> : null}
              {a.lastEvent ? <div>{a.lastEvent.summary}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {finding ? (
        <div>
          <p className="fa-mobile__h">Latest finding</p>
          <div className="fa-mobile__assign">
            {finding.summary}
            <div className="fa-mono">{fmtClock(finding.at)}</div>
          </div>
        </div>
      ) : null}

      {openJudgements.length ? (
        <div>
          <p className="fa-mobile__h">Your judgement</p>
          {openJudgements.map((j) => (
            <YourJudgementCard key={j.id} judgement={j} onAnswer={(action, answer) => onAnswer(j.id, action, answer)} />
          ))}
        </div>
      ) : null}

      {compiled ? (
        <div>
          <p className="fa-mobile__h">Campaign documents</p>
          <CompiledDocumentLibrary documents={compiled.documents} />
        </div>
      ) : null}

      {acceptedSteps.length ? (
        <div>
          <p className="fa-mobile__h">Campaign brief so far</p>
          {acceptedSteps.map((sec) => (
            <div key={sec.key} style={{ marginBottom: "1.2rem" }}>
              <h3 style={{ fontSize: "1.1rem", margin: "0 0 .3rem", fontWeight: 500 }}>{sec.title}</h3>
              {sec.receipt ? (
                <div className="fa-mono" style={{ marginBottom: ".4rem" }}>
                  {sec.status === "needs_verification" ? "built with gaps" : "built"} · {fmtClock(sec.receipt.at)}
                </div>
              ) : null}
              {sec.content != null ? <SectionContent stepKey={sec.key} content={sec.content} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
