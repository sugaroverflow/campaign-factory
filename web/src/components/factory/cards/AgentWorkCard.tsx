"use client";

// Expanded Agent Work Card (~300×190). The six regions (parameters §6):
//   1 agent identity pill + campaign identity
//   2 bounded assignment in one line
//   3 dense Work Backscroll (pinned to newest; scrolls, respects manual scroll)
//   4 current source / tool / handoff state — real verbs + content labels
//   5 latest useful finding or uncertainty
//   6 proposal / review status + elapsed
// Never token counts, hidden prompts, private reasoning, raw JSON, or stack
// traces. Monospace only for stamps, verbs, and the elapsed clock.

import { createElement, useEffect, useRef } from "react";
import { Radio, ArrowRightLeft, FileSearch, ScrollText, Clock } from "lucide-react";
import { hueByIndex } from "./hues";
import { AgentIcon } from "./icons";
import { INK, EXPANDED, mono, statusDot } from "./chrome";
import { clockStamp, elapsedClock } from "./format";
import styles from "./factory.module.css";
import type { AgentCardProps, CardActivity, CardProposalState } from "./types";

const MAX_ROWS = 100; // window the tail; VM may hold more (virtualised upstream)
const PIN_THRESHOLD_PX = 28; // manual backscroll further than this unpins autoscroll
// Fill-mode height lives in factory.module.css (.fillCard) so it can scale up
// at projector widths together with the identity typography.

function activityIcon(kind: CardActivity["kind"]) {
  switch (kind) {
    case "source":
      return FileSearch;
    case "handoff":
      return ArrowRightLeft;
    case "review":
      return ScrollText;
    case "analysis":
      return Clock;
    case "tool":
    default:
      return Radio;
  }
}

const PROPOSAL_TONE: Record<CardProposalState["tone"], string> = {
  pending: "#f6d873",
  accepted: "#8fe08a",
  returned: "#f6b873",
  rejected: "#ff8a8a",
  applied: "#8ad0ff",
};

