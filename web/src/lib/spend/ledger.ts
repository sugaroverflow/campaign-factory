import { dailyBudgetUSD } from "@/lib/config";

// ---------------------------------------------------------------------------
// DEV SPEND LEDGER — in-memory, keyed by UTC date. Shim, same caveat as the job
// store: not durable across cold starts / instances. Replaced in M4 by a
// Postgres-backed ledger so the kill-switch holds globally in production.
// ---------------------------------------------------------------------------

const daily = new Map<string, number>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addSpend(usd: number): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const d = today();
  daily.set(d, (daily.get(d) || 0) + usd);
}

export function spentTodayUSD(): number {
  return daily.get(today()) || 0;
}

export function overBudget(): boolean {
  return spentTodayUSD() >= dailyBudgetUSD();
}

export function budgetSnapshot() {
  const spent = spentTodayUSD();
  const cap = dailyBudgetUSD();
  return { spentUSD: round(spent), capUSD: round(cap), remainingUSD: round(Math.max(0, cap - spent)), over: spent >= cap };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
