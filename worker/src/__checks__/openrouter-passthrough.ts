// SPIKE (PR #13): does OpenRouter's Anthropic-compatible endpoint pass through
// the pieces the factory pipeline depends on? Exercises the REAL client path
// (getClient + call: streaming, cache annotation, server-tool notes) with the
// exact web_search tool shape gateway.ts declares.
// Run: npx tsx src/__checks__/openrouter-passthrough.ts
// Reads OPENROUTER_API_KEY from ../web/.env.local — the key is never printed.
import { readFileSync } from "node:fs";
import { getClient, call } from "@web/lib/anthropic.js";

const env = readFileSync(new URL("../../../app/.env", import.meta.url), "utf8");
const key = (env.match(/^OPEN_ROUTER_API_KEY="?([^"\n]*)"?$/m) || [])[1];
if (!key || !key.startsWith("sk-or-")) {
  console.error("no OPEN_ROUTER_API_KEY in app/.env");
  process.exit(1);
}

const client = getClient(key, "openrouter");

// Pad the system prompt past Sonnet 5's minimum cacheable prefix (~2048 tokens)
// so the second call can prove cache reads work through OpenRouter.
const PAD = "The Campaign Factory researches UK local civic problems. ".repeat(220);
const SYSTEM = `${PAD}\nYou are a research probe. Use web_search before answering. Keep the final answer to two sentences and include one source URL.`;

const params = {
  model: "claude-sonnet-5",
  max_tokens: 2000,
  system: SYSTEM,
  messages: [
    {
      role: "user" as const,
      content: "Who is the current UK Secretary of State for Transport? Search the web to confirm before answering.",
    },
  ],
  tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
  effort: "medium" as const,
  adaptiveThinking: true,
};

let searches = 0;
let reads = 0;
const notes: string[] = [];
const opts = {
  onToolNote: (note: string, verb?: string) => {
    if (verb === "searching") searches++;
    if (verb === "reading") reads++;
    notes.push(`[${verb}] ${note}`);
  },
};

function report(label: string, msg: Awaited<ReturnType<typeof call>>) {
  const types: Record<string, number> = {};
  for (const b of msg.content) types[b.type] = (types[b.type] ?? 0) + 1;
  const text = msg.content
    .filter((b): b is Extract<(typeof msg.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .slice(0, 220);
  console.log(`--- ${label} ---`);
  console.log("wire model:", msg.model, "| stop:", msg.stop_reason);
  console.log("blocks:", JSON.stringify(types));
  console.log("usage:", JSON.stringify(msg.usage));
  console.log("answer:", text.replace(/\s+/g, " "));
}

const msg1 = await call(client, params, opts);
report("call 1 (search + effort)", msg1);
console.log("search notes seen by worker:", searches, "searching /", reads, "reading");
for (const n of notes.slice(0, 4)) console.log(" ", n.slice(0, 110));

const msg2 = await call(client, params, {});
report("call 2 (cache check, identical prefix)", msg2);
const cacheRead = (msg2.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
console.log("VERDICT: web_search passthrough:", searches > 0 ? "YES" : "NO",
  "| effort accepted:", "YES (no 400)",
  "| cache read on call 2:", cacheRead > 0 ? `YES (${cacheRead} tokens)` : "NO");
