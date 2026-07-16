"use client";

// The nine Canonical Campaign Documents (step 10 footer) during a LIVE run.
// Statuses are folded from document.status events; the canonical status strings
// stay on the data. Pills speak the campaignGrade vocabulary (language.ts):
// "Complete" (green) for ready, "Nearly complete" (amber) for needs
// verification, and a contentless document simply DIMS — no pill, no "Waiting".
// Compiled document bodies are W6's surface — this is the library index only.

import type { DocumentVM } from "@/lib/factory/client";
import { documentPill } from "@/lib/factory/documents";

const PILL_TAG: Record<"complete" | "nearly", string> = { complete: "real", nearly: "mock" };

// Rotating pastel tints for the "Coming soon" (contentless) cards — the brief's
// blue / pink / yellow palette family, so placeholders read as design.
const SOON_TINTS = ["t-b", "t-p", "t-y"] as const;

export function DocumentLibrary({ documents }: { documents: DocumentVM[] }) {
  // deterministic tint per contentless doc (rotates across only the soon cards)
  const soonTint = new Map<string, string>();
  documents
    .filter((d) => documentPill(d.status) == null)
    .forEach((d, i) => soonTint.set(d.key, SOON_TINTS[i % SOON_TINTS.length]));
  return (
    <div className="docgrid" style={{ marginTop: "0.5rem" }}>
      {documents.map((d) => {
        const pill = documentPill(d.status);
        if (!pill) {
          return (
            <div className={`doccard fa-doccard--soon ${soonTint.get(d.key) ?? ""}`} key={d.key}>
              <span className="d-n">Document {d.num} of 9</span>
              <h3>{d.name}</h3>
              <div className="d-prev">
                <span className="fa-soon-pill">Coming soon</span>
              </div>
            </div>
          );
        }
        return (
          <div className="doccard" key={d.key}>
            <span className="d-n">Document {d.num} of 9</span>
            <h3>{d.name}</h3>
            <div className="d-prev">
              <span className={`tag ${PILL_TAG[pill.tone]}`}>{pill.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
