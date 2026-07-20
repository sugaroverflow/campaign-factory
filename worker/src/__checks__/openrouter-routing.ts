// One-shot check: provider-aware client construction + model slug mapping.
// Run: FACTORY_MODEL_MODE=mock npx tsx src/__checks__/openrouter-routing.ts
import { wireModel, getClient } from "@web/lib/anthropic.js";

console.log("sonnet-5 → or:", wireModel("claude-sonnet-5", "openrouter"));
console.log("opus-4-8 → or:", wireModel("claude-opus-4-8", "openrouter"));
console.log("haiku-4-5 → or:", wireModel("claude-haiku-4-5", "openrouter"));
console.log("unknown-1-2 → or (fallback):", wireModel("claude-foo-1-2", "openrouter"));
console.log("sonnet-5 → anthropic (unchanged):", wireModel("claude-sonnet-5", "anthropic"));

const or = getClient("sk-or-v1-test", "openrouter");
console.log("openrouter client:", or.provider, "|", (or.sdk as unknown as { baseURL: string }).baseURL);
const ant = getClient("sk-ant-test");
console.log("anthropic client:", ant.provider, "|", (ant.sdk as unknown as { baseURL: string }).baseURL);
