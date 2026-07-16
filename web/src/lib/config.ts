// Runtime configuration for the launch controls. All tunable via env so the
// numbers can change the week before the conference without a redeploy of logic.

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function intEnv(name: string, fallback: number): number {
  return Math.trunc(numEnv(name, fallback));
}
function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export const config = {
  // Conference access code. Empty string = gate disabled (local dev).
  accessCode: (process.env.CF_ACCESS_CODE || "").trim(),
  // Runs allowed per browser session (cookie — easy to reset by clearing cookies).
  // Conference day (16 Jul): effectively uncapped per person (user decision) —
  // queue fairness and the daily kill-switch are the operative controls.
  runCap: intEnv("CF_RUN_CAP", 200),
  // Runs allowed per client IP (harder backstop against abuse). Set to 1 for
  // "everyone gets one run". Cost is controlled here, not by degrading research.
  // venue NAT: hundreds of attendees share one egress IP — default high so the
  // whole room isn't locked out by one shared address (env var still overrides).
  ipRunCap: intEnv("CF_IP_RUN_CAP", 200),
  // Global daily spend ceiling (kill-switch), in GBP, converted to USD for the
  // ledger. Conference day (16 Jul): raised to ≈$600 USD at the configured FX
  // (user decision; was £150 ≈ $190).
  dailyBudgetGBP: numEnv("CF_DAILY_BUDGET_GBP", 472.44),
  fxGbpUsd: numEnv("CF_FX_GBP_USD", 1.27),
  // Sunset / maintenance switch — disables new runs, existing URLs stay readable.
  readonly: boolEnv("CF_READONLY", false),
  // Admin secret for the wall hide control. Empty = admin actions disabled.
  adminKey: (process.env.CF_ADMIN_KEY || "").trim(),
};

export function dailyBudgetUSD(): number {
  return config.dailyBudgetGBP * config.fxGbpUsd;
}
