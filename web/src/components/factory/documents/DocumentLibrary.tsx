"use client";

// The nine-document library (ADR 0007). Renders the canonical nine-document grid
// with REAL per-document status chips (canonical statuses translated to plain
// English at display only — language.ts), a ready-count derived from those real
// statuses, and a per-document view with Copy, view HTML, and a Word .doc
// download. Export is DISABLED until the relevant reviewer pass completes:
//  - "ready"              → export enabled;
//  - "needs verification" → export enabled only after explicit confirmation;
//  - "assembling"/"under review" → export disabled.
//
// Resource fragments render INSIDE their pack's view (the compiler folds them
// into the pack html), never as separate documents. This is presentational —
// the compiled documents come from W6's pure compileDocuments(state, claims).

import { useState } from "react";
import type { CompiledDocument } from "@/lib/factory/documents";
import { isExportable, plainDocStatus, plainFlag } from "@/lib/factory/documents";
import type { DocumentStatus } from "@/lib/factory/contracts";
import { downloadDocHtml, copyText } from "./wordExport";
import "./documents.css";

const STATUS_CHIP: Record<DocumentStatus, string> = {
  assembling: "gen",
  "under review": "mock",
  ready: "real",
  "needs verification": "verify",
};

function StatusChip({ status }: { status: DocumentStatus }) {
  return (
    <span className={`tag ${STATUS_CHIP[status]}`} title={status}>
      {plainDocStatus(status)}
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
        {documents.map((d) => (
          <button
            key={d.key}
            type="button"
            className={`doccard fa-doccard${openKey === d.key ? " fa-doccard--open" : ""}`}
            onClick={() => setOpenKey(openKey === d.key ? null : d.key)}
            aria-expanded={openKey === d.key}
          >
            <span className="d-n">
              Document {d.num} of {documents.length}
              {d.isPack ? " · pack" : ""}
            </span>
            <h3>{d.name}</h3>
            <div className="d-prev">
              <StatusChip status={d.status} />
              {d.isPack && d.resourceCount ? (
                <span className="fa-mono" style={{ marginLeft: ".5rem" }}>
                  {d.resourceCount} resource{d.resourceCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          </button>
        ))}
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
          <StatusChip status={doc.status} />
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

      {doc.flags.length ? (
        <div className="fa-docview__flags">
          <p className="fa-doc-note" style={{ marginBottom: ".4rem" }}>
            Worth checking before you use this document:
          </p>
          <ul className="fa-gaplist">
            {doc.flags.map((f, i) => (
              <li key={i}>{plainFlag(f)}</li>
            ))}
          </ul>
        </div>
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
    </section>
  );
}
