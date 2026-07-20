// BYOK vocabulary — the ONE home for "what is a valid visitor key, which
// provider does it belong to, what does it cost, and is it usable right now".
// The intake form (client) and the run gate (server) both read from here so
// the two can never drift; worker-side sealing lives in worker/src/byok.ts.
// (Architecture review 2026-07-20, candidates S1/S2.)

import type { ModelProvider } from "./anthropic";

export type ByokProvider = ModelProvider;

const KEY_FORMATS: Record<ByokProvider, RegExp> = {
  anthropic: /^sk-ant-[A-Za-z0-9_-]{10,}$/,
  openrouter: /^sk-or-[A-Za-z0-9_-]{10,}$/,
};

/** sk-ant-… → Anthropic; sk-or-… → OpenRouter; anything else → null. */
export function detectProvider(key: string): ByokProvider | null {
  const k = key.trim();
  if (KEY_FORMATS.anthropic.test(k)) return "anthropic";
  if (KEY_FORMATS.openrouter.test(k)) return "openrouter";
  return null;
}

/** Client-side form gate — same source of truth as the server's detect. */
export function keyLooksValid(key: string): boolean {
  return detectProvider(key) !== null;
}

export const PROVIDER_META: Record<
  ByokProvider,
  { name: string; consoleUrl: string; consoleHint: string; consoleLabel: string }
> = {
  anthropic: {
    name: "Anthropic",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    consoleHint: "console.anthropic.com → API keys",
    consoleLabel: "console.anthropic.com",
  },
  openrouter: {
    name: "OpenRouter",
    consoleUrl: "https://openrouter.ai/settings/keys",
    consoleHint: "openrouter.ai/settings/keys",
    consoleLabel: "openrouter.ai",
  },
};

// Cost figures interpolated into BOTH the form helper and the gate error copy.
export const BYOK_TYPICAL_COST = "$1.50–$3";
export const BYOK_HARD_CAP = "$20";

export type ByokCheck = "ok" | "rejected" | "unverifiable" | "no_credits";

// Zero-cost key check against the key's own provider. Anthropic: /v1/models
// lists models without spending tokens. OpenRouter: /api/v1/key returns the
// key's metadata, then /api/v1/credits catches an authenticated-but-empty
// account ("no_credits") — otherwise the run starts and every agent fails
// fast on 402s. Only a definite 401/403 counts as "rejected"; network
// trouble or 5xx must not bounce a valid key, so it maps to "unverifiable".
export async function validateByokKey(key: string, provider: ByokProvider): Promise<ByokCheck> {
  const req: { url: string; headers: Record<string, string> } =
    provider === "openrouter"
      ? { url: "https://openrouter.ai/api/v1/key", headers: { authorization: `Bearer ${key}` } }
      : {
          url: "https://api.anthropic.com/v1/models?limit=1",
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        };
  try {
    const r = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(8000) });
    if (r.status === 401 || r.status === 403) return "rejected";
    if (!r.ok) return "unverifiable";
    if (provider === "openrouter") {
      // Balance check is advisory: a definite ≤0 balance rejects, anything
      // unreadable passes through (the executor fails fast on 402 anyway).
      try {
        const c = await fetch("https://openrouter.ai/api/v1/credits", {
          headers: req.headers,
          signal: AbortSignal.timeout(8000),
        });
        if (c.ok) {
          const j = (await c.json()) as { data?: { total_credits?: number; total_usage?: number } };
          const remaining = (j.data?.total_credits ?? NaN) - (j.data?.total_usage ?? NaN);
          if (Number.isFinite(remaining) && remaining <= 0) return "no_credits";
        }
      } catch {
        /* balance unknown — let the run proceed */
      }
    }
    return "ok";
  } catch {
    return "unverifiable";
  }
}

export type ByokResolution =
  | { ok: true; key: string; provider: ByokProvider }
  | { ok: true; key: null; provider: null } // admin caller on the house key
  | { ok: false; status: 400 | 502; body: { error: string; byokRequired?: true } };

/** The run gate's whole BYOK decision behind one call: required-key policy,
 * format/provider detection, live provider validation, and the user-facing
 * copy for every rejection. (Public runs ALWAYS run on the visitor's key —
 * user decision, 20 Jul 2026; admin callers may omit it.) */
export async function resolveByok(rawKey: unknown, isAdmin: boolean): Promise<ByokResolution> {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!key) {
    if (isAdmin) return { ok: true, key: null, provider: null };
    return {
      ok: false,
      status: 400,
      body: {
        byokRequired: true,
        error: `An Anthropic or OpenRouter API key is required — your campaign's agents run on your key, so its cost (typically ${BYOK_TYPICAL_COST}, hard-capped at ${BYOK_HARD_CAP}) goes to your account.`,
      },
    };
  }
  const provider = detectProvider(key);
  if (!provider) {
    return {
      ok: false,
      status: 400,
      body: {
        error:
          "That doesn't look like an Anthropic or OpenRouter API key — they start with sk-ant- or sk-or-. Check for missing characters.",
      },
    };
  }
  const meta = PROVIDER_META[provider];
  const check = await validateByokKey(key, provider);
  if (check === "ok") return { ok: true, key, provider };
  const error =
    check === "rejected"
      ? `${meta.name} rejected that API key. Check it in ${meta.consoleHint} and try again.`
      : check === "no_credits"
        ? "That OpenRouter key works, but the account has no remaining credits — top up at openrouter.ai/settings/credits and try again."
        : `We couldn't verify your API key with ${meta.name} just now — please try again in a moment.`;
  return { ok: false, status: check === "unverifiable" ? 502 : 400, body: { error } };
}
