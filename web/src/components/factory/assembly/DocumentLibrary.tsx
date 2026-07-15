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

export function DocumentLibrary({ documents }: { documents: DocumentVM[] }) {
  return (
    <div className="docgrid" style={{ marginTop: "0.5rem" }}>
      {documents.map((d) => {
        const pill = documentPill(d.status);
        return (
          <div className={`doccard${pill ? "" : " fa-doccard--dim"}`} key={d.key}>
            <span className="d-n">Document {d.num} of 9</span>
            <h3>{d.name}</h3>
            <div className="d-prev">
              {pill ? <span className={`tag ${PILL_TAG[pill.tone]}`}>{pill.label}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
