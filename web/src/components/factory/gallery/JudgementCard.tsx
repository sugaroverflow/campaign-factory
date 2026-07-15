// "Your Judgement" card — a calm, human-authority surface that renders ABOVE
// connectors and agent cards. Nonblocking: a Provisional Default is shown and
// the run continues; the presenter may confirm or override without stalling the
// batch. Read-only in replay (no onAnswer).

import type { JudgementVM } from "@/lib/factory/client/fold";
import type { JudgementAnswerRequest } from "@/lib/factory/contracts";
import { hueByIndex } from "@/components/factory/cards";
import type { CampaignHueIndex } from "@/components/factory/cards";

export function JudgementCard({
  judgement,
  hue,
  onAnswer,
}: {
  judgement: JudgementVM;
  hue: CampaignHueIndex;
  onAnswer?: (judgementId: string, action: JudgementAnswerRequest["action"], answer?: string) => void;
}) {
  const h = hueByIndex(hue);
  const open = judgement.status === "open";

  return (
    <div
      style={{
        background: "var(--pale-yellow)",
        border: "1px solid rgba(168,106,0,0.35)",
        borderLeft: `3px solid ${h.accent}`,
        borderRadius: 12,
        padding: "10px 12px",
        color: "#1b1d1e",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(27,29,30,0.6)" }}>
          Your judgement
        </span>
        <span style={{ fontSize: 10, color: "rgba(27,29,30,0.5)", marginLeft: "auto" }}>
          {judgement.status === "open" ? "awaiting you" : judgement.status === "defaulted" ? "using default" : "resolved"}
        </span>
      </div>

      <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.35, fontWeight: 500 }}>{judgement.question}</p>

      {judgement.provisionalDefault ? (
        <p style={{ margin: "5px 0 0", fontSize: 11, color: "rgba(27,29,30,0.65)" }}>
          Provisional default: <strong>{judgement.provisionalDefault}</strong>
          {open ? " — applied unless you choose otherwise" : ""}
        </p>
      ) : null}

      {open && onAnswer && judgement.options.length > 0 ? (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {judgement.options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onAnswer(judgement.id, "answer", opt)}
              style={{
                fontSize: 11.5,
                borderRadius: 999,
                border: "1px solid rgba(27,29,30,0.2)",
                background: opt === judgement.provisionalDefault ? "#1b1d1e" : "#fff",
                color: opt === judgement.provisionalDefault ? "#fff" : "#1b1d1e",
                padding: "3px 10px",
                cursor: "pointer",
              }}
            >
              {opt}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onAnswer(judgement.id, "accept_default")}
            style={{
              fontSize: 11.5,
              borderRadius: 999,
              border: "1px dashed rgba(27,29,30,0.3)",
              background: "transparent",
              color: "rgba(27,29,30,0.65)",
              padding: "3px 10px",
              cursor: "pointer",
            }}
          >
            Keep default
          </button>
        </div>
      ) : null}

      {judgement.answer && !open ? (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "rgba(27,29,30,0.7)" }}>
          Answer: <strong>{judgement.answer}</strong>
        </p>
      ) : null}
    </div>
  );
}
