"use client";

// The nine Canonical Campaign Documents (step 10 footer). Statuses are folded
// from document.status events; the exact product status strings (assembling /
// under review / ready / needs verification) render verbatim. Compiled document
// bodies are W6's surface — this is the library index and status only.

import type { DocumentVM } from "@/lib/factory/client";
import type { DocumentStatus } from "@/lib/factory/contracts";

const STATUS_CHIP: Record<DocumentStatus, string> = {
  assembling: "gen",
  "under review": "mock",
  ready: "real",
  "needs verification": "verify",
};

export function DocumentLibrary({ documents }: { documents: DocumentVM[] }) {
  return (
    <div className="docgrid" style={{ marginTop: "0.5rem" }}>
      {documents.map((d) => (
        <div className="doccard" key={d.key}>
          <span className="d-n">Document {d.num} of 9</span>
          <h3>{d.name}</h3>
          <div className="d-prev">
            {d.status ? (
              <span className={`tag ${STATUS_CHIP[d.status] ?? "gen"}`}>{d.status}</span>
            ) : (
              <span className="fa-mono">not started</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
