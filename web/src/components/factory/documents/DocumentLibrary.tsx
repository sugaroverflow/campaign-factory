"use client";

// The nine-document library (ADR 0007). Renders the canonical nine-document
// grid with pills in the campaignGrade vocabulary (language.ts documentPill):
// "Complete" (green) for ready, "Nearly complete" (amber) for needs
// verification or flagged, and contentless documents DIMMED with no pill.
// Each document opens into a view with Copy, view HTML, and a Word .doc
// download (the original design's separate-download affordance). Export is
// DISABLED until the relevant reviewer pass completes:
//  - "ready"              → export enabled;
//  - "needs verification" → export enabled only after explicit confirmation;
//  - "assembling"/"under review" → export disabled.
// The document's "worth checking" flags render as a Fact checks block at the
// END of the document (14 Jul 2026 redesign) — calm, no red.
//
// Resource fragments render INSIDE their pack's view (the compiler folds them
// into the pack html), never as separate documents. This is presentational —
// the compiled documents come from W6's pure compileDocuments(state, claims).

import { useState } from "react";
import type { CompiledDocument } from "@/lib/factory/documents";
import { FACT_CHECKS_TITLE, documentPill, isExportable, plainDocStatus, plainFlag } from "@/lib/factory/documents";
import type { DocumentStatus } from "@/lib/factory/contracts";
import { downloadDocHtml, copyText } from "./wordExport";
import "./documents.css";

const PILL_TAG: Record<"complete" | "nearly", string> = { complete: "real", nearly: "mock" };

function Pill({ status, flagged }: { status: DocumentStatus; flagged: boolean }) {
  const pill = documentPill(status, flagged);
  if (!pill) return null;
  return (
    <span className={`tag ${PILL_TAG[pill.tone]}`} title={status}>
      {pill.label}
    </span>
  );
}

export function DocumentLibrary({
  documents,
  title = "Campaign documents",
  intro,
}: {
  documents: CompiledDocument[];
  title?: string;
  intro?: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const readyCount = documents.filter((d) => d.status === "ready").length;
  const open = documents.find((d) => d.key === openKey) || null;

  return (
    <div className="fa-doclib">
      <div className="fa-doclib__head">
        <h3>{title}</h3>
        <span className="fa-doclib__count">
          <b>{readyCount}</b> of {documents.length} ready to use
        </span>
      </div>
      {intro ? <p className="hint-sm">{intro}</p> : null}

      <div className="docgrid" style={{ marginTop: "0.75rem" }}>
        {documents.map((d) => {
          const dim = documentPill(d.status, d.flags.length > 0) == null;
          return (
            <button
              key={d.key}
              type="button"
              className={`doccard fa-doccard${openKey === d.key ? " fa-doccard--open" : ""}${dim ? " fa-doccard--dim" : ""}`}
              onClick={() => setOpenKey(openKey === d.key ? null : d.key)}
              aria-expanded={openKey === d.key}
            >
              <span className="d-n">
                Document {d.num} of {documents.length}
                {d.isPack ? " · pack" : ""}
              </span>
              <h3>{d.name}</h3>
              <div className="d-prev">
                <Pill status={d.status} flagged={d.flags.length > 0} />
                {d.isPack && d.resourceCount ? (
                  <span className="fa-mono" style={{ marginLeft: ".5rem" }}>
                    {d.resourceCount} resource{d.resourceCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {open ? <DocumentView doc={open} onClose={() => setOpenKey(null)} /> : null}
    </div>
  );
}

function DocumentView({ doc, onClose }: { doc: CompiledDocument; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const exportable = isExportable(doc.status);
  const needsConfirm = doc.status === "needs verification";
  const canExport = doc.status === "ready" || (needsConfirm && confirmed);

  return (
    <section className="fa-docview" aria-label={`${doc.name} document`}>
      <div className="fa-docview__bar">
        <div>
          <span className="d-n">
            Document {doc.num}
            {doc.isPack ? " · pack" : ""}
          </span>
          <h3>{doc.name}</h3>
        </div>
        <div className="fa-docview__meta">
          <Pill status={doc.status} flagged={doc.flags.length > 0} />
          <button type="button" className="toolbtn" onClick={onClose}>
            ✕ Close
          </button>
        </div>
      </div>

      {!exportable ? (
        <p className="fa-doc-note">
          You can copy or download this document once it&apos;s finished — right now it&apos;s{" "}
          <b>{plainDocStatus(doc.status).toLowerCase()}</b>.
        </p>
      ) : null}

      {needsConfirm ? (
        <label className="fa-docview__confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I
          understand some things here still need checking, and I&apos;ll check them before using this.
        </label>
      ) : null}

      <div className="dd-actions" style={{ margin: ".6rem 0 1rem" }}>
        <button
          type="button"
          className="toolbtn"
          disabled={!canExport}
          onClick={() => copyText(doc.plainText)}
          title={canExport ? "Copy plain text" : "Available once ready"}
        >
          ⧉ Copy text
        </button>
        <button
          type="button"
          className="toolbtn"
          disabled={!canExport}
          onClick={() => copyText(doc.html)}
          title={canExport ? "Copy HTML" : "Available once ready"}
        >
          ⧉ Copy HTML
        </button>
        <button
          type="button"
          className="toolbtn"
          disabled={!canExport}
          onClick={() => downloadDocHtml(doc.name, doc.html)}
          title={canExport ? "Download Word .doc" : "Available once ready"}
        >
          ↓ Word
        </button>
      </div>

      <article className="rc fa-content fa-docview__body" dangerouslySetInnerHTML={{ __html: doc.html }} />

      {/* Fact checks live at the END of every compiled document (graft 3). The
          brief bakes its own into the compiled html; the per-document flags
          render here in the same calm style. */}
      {doc.flags.length ? (
        <div className="fa-docview__facts">
          <h4>{FACT_CHECKS_TITLE}</h4>
          <p className="fa-evgroup__cap">Worth checking before you use this document</p>
          <ul className="fa-factlist">
            {doc.flags.map((f, i) => (
              <li key={i}>{plainFlag(f)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
