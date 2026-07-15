"use client";

// Published brief pieces — the campaign's OUTPUT assembling in real time.
// One persistent paper-styled card per accepted/applied section (fold
// PublishedCardVM). These are artefacts, not agents: light document surfaces
// that form the SUBSTRATE the translucent agent workspaces sit over, so the
// audience watches the brief physically stack up beneath the swarm.
// Every card renders fully expanded — title plus the whole excerpt — and never
// collapses or disappears; end state is receipt + this stack + the open cards.

import { hueByIndex } from "@/components/factory/cards";
import type { CampaignHueIndex } from "@/components/factory/cards";
import type { PublishedCardVM } from "@/lib/factory/client/fold";
import { JOURNEY_STEPS } from "@/lib/factory/contracts";
import styles from "./gallery.module.css";

export function PublishedBriefStack({
  cards,
  hue,
}: {
  cards: PublishedCardVM[];
  hue: CampaignHueIndex;
}) {
  const h = hueByIndex(hue);
  if (cards.length === 0) return null;

  return (
    <div className={styles.briefStack} aria-label="Published brief sections">
      <div className={styles.briefStackHead}>
        <span className={styles.briefStackTitle}>Campaign brief</span>
        <span className={styles.briefStackCount}>
          {cards.length}/{JOURNEY_STEPS.length} published
        </span>
      </div>
      {cards.map((c) => (
        <div
          key={c.key}
          className={styles.briefCard}
          style={{ borderLeft: `3px solid ${h.edgeGlowless}` }}
        >
          <div className={styles.briefCardHead}>
            <span className={styles.briefCardStep}>§{c.step}</span>
            <span className={styles.briefCardTitle}>{c.title}</span>
          </div>
          {c.excerpt ? <p className={styles.briefCardExcerpt}>{c.excerpt}</p> : null}
        </div>
      ))}
    </div>
  );
}
