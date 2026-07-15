"use client";

// SVG connector lines between parent and child agent cards within one campaign,
// with a short transfer pulse fired once when a new edge (a real spawn/handoff)
// appears. Endpoints are measured from the DOM (data-agent-run-id) relative to
// the cards container, recomputed only on layout change and capped at one
// animation frame (parameters §6 performance budget).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { hueByIndex } from "@/components/factory/cards";
import cardStyles from "@/components/factory/cards/factory.module.css";
import galleryStyles from "./gallery.module.css";
import type { ConnectorEdge } from "./viewModel";

interface Segment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  accent: string;
  isNew: boolean;
}

export function ConnectorLayer({
  containerRef,
  edges,
  revision,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  edges: ConnectorEdge[];
  revision: string | number; // change to force a recompute (presentation / run changes)
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const firstRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const base = el.getBoundingClientRect();
    const nodes = el.querySelectorAll<HTMLElement>("[data-agent-run-id]");
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    nodes.forEach((n) => {
      const id = n.dataset.agentRunId;
      if (!id) return;
      const r = n.getBoundingClientRect();
      pos.set(id, { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    });

    const prevSeen = seenRef.current;
    const out: Segment[] = [];
    for (const e of edges) {
      const p = pos.get(e.parentAgentRunId);
      const c = pos.get(e.childAgentRunId);
      if (!p || !c) continue;
      out.push({
        id: e.id,
        x1: p.x + p.w / 2,
        y1: p.y + p.h,
        x2: c.x + c.w / 2,
        y2: c.y,
        accent: hueByIndex(e.hue).edgeGlowless,
        isNew: !firstRef.current && !prevSeen.has(e.id),
      });
    }
    seenRef.current = new Set(edges.map((e) => e.id));
    firstRef.current = false;
    setSegments(out);
  }, [edges, containerRef]);

  const schedule = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
    });
  }, [recompute]);

  useLayoutEffect(() => {
    schedule();
  }, [schedule, revision]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);
    window.addEventListener("resize", schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, schedule]);

  return (
    <>
      <svg className={galleryStyles.connectorSvg} aria-hidden>
        {segments.map((s) => {
          const midY = (s.y1 + s.y2) / 2;
          return (
            <path
              key={s.id}
              d={`M ${s.x1} ${s.y1} C ${s.x1} ${midY}, ${s.x2} ${midY}, ${s.x2} ${s.y2}`}
              fill="none"
              stroke={s.accent}
              strokeWidth={1}
              strokeOpacity={0.5}
            />
          );
        })}
      </svg>
      {segments
        .filter((s) => s.isNew)
        .map((s) => (
          <span
            key={`pulse-${s.id}`}
            className={cardStyles.pulseDot}
            style={
              {
                left: s.x1,
                top: s.y1,
                background: s.accent,
                zIndex: 1,
                "--cf-dx": `${s.x2 - s.x1}px`,
                "--cf-dy": `${s.y2 - s.y1}px`,
              } as React.CSSProperties
            }
          />
        ))}
    </>
  );
}
