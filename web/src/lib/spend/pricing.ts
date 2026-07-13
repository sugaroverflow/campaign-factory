// Cost model for the spend ledger / kill-switch. This is a safety ceiling, not
// billing-grade accounting — approximations are fine, but we should not
// materially *under*-count.

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export type UsageSink = (model: string, usage: Usage) => void;

// USD per 1M tokens. Sonnet 5 reflects the intro pricing ($2/$10) in effect
// through 2026-08-31; standard is $3/$15 afterwards.
interface Price {
  in: number;
  out: number;
}
const PRICING: Record<string, Price> = {
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

// Approximate web-search server-tool cost per research call (~4 searches).
export const WEB_SEARCH_COST_USD = 0.04;

export function costUSD(model: string, u: Usage): number {
  const p = PRICING[model];
  if (!p) return 0;
  const freshInput = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const cachedInput = u.cache_read_input_tokens || 0;
  const inputCost = (freshInput / 1e6) * p.in + (cachedInput / 1e6) * p.in * 0.1;
  const outputCost = ((u.output_tokens || 0) / 1e6) * p.out;
  return inputCost + outputCost;
}
