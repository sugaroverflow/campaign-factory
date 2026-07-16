"use client";

// Rung 11 — "Every source used" (original-brief redesign, 15 Jul 2026). The
// full source register in the legacy Sources-step pattern: one card per source
// with organisation, link and dates — but every entry is a collapsed <details>
// dropdown, grouped by evidence tier (A official records → D campaign voices,
// plain-English titles from language.ts). Honest by construction: the register
// lists what the research actually fetched; during a live run it grows as the
// AssemblyClient refreshes it, and nothing is shown that wasn't retrieved.

import { SOURCE_TIER_COPY } from "@/lib/factory/documents";
import type { SourceTier } from "@/lib/factory/contracts";
import { formatRegisterDate, type SourceRegisterEntry } from "./briefData";
import { SOURCES_COPY } from "./stepCopy";

const TIERS: SourceTier[] = ["A", "B", "C", "D"];

// Named HTML entities seen in scraped page <title>s. Numeric entities (&#39;
// &#x27; …) are handled generically below.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„",
  copy: "©", reg: "®", trade: "™",
  pound: "£", euro: "€", deg: "°",
};

/** Decode HTML entities to plain text (single pass, no cascade). Source titles
 *  are stored already HTML-escaped, so React renders "&#x27;Youths…" literally;
 *  decoding here restores the real characters. The result is used only as a
 *  React text node — never as raw HTML — so it cannot inject markup. */
function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? m;
  });
}

// Fetch-failure boilerplate that scrapers capture as the page <title> — never a
// real source name. Matched case-insensitively against the decoded title.
const FAILURE_TITLE_PATTERNS: RegExp[] = [
  /^service unavailable/i,
  /^just a moment/i,
  /\b40[0-9]\b/,
  /\b50[0-9]\b/,
  /page (?:isn'?t|is not|does(?:n'?t| not)) (?:available|found|exist)/i,
  /page not found/i,
  /\bnot found\b/i,
  /access denied/i,
  /\bforbidden\b/i,
  /error \d+/i,
  /attention required/i,
  /are you (?:a )?(?:human|robot)/i,
  /verify(?:ing)? you are human/i,
  /please enable (?:javascript|cookies)/i,
  /rate limit/i,
  /too many requests/i,
  /request blocked/i,
];

function isFailureTitle(title: string): boolean {
  const t = title.trim();
  return t.length === 0 || FAILURE_TITLE_PATTERNS.some((re) => re.test(t));
}

function hostnameOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** The register display name: the decoded title when it's real, else the
 *  source's hostname (scraper-failure titles are boilerplate, not names). The
 *  real URL and tier are always shown regardless. */
function sourceDisplayName(s: SourceRegisterEntry): string {
  const title = s.title ? decodeEntities(s.title) : "";
  if (title && !isFailureTitle(title)) return title.trim();
  return hostnameOf(s.url) || (s.organisation ? decodeEntities(s.organisation).trim() : "") || "Source";
}

function SourceEntry({ s }: { s: SourceRegisterEntry }) {
  const published = formatRegisterDate(s.publishedAt);
  const accessed = formatRegisterDate(s.accessedAt);
  const displayName = sourceDisplayName(s);
  const org = s.organisation ? decodeEntities(s.organisation).trim() : "";
  return (
    <details className="fa-src" data-tier={s.tier}>
      <summary>
        <b>{displayName}</b>
        {org && org !== displayName ? <span className="fa-src__org">{org}</span> : null}
        <span className="fa-src__tier">Tier {s.tier}</span>
      </summary>
      <p className="src-meta">
        {s.url && s.url.startsWith("http") ? (
          <a href={s.url} target="_blank" rel="noopener noreferrer">
            {s.url}
          </a>
        ) : (
          s.url
        )}
        {published ? <> · published {published}</> : null}
        {accessed ? <> · accessed {accessed}</> : null}
        <> · {SOURCE_TIER_COPY[s.tier].title.toLowerCase()}</>
      </p>
    </details>
  );
}

export function SourcesSection({
  id,
  stageKey,
  n,
  sources,
  terminal,
  active = false,
  revealed = true,
}: {
  id: string;
  stageKey: string;
  n: number;
  sources: SourceRegisterEntry[];
  terminal: boolean;
  active?: boolean;
  revealed?: boolean;
}) {
  return (
    <section
      className={`rung cf-reveal${active ? " active" : ""}`}
      id={id}
      data-stage={stageKey}
      data-on={revealed ? "1" : "0"}
    >
      <div className="jcontainer rung-grid">
        <aside>
          <div className="n">{n}</div>
          <h2>{SOURCES_COPY.title}</h2>
          {SOURCES_COPY.limit ? <p className="limit">{SOURCES_COPY.limit}</p> : null}
        </aside>
        <div className="rc">
          {sources.length ? (
            <div data-anim="1">
              <p className="hint-sm">
                {`${sources.length} ${sources.length === 1 ? "source" : "sources"} checked & labelled${
                  terminal ? "" : " so far — the register grows as the research continues"
                }.`}
              </p>
              {TIERS.map((tier) => {
                const rows = sources.filter((s) => s.tier === tier);
                if (!rows.length) return null;
                const copy = SOURCE_TIER_COPY[tier];
                return (
                  <div key={tier}>
                    <h3>{copy.title}</h3>
                    <p className="hint-sm">{copy.caption}</p>
                    {rows.map((s) => (
                      <SourceEntry key={s.id} s={s} />
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="fa-skeleton__hint">
              {terminal
                ? "No sources were recorded for this campaign."
                : "Sources appear here as the research fetches them — the full register completes when the run finishes."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
