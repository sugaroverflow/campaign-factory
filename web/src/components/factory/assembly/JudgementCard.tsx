"use client";

// Your Judgement Card (W4 placeholder). W6 owns the real judgement component
// (~H5); adopt it here when announced. Until then this posts answer / defer /
// accept-default to /api/factory/runs/[id]/judgements/[jid] via the hook's
// answerJudgement callback. Judgement cards always render above connectors and
// agent cards (parameters §6) and are non-blocking — a Provisional Default keeps
// the run moving if the human does nothing.

import { useState } from "react";
import type { JudgementAnswerRequest } from "@/lib/factory/contracts";
import type { JudgementVM } from "@/lib/factory/client";

export function JudgementCard({
  judgement,
  onAnswer,
}: {
  judgement: JudgementVM;
  onAnswer: (action: JudgementAnswerRequest["action"], answer?: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolved = judgement.status !== "open";

  const submit = async (action: JudgementAnswerRequest["action"], answer?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await onAnswer(action, answer);
    setBusy(false);
    if (!ok) setError("Couldn't send that just now — the run keeps going on the provisional default.");
    // On success we wait for the judgement.resolved / .defaulted event to flip
    // the card, rather than optimistically inventing a resolution.
  };

  if (resolved) {
    return (
      <div className={`fa-judge ${judgement.status === "resolved" ? "fa-judge--resolved" : "fa-judge--defaulted"}`}>
        <div className="fa-judge__eyebrow">
          Your judgement · {judgement.status === "resolved" ? "answered" : "provisional default applied"}
        </div>
        <p className="fa-judge__q">{judgement.question}</p>
        {judgement.answer ? (
          <p className="fa-judge__why">
            <b>Using:</b> {judgement.answer}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fa-judge fa-enter">
      <div className="fa-judge__eyebrow">Your judgement{judgement.kind ? ` · ${judgement.kind.replace(/_/g, " ")}` : ""}</div>
      <p className="fa-judge__q">{judgement.question}</p>
      {judgement.rationale ? <p className="fa-judge__why">{judgement.rationale}</p> : null}
      {judgement.affectedOutputs.length ? (
        <p className="fa-judge__meta">Affects: {judgement.affectedOutputs.join(", ")}</p>
      ) : null}

      <div className="fa-judge__opts">
        {judgement.options.map((opt) => (
          <button
            key={opt}
            type="button"
            className="fa-judge__opt"
            data-default={opt === judgement.provisionalDefault ? "1" : undefined}
            disabled={busy}
            onClick={() => submit("answer", opt)}
          >
            {opt}
          </button>
        ))}
      </div>

      <div className="fa-judge__actions">
        {judgement.provisionalDefault ? (
          <button type="button" className="toolbtn" disabled={busy} onClick={() => submit("accept_default")}>
            Accept default
          </button>
        ) : null}
        <button type="button" className="toolbtn" disabled={busy} onClick={() => submit("defer")}>
          Decide later
        </button>
        <span className="fa-judge__meta">Non-blocking — other work continues.</span>
      </div>
      {error ? <p className="fa-judge__meta" style={{ color: "var(--bad)" }}>{error}</p> : null}
    </div>
  );
}
