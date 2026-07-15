import postgres from "postgres";
import { sql, migrate } from "./client";
import { dailyBudgetUSD } from "@/lib/config";

// Durable daily spend ledger (replaces the in-memory shim). Keyed by UTC date.
export async function addSpend(usd: number): Promise<void> {
  if (!Number.isFinite(usd) || usd <= 0) return;
  await migrate();
  await sql`
    insert into spend_ledger (day, usd) values (current_date, ${usd})
    on conflict (day) do update set usd = spend_ledger.usd + excluded.usd
  `;
}

// Factory spend lands in factory.cost_ledger (written by the worker), which on
// preview deployments lives on a separate branch via FACTORY_DATABASE_URL.
// Reuse the legacy client when the URLs coincide; otherwise a pooled singleton.
let factoryLedgerSql: ReturnType<typeof postgres> | null = null;
function factorySql(): ReturnType<typeof postgres> {
  const url = (process.env.FACTORY_DATABASE_URL || "").trim();
  if (!url || url === process.env.DATABASE_URL) return sql;
  if (factoryLedgerSql) return factoryLedgerSql;
  const needsSsl = /neon\.tech|sslmode=require/.test(url) || process.env.PGSSL === "require";
  factoryLedgerSql = postgres(url, { ssl: needsSsl ? "require" : false, max: 5, idle_timeout: 20 });
  return factoryLedgerSql;
}

async function factorySpentTodayUSD(): Promise<number> {
  try {
    const rows = await factorySql()`
      select coalesce(sum(cost_usd), 0) as usd
      from factory.cost_ledger
      where at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    `;
    return rows[0] ? Number(rows[0].usd) : 0;
  } catch (err) {
    // 3F000 / 42P01: factory schema/table not migrated yet on this branch — no
    // factory spend exists there. Anything else is a real failure: rethrow.
    const code = (err as { code?: string }).code;
    if (code === "3F000" || code === "42P01") return 0;
    throw err;
  }
}

// Sums BOTH ledgers for the current UTC day: the legacy spend_ledger (journey
// runs) and factory.cost_ledger (all factory spend, written by the worker).
// overBudget() therefore bounds factory spend under the same daily cap.
export async function spentTodayUSD(): Promise<number> {
  await migrate();
  const [legacyRows, factoryUSD] = await Promise.all([
    sql`select usd from spend_ledger where day = current_date`,
    factorySpentTodayUSD(),
  ]);
  const legacyUSD = legacyRows[0] ? Number(legacyRows[0].usd) : 0;
  return legacyUSD + factoryUSD;
}

export async function overBudget(): Promise<boolean> {
  return (await spentTodayUSD()) >= dailyBudgetUSD();
}

export async function budgetSnapshot() {
  const spent = await spentTodayUSD();
  const cap = dailyBudgetUSD();
  const round = (n: number) => Math.round(n * 100) / 100;
  return { spentUSD: round(spent), capUSD: round(cap), remainingUSD: round(Math.max(0, cap - spent)), over: spent >= cap };
}
