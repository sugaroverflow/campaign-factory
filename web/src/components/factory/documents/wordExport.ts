// Client-side export helpers for the Document Library. Reimplements the
// Word-openable ".doc" (Word HTML) blob approach from Journey.tsx here (per W6's
// brief: do not edit Journey.tsx). The compiler already produced semantic html
// (h2–h4, p, ul/ol, tables) which Word and Google Docs open cleanly, so we wrap
// the doc body rather than re-flowing plain-text paragraphs.

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slug(title: string): string {
  return title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "document";
}

/** Download `bodyHtml` as an editable Word (.doc) document titled `title`. */
export function downloadDocHtml(title: string, bodyHtml: string): void {
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><title>${escapeAttr(title)}</title>` +
    `<style>` +
    `body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45;color:#1b1d1e;}` +
    `h1{font-size:18pt;margin:0 0 12pt;}h2{font-size:14pt;margin:16pt 0 6pt;}` +
    `h3{font-size:12pt;margin:12pt 0 4pt;}h4{font-size:11pt;margin:10pt 0 3pt;}` +
    `p{margin:0 0 8pt;}ul,ol{margin:0 0 8pt 18pt;}li{margin:0 0 3pt;}` +
    `table{border-collapse:collapse;width:100%;margin:0 0 8pt;}` +
    `td{border-bottom:1px solid #ddd;padding:3pt 6pt 3pt 0;vertical-align:top;}` +
    `blockquote{margin:0 0 8pt;padding:6pt 10pt;background:#f5f5f5;border-left:3pt solid #1b1d1e;}` +
    `.tag{font-size:8pt;font-weight:bold;text-transform:uppercase;color:#4928fd;}` +
    `mark{background:#fdf1d3;}` +
    `.fa-doc-note{color:#a86a00;font-style:italic;}` +
    // "sources disagree" question-mark after a conflicting fact
    `a.pm-inf{text-decoration:none;font-weight:bold;font-size:8pt;color:#1b1d1e;background:#fdf1d3;` +
    `border:1px solid #e8d59a;border-radius:8pt;padding:0 3pt;}` +
    // Evidence & Next Checks groups: <details>/<summary> degrade to visible
    // blocks in Word — nothing is hidden in the export.
    `details{margin:0 0 8pt;}summary{font-weight:bold;margin:0 0 4pt;}` +
    `.fa-evgroup{border:1px solid #ddd;border-radius:6pt;padding:6pt 8pt;}` +
    `.fa-evgroup__cap{color:#6b6f72;font-size:9pt;margin:0 0 6pt;}` +
    `.fa-evclaim{margin:0 0 6pt;}` +
    `.fa-evclaim__meta{color:#494d50;font-size:9pt;margin:2pt 0 6pt 18pt;}` +
    // footer disclaimer — mirrors the app footer (top rule, muted small text)
    `footer.fa-doc-footer{border-top:1pt solid #ddd;margin-top:18pt;padding-top:8pt;` +
    `color:#6b6f72;font-size:9pt;}` +
    `</style></head>` +
    `<body><h1>${escapeAttr(title)}</h1>${bodyHtml}</body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug(title)}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Copy text to the clipboard (best-effort; silent on failure). */
export function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => {});
}
