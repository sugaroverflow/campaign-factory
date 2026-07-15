// Collapsed completed state: an agent shrinks to a hue-edged identity pill once
// its completion event has stayed readable for 800–1200ms (the live layer times
// that; this component just draws the collapsed state).

import { CircleCheck, CircleAlert, TriangleAlert } from "lucide-react";
import { hueByIndex } from "./hues";
import { AgentIcon } from "./icons";
import { INK } from "./chrome";
import styles from "./factory.module.css";
import type { AgentCardProps } from "./types";

export function AgentIdentityPill({ vm }: AgentCardProps) {
  const hue = hueByIndex(vm.hue);
  const Tail =
    vm.status === "failed" ? TriangleAlert : vm.status === "partial" ? CircleAlert : CircleCheck;
  const tailColor =
    vm.status === "failed" ? "#ff8a8a" : vm.status === "partial" ? "#f6d873" : "#8fe08a";

  return (
    <div
      className={`${styles.collapse} ${styles.glass}`}
      title={`${vm.displayName} — ${vm.campaignShortName}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        maxWidth: 180,
        padding: "4px 9px 4px 7px",
        borderRadius: 999,
        background: INK.surfaceCompact,
        border: `1px solid ${INK.border}`,
        borderLeft: `3px solid ${hue.edgeGlowless}`,
        color: INK.text,
        lineHeight: 1.1,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          borderRadius: 999,
          background: hue.softBg,
          color: hue.accent,
          flexShrink: 0,
        }}
      >
        <AgentIcon agentKey={vm.agentKey} size={12} />
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {vm.shortName}
      </span>
      <Tail size={13} color={tailColor} aria-hidden style={{ flexShrink: 0 }} />
    </div>
  );
}
