// Small pure formatters for the card overlay. Monospace-only fields
// (timestamps, verbs, elapsed clocks, source counts) flow through here.

// "14:03:22" — a monospace wall-clock stamp for a backscroll row.
export function clockStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// "MM:SS" elapsed between an ISO start and a `now` epoch-ms. Clamped at 0.
export function elapsedClock(sinceIso: string | undefined, now: number): string {
  if (!sinceIso) return "00:00";
  const start = new Date(sinceIso).getTime();
  if (Number.isNaN(start)) return "00:00";
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
