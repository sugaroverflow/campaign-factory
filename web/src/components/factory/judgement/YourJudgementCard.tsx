"use client";

// Decision Point card (ADR 0005; renamed from "Your judgement", 14 Jul 2026
// redesign — the "a choice we made — you can change it" framing stays). A calm,
// light PRODUCT surface (not a dark overlay card) that renders a conditional,
// non-blocking Judgement Request and visibly distinguishes three states, so
// silence is NEVER shown as approval:
//   • unanswered  — awaiting the campaigner; provisional default is only a
//                   recommendation, nothing is decided yet;
//   • provisional default in effect — the run proceeded on the recommendation
//                   because the branch reached its next dependent task; a
//                   Re-decide action is exposed;
//   • your decision recorded — an accepted human judgement.
//
// Actions (answer / defer / accept-default) prefer the injected `onAnswer`
// callback (W4 routes this through the signed useFactoryRun hook). When no
// callback is supplied it POSTs directly to w2-worker's proxy route:
//   POST /api/factory/runs/[campaignId]/judgements/[judgementId]   { action, answer? }
//
// Z-INDEX CONTRACT (for W4 assembly + W5 gallery): the card root carries
// `z-index: var(--yj-z, 45)` and position:relative, so it always layers ABOVE
// SVG connectors (z 1) and Agent Work Cards (z 2–4) while staying below modal
// panels such as the stakeholder drawer (z 60) and the site nav. Render it in
// normal document flow above the section/anchor it belongs to; do not wrap it in
// a lower stacking context. Override the layer per surface with --yj-z if needed.

import { useState } from "react";
import type {
  JudgementAnswerRequest,
  JudgementKind,
  JudgementStatus,
} from "@/lib/factory/contracts";
import { JUDGEMENT_FRAME } from "@/lib/factory/documents";
import "./judgement.css";

/** Structural view accepted by the card — both the frozen JudgementRequest
 *  contract and W4's folded JudgementVM satisfy it. */
export interface JudgementCardView {
  id: string;
  kind?: JudgementKind;
  question: string;
  options: string[];
  provisionalDefault?: string;
  rationale?: string;
  affectedOutputs: string[];
  status: JudgementStatus;
  answer?: string;
}

type Action = JudgementAnswerRequest["action"];

async function postAnswer(
  campaignId: string,
  judgementId: string,
  action: Action,
  answer?: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/factory/runs/${encodeURIComponent(campaignId)}/judgements/${encodeURIComponent(judgementId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, answer } satisfies JudgementAnswerRequest),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

const KIND_LABEL: Record<JudgementKind, string> = {
  scope_ambiguity: "scope",
  evidence_conflict: "evidence conflict",
  strategy_choice: "strategy choice",
  local_knowledge: "local knowledge",
};

export function YourJudgementCard({
  judgement,
  onAnswer,
  campaignId,
  readOnly = false,
}: {
  judgement: JudgementCardView;
  /** Preferred: W4's signed hook path. `(action, answer?) => ok`. */
  onAnswer?: (action: Action, answer?: string) => Promise<boolean>;
  /** Fallback when no onAnswer: POST directly to the worker proxy route. */
  campaignId?: string;
  /** Replay / dev: render state without accepting input. */
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reDeciding, setReDeciding] = useState(false);

  const kindLabel = judgement.kind ? KIND_LABEL[judgement.kind] : undefined;

  const send = async (action: Action, answer?: string) => {
    if (busy || readOnly) return;
    setBusy(true);
    setError(null);
    const ok = onAnswer
      ? await onAnswer(action, answer)
      : campaignId
        ? await postAnswer(campaignId, judgement.id, action, answer)
        : false;
    setBusy(false);
    if (!ok) {
      setError("Couldn't send that just now — the run keeps moving on the provisional default.");
    } else {
      setReDeciding(false);
    }
    // We do NOT optimistically flip the card: the authoritative state arrives via
    // the judgement.resolved / .defaulted Factory Event.
  };

  const eyebrow = (
    <div className="yj-eyebrow">
      <span className="yj-eyebrow__label">Decision point</span>
      {kindLabel ? <span className="yj-eyebrow__kind">{kindLabel}</span> : null}
    </div>
  );

  const optionButtons = (
    <div className="yj-opts">
      {judgement.options.map((opt) => (
        <button
          key={opt}
          type="button"
          className="yj-opt"
          data-default={opt === judgement.provisionalDefault ? "1" : undefined}
          disabled={busy || readOnly}
          onClick={() => send("answer", opt)}
        >
          <span className="yj-opt__text">{opt}</span>
          {opt === judgement.provisionalDefault ? (
            <span className="yj-opt__badge">recommended default</span>
          ) : null}
        </button>
      ))}
    </div>
  );

  // ---- resolved: accepted human judgement ----
  if (judgement.status === "resolved") {
    return (
      <div className="yj-card yj-card--resolved">
        {eyebrow}
        <div className="yj-state yj-state--resolved">Your decision recorded</div>
        <p className="yj-q">{judgement.question}</p>
        {judgement.answer ? (
          <p className="yj-answer">
            You chose: <b>{judgement.answer}</b>
          </p>
        ) : null}
      </div>
    );
  }

  // ---- defaulted: provisional default in effect (NOT human approval) ----
  if (judgement.status === "defaulted") {
    const inEffect = judgement.answer || judgement.provisionalDefault;
    return (
      <div className="yj-card yj-card--defaulted">
        {eyebrow}
        <div className="yj-state yj-state--defaulted">{JUDGEMENT_FRAME}</div>
        <p className="yj-q">{judgement.question}</p>
        {inEffect ? (
          <p className="yj-answer">
            Proceeding with the recommended default: <b>{inEffect}</b>
          </p>
        ) : null}
        <p className="yj-note">
          This was the provisional default, not your decision. You can still change it — a new answer
          re-runs only the affected downstream work.
        </p>
        {!readOnly ? (
          reDeciding ? (
            <>
              {optionButtons}
              <div className="yj-actions">
                <button type="button" className="toolbtn" disabled={busy} onClick={() => setReDeciding(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="yj-actions">
              <button type="button" className="toolbtn" disabled={busy} onClick={() => setReDeciding(true)}>
                Re-decide
              </button>
            </div>
          )
        ) : null}
        {error ? <p className="yj-error">{error}</p> : null}
      </div>
    );
  }

  // ---- open: unanswered ----
  return (
    <div className="yj-card yj-card--open">
      {eyebrow}
      <div className="yj-state yj-state--open">Needs your decision</div>
      <p className="yj-q">{judgement.question}</p>
      {judgement.rationale ? <p className="yj-why">{judgement.rationale}</p> : null}
      {judgement.affectedOutputs.length ? (
        <p className="yj-meta">Affects: {judgement.affectedOutputs.join(", ")}</p>
      ) : null}

      {optionButtons}

      <div className="yj-actions">
        {judgement.provisionalDefault ? (
          <button type="button" className="toolbtn" disabled={busy || readOnly} onClick={() => send("accept_default")}>
            Accept default
          </button>
        ) : null}
        <button type="button" className="toolbtn" disabled={busy || readOnly} onClick={() => send("defer")}>
          Decide later
        </button>
        <span className="yj-meta">Non-blocking — other work continues.</span>
      </div>
      <p className="yj-note">Nothing is decided yet — silence is not treated as approval.</p>
      {error ? <p className="yj-error">{error}</p> : null}
    </div>
  );
}
