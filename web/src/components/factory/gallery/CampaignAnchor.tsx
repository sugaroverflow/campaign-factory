// Opaque Campaign Card — a fixed anchor for one campaign. Stays legible from
// the back of the room: light, opaque, hue-tinted, large short name. This is
// the calm layer the dense agent overlay must never hide.

import { X } from "lucide-react";
import type { RunStatus } from "@/lib/factory/contracts";
import { hueByIndex } from "@/components/factory/cards";
import styles from "./gallery.module.css";
import type { GalleryCampaign } from "./viewModel";

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Building",
  completed: "Complete",
  partial: "Partial",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function CampaignAnchor({
  campaign,
  activeAgents,
  sectionsAccepted,
  onCancel,
}: {
  campaign: GalleryCampaign;
  activeAgents: number;
  sectionsAccepted: number;
  onCancel?: (campaignId: string) => void; // presenter-only, visually quiet
}) {
  const hue = hueByIndex(campaign.hue);
  const { run } = campaign;
  const canCancel = onCancel && (run.status === "running" || run.status === "queued");

  return (
    <div
      className={styles.anchor}
      style={{
        background: hue.anchorTint,
        border: `1px solid ${hue.anchorBorder}`,
        borderRadius: 12,
        padding: "10px 12px",
        color: "#1b1d1e",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: hue.accent, flexShrink: 0 }} />
        <span
          style={{
            // Scales with the floor density (phone / desktop / projector).
            fontSize: "var(--cf-anchor-title, 17px)",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={run.place}
        >
          {campaign.shortName}
        </span>
        <span
          style={{
            fontSize: "var(--cf-anchor-status, 10px)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "rgba(27,29,30,0.55)",
            flexShrink: 0,
          }}
        >
          {STATUS_LABEL[run.status]}
        </span>
        {canCancel ? (
          <button
            type="button"
            aria-label={`Cancel ${campaign.shortName}`}
            title="Cancel this campaign"
            onClick={() => onCancel?.(run.campaignId)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              borderRadius: 999,
              border: "1px solid rgba(27,29,30,0.18)",
              background: "transparent",
              color: "rgba(27,29,30,0.5)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={11} />
          </button>
        ) : null}
      </div>

      {run.problem ? (
        <p
          style={{
            margin: "6px 0 0",
            fontSize: "var(--cf-anchor-sub, 12px)",
            lineHeight: 1.35,
            color: "rgba(27,29,30,0.7)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {run.problem}
        </p>
      ) : null}

      <div
        style={{
          marginTop: 7,
          display: "flex",
          gap: 12,
          fontSize: "var(--cf-anchor-meta, 11px)",
          color: "rgba(27,29,30,0.6)",
        }}
      >
        <span>{activeAgents} working</span>
        <span>{sectionsAccepted}/10 accepted</span>
      </div>
    </div>
  );
}
