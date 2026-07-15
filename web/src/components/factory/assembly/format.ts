// Light-page presentational helpers for the Assembly View (receipts, mobile).
// Agent cards use W5's own formatters (clockStamp/elapsedClock). Timestamps and
// elapsed values render in the compact monospace column only (parameters §6).

/** HH:MM:SS for an event timestamp. */
export function fmtClock(iso?: string): string {
  if (!iso) return "--:--:--";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "--:--:--";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** MM:SS (or H:MM:SS past an hour) for an elapsed duration in ms. */
export function fmtElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** A short uppercase token for the campaign identity pill on the cards. */
export function campaignShortName(place?: string, problem?: string): string {
  const src = (place || problem || "").trim();
  if (!src) return "CAMPAIGN";
  const word = src.split(/[\s,]+/)[0].replace(/[^A-Za-z0-9]/g, "");
  return (word || "CAMPAIGN").slice(0, 10).toUpperCase();
}