export function AgentWorkCard({ vm, now, fill = false }: AgentCardProps) {
  const hue = hueByIndex(vm.hue);
  const rows = vm.backscroll.slice(-MAX_ROWS);
  const activityLabel = vm.activity?.label;
  // Only fall back to the generic analysis clock when there is genuinely no
  // content-bearing label (old recordings / silent model turns).
  const analysing =
    vm.status === "running" &&
    (!vm.activity || (vm.activity.kind === "analysis" && !activityLabel));
  const terminal =
    vm.status === "complete" || vm.status === "partial" || vm.status === "failed";
  const activityGlyph = createElement(activityIcon(vm.activity?.kind ?? "analysis"), {
    size: 12,
    color: hue.accent,
    "aria-hidden": true,
    style: { flexShrink: 0 },
  });

  // Backscroll pin-to-bottom: follow the newest row unless the user has
  // deliberately scrolled up to read history.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const newestRowKey = rows.length > 0 ? rows[rows.length - 1].eventId : undefined;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [newestRowKey]);
  const onBackscrollScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD_PX;
  };

  return (
    <div
      // Perf guardrail: fill mode can mean ~80 simultaneous full cards, so the
      // per-card backdrop blur is dropped there — the translucent background
      // alone lets the paper brief substrate show through (compositor-cheap).
      // .fillCard also carries the projector-scale typography vars + height.
      className={fill ? `${styles.cardEnter} ${styles.fillCard}` : `${styles.cardEnter} ${styles.glass}`}
      style={{
        width: fill ? "100%" : EXPANDED.w,
        height: fill ? undefined : EXPANDED.h,
        boxSizing: "border-box",
        padding: 10,
        borderRadius: 12,
        background: fill ? "rgba(22, 24, 27, 0.86)" : INK.surface,
        border: `1px solid ${terminal ? "rgba(255,255,255,0.05)" : INK.border}`,
        borderLeft: `3px solid ${hue.edgeGlowless}`,
        color: INK.text,
        display: "flex",
        flexDirection: "column",
        gap: 5,
        overflow: "hidden",
        // Working cards throw a faint hue glow into the layer beneath them.
        boxShadow: terminal ? undefined : `0 0 22px -9px ${hue.edgeGlowless}`,
        // Completed/partial/failed agents visibly stand down: dimmed and
        // desaturated so the still-working cards carry the room's attention.
        opacity: terminal ? 0.6 : undefined,
        filter: terminal ? "saturate(0.4)" : undefined,
        transition: "opacity 400ms ease, filter 400ms ease",
      }}
    >
      {/* 1 — identity + campaign */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: 7,
            background: hue.softBg,
            color: hue.accent,
            flexShrink: 0,
          }}
        >
          <AgentIcon agentKey={vm.agentKey} size={15} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Projector legibility: fill mode shows the full displayName, large
              and bright; assembly cards keep the compact shortName. */}
          <div className={styles.workTitle} title={vm.displayName}>
            {fill ? vm.displayName : vm.shortName}
          </div>
          <div className={styles.workCaption} title={vm.responsibility || undefined}>
            {vm.parentShortName
              ? `↳ from ${vm.parentShortName}`
              : vm.responsibility || (vm.kind === "specialist" ? "specialist" : "")}
          </div>
        </div>
        <span
          style={{
            ...mono,
            fontSize: "var(--cf-card-pill, 9px)",
            fontWeight: 600,
            color: hue.accent,
            background: hue.softBg,
            borderRadius: 999,
            padding: "1px 7px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {vm.campaignShortName}
        </span>
        <span
          aria-label={vm.status}
          className={vm.status === "running" ? styles.livePulse : undefined}
          style={{ width: 8, height: 8, borderRadius: 999, background: statusDot(vm.status), flexShrink: 0 }}
        />
      </div>

      {/* 2 — bounded assignment */}
      <div className={styles.workAssignment} title={vm.assignment}>
        {vm.assignment}
      </div>

      {/* 3 — Work Backscroll (pinned to newest) */}
      <div
        ref={scrollRef}
        onScroll={onBackscrollScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          borderTop: `1px solid ${INK.rowBorder}`,
          borderBottom: `1px solid ${INK.rowBorder}`,
          paddingBlock: 3,
        }}
      >
        {rows.length === 0 ? (
          <div style={{ ...mono, fontSize: 10, color: INK.textFaint, padding: "2px 0" }}>
            queued · awaiting first event
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.eventId}
              className={styles.backscrollRow}
              style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "1.5px 0" }}
            >
              <span style={{ ...mono, fontSize: "var(--cf-row-mono, 9px)", color: INK.textFaint, flexShrink: 0 }}>
                {clockStamp(r.at)}
              </span>
              {r.verb ? (
                <span style={{ ...mono, fontSize: "var(--cf-row-mono, 9px)", color: hue.accent, flexShrink: 0 }}>
                  {r.verb}
                </span>
              ) : null}
              <span
                style={{
                  fontSize: "var(--cf-row-summary, 10.5px)",
                  lineHeight: 1.25,
                  color: INK.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.summary}
              </span>
            </div>
          ))
        )}
      </div>

      {/* 4 — current source / tool / handoff / analysis state */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: "var(--cf-activity, 10.5px)",
          minHeight: 14,
        }}
      >
        {activityGlyph}
        {analysing ? (
          <span style={{ ...mono, color: INK.textMuted }}>
            Analysis in progress · {elapsedClock(vm.activity?.sinceAt ?? vm.startedAt ?? vm.lastEventAt, now)}
          </span>
        ) : (
          <>
            {vm.isHandingOff ? (
              <span style={{ fontWeight: 700, color: hue.accent, flexShrink: 0, whiteSpace: "nowrap" }}>
                handing off →
              </span>
            ) : vm.verb ? (
              <span style={{ ...mono, fontSize: 9.5, color: hue.accent, flexShrink: 0 }}>{vm.verb}</span>
            ) : null}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                color: INK.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activityLabel ?? "Working"}
            </span>
            {vm.status === "running" ? (
              <span style={{ ...mono, fontSize: 9, color: INK.textFaint, flexShrink: 0 }}>
                {elapsedClock(vm.activity?.sinceAt ?? vm.lastEventAt, now)}
              </span>
            ) : null}
          </>
        )}
      </div>

      {/* 5 — latest finding or uncertainty */}
      {vm.latestFinding ? (
        <div
          style={{
            fontSize: 10.5,
            lineHeight: 1.3,
            color: INK.textMuted,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {vm.latestFinding}
        </div>
      ) : null}

      {/* 6 — proposal / review status + elapsed */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          marginTop: "auto",
        }}
      >
        {vm.proposal ? (
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              color: PROPOSAL_TONE[vm.proposal.tone],
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{ width: 6, height: 6, borderRadius: 999, background: PROPOSAL_TONE[vm.proposal.tone], flexShrink: 0 }}
            />
            {vm.proposal.label}
          </span>
        ) : (
          <span />
        )}
        <span style={{ ...mono, fontSize: 9.5, color: INK.textFaint, flexShrink: 0 }}>
          {elapsedClock(vm.startedAt, vm.completedAt ? new Date(vm.completedAt).getTime() : now)}
        </span>
      </div>
    </div>
  );
}
