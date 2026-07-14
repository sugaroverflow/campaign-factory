"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type VerificationLabel } from "@/lib/pipeline/labels";
import { type Campaign, type PlanStakeholder } from "@/lib/pipeline/types";

/* label → provenance tag class (matches the prototype) */
const TAG_CLS: Record<string, string> = {
  "Verified public information": "real",
  "Supported inference": "gen",
  "Generated campaign recommendation": "gen",
  "Campaign assumption": "mock",
  "Conflicting evidence": "verify",
  "Verification incomplete": "verify",
  "External information unavailable": "ext",
};

function Tag({ label }: { label: string }) {
  if (!label) return null;
  return <span className={`tag ${TAG_CLS[label] || "gen"}`}>{label}</span>;
}

/* highlight every [ … ] placeholder (VERIFY items and fill-in blanks alike) so
   nothing unresolved slips through unmarked */
function withVerify(text: string): ReactNode {
  if (!text) return null;
  return text.split(/(\[[^\]\n]+\])/g).map((p, i) =>
    /^\[[^\]\n]+\]$/.test(p)
      ? <mark key={i} className={/^\[verify\b/i.test(p) ? "ph-verify" : undefined}>{p}</mark>
      : <span key={i}>{p}</span>,
  );
}

const List = ({ items, max }: { items?: string[]; max?: number }) => (
  <ul>{(items || []).slice(0, max ?? 99).map((x, i) => <li key={i}>{x}</li>)}</ul>
);

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Download as a Word-openable document (.doc / Word HTML) — opens editable in
// Word and Google Docs, no dependency. Blank lines become paragraph breaks.
function downloadDoc(title: string, text: string) {
  const body = text
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45;}h1{font-size:15pt;margin:0 0 12pt;}p{margin:0 0 10pt;}</style></head>` +
    `<body><h1>${esc(title)}</h1>${body}</body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

function DraftBlock({ title, body, tag }: { title: string; body?: string; tag?: string }) {
  if (!body || !body.trim()) return null;
  return (
    <div className="draftblock" data-anim="2">
      <div className="db-head">
        <b>
          {title} {tag ? <span className="tag verify">{tag}</span> : null}
        </b>
        <span className="dd-actions">
          <button className="toolbtn" onClick={() => copyText(body)} title="Copy">⧉ Copy</button>
          <button className="toolbtn" onClick={() => downloadDoc(title, body)} title="Download">↓</button>
        </span>
      </div>
      <div className="db-body">
        <p>{withVerify(body)}</p>
      </div>
    </div>
  );
}

/* one rung of the campaign ladder: sticky numbered aside + right content column
   (the option-1-scout.html / awake layout). Reveal + scrollspy are driven by the
   parent observer via data-stage / data-on / the .active class. */
function Stage({
  id,
  n,
  title,
  sub,
  agent,
  limit,
  revealed,
  active,
  children,
}: {
  id: string;
  n: number;
  title: ReactNode;
  sub?: ReactNode;
  agent?: string;
  limit?: ReactNode;
  revealed: Set<string>;
  active: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rung cf-reveal${active === id ? " active" : ""}`}
      id={`j-${id}`}
      data-stage={id}
      data-on={revealed.has(id) ? "1" : "0"}
    >
      <div className="jcontainer rung-grid">
        <aside>
          <div className="n">{n}</div>
          <h2>{title}</h2>
          {sub ? <p className="whatsnew">{sub}</p> : null}
          {agent ? <span className="agents-chip">🤖 {agent}</span> : null}
          {limit ? <p className="limit">{limit}</p> : null}
        </aside>
        <div className="rc">{children}</div>
      </div>
    </section>
  );
}

export function Journey({ campaign, onReset }: { campaign: Campaign; onReset?: () => void }) {
  const c = campaign;
  const r = c.research;
  const p = c.plan;
  const d = c.drafts;
  const f = p?.objective;

  const [active, setActive] = useState<string>("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [stake, setStake] = useState<PlanStakeholder | null>(null);
  const [srcFilter, setSrcFilter] = useState<VerificationLabel | "all">("all");
  const wrapRef = useRef<HTMLDivElement>(null);

  // scroll-reveal + scrollspy in one observer
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-stage]"));
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(new Set(sections.map((s) => s.dataset.stage!)));
    }
    const io = new IntersectionObserver(
      (entries) => {
        setRevealed((prev) => {
          const next = new Set(prev);
          for (const e of entries) if (e.isIntersecting) next.add((e.target as HTMLElement).dataset.stage!);
          return next;
        });
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive((vis[0].target as HTMLElement).dataset.stage!);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: 0.01 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  const docs = useMemo(() => {
    const out: { title: string; text: string }[] = [];
    const push = (title: string, text?: string) => text && text.trim() && out.push({ title, text });
    if (d?.lobbying) {
      push("Decision-maker meeting email", d.lobbying.meetingEmail);
      push("Meeting agenda", d.lobbying.agenda);
      push("Decision-maker briefing", d.lobbying.briefing);
    }
    if (d?.media) {
      push("Press release", d.media.pressRelease);
      push("Media pitch email", d.media.pitchEmail);
    }
    if (d?.digital) {
      push("Supporter email", d.digital.supporterEmail);
      push("Action / petition page", d.digital.actionPageCopy);
      if (d.digital.socialPosts?.length)
        push("Social posts", d.digital.socialPosts.map((s) => `[${s.platform}]\n${s.text}`).join("\n\n"));
      if (d.digital.faq?.length) push("FAQ", d.digital.faq.map((q) => `Q: ${q.q}\nA: ${q.a}`).join("\n\n"));
    }
    return out;
  }, [d]);

  const nav: [string, string][] = [
    ["problem", "Problem"],
    r && ["research", "Research"],
    f && ["objective", "Objective"],
    (r?.decisionMaker || f) && ["decision", "Decision"],
    p?.stakeholders?.length && ["power", "Power"],
    p?.pressures?.length && ["pressure", "Pressure"],
    p?.strategy && ["strategy", "Strategy"],
    p?.tactics?.length && ["tactics", "Tactics"],
    p?.organising && ["organising", "Organising"],
    (d?.lobbying || d?.media || d?.digital) && ["drafts", "Drafts"],
    docs.length && ["documents", "Documents"],
    c.sources?.length && ["sources", "Sources"],
  ].filter(Boolean) as [string, string][];
  const num = (id: string) => nav.findIndex(([x]) => x === id) + 1;

  const tiers: [PlanStakeholder["tier"], string][] = [
    ["decides", "Decides"],
    ["influences", "Influences"],
    ["mobilises", "Mobilises"],
    ["resists", "May resist"],
    ["neutral", "Neutral"],
  ];
  const tierCls: Record<string, string> = { decides: "dm", mobilises: "ally", resists: "opp", neutral: "neut" };

  const present = useMemo(() => {
    const set = new Set((c.sources || []).map((s) => s.status));
    return (Object.keys(TAG_CLS) as VerificationLabel[]).filter((l) => set.has(l));
  }, [c.sources]);
  const shownSources = srcFilter === "all" ? c.sources : (c.sources || []).filter((s) => s.status === srcFilter);

  return (
    <div className="pb-24" ref={wrapRef}>
      {/* fixed number rail (scrollspy) */}
      <nav className="rail">
        {nav.map(([id, label], i) => (
          <a key={id} href={`#j-${id}`} className={active === id ? "cur" : ""} title={label}>
            {i + 1}
          </a>
        ))}
      </nav>

      {/* hero */}
      <header className="jhero">
        <div className="eyebrow">
          Live campaign · researched and generated just now · every output requires human review
        </div>
        <h1>{c.name}</h1>
        {c.refinedProblem ? (
          <p className="obj">{c.refinedProblem}</p>
        ) : f ? (
          <p className="obj">
            We want <b>{f.dm}</b> to <b>{f.action}</b> by <b>{f.by}</b>, even if the immediate outcome is only{" "}
            <b>{f.mvw}</b>.
          </p>
        ) : null}
        {onReset ? (
          <p style={{ marginTop: "1.1rem" }}>
            <button className="toolbtn" onClick={onReset}>+ New campaign</button>
          </p>
        ) : null}
        {!(c.completed.research && c.completed.plan && c.completed.drafts) ? (
          <div className="jbanner" style={{ maxWidth: "72ch" }}>
            This campaign is incomplete — some stages didn&apos;t finish. What&apos;s shown is real; nothing was
            invented to fill the gaps.
          </div>
        ) : null}
      </header>

      {/* at-a-glance pastel stat tiles (honest counts from the finished plan) */}
      {(() => {
        const tiles: { cls: string; big: number; s: string }[] = [];
        if (c.sources?.length)
          tiles.push({ cls: "b", big: c.sources.length, s: c.sources.length === 1 ? "source checked & labelled" : "sources checked & labelled" });
        if (p?.stakeholders?.length) tiles.push({ cls: "p", big: p.stakeholders.length, s: "people & institutions mapped" });
        if (p?.tactics?.length) tiles.push({ cls: "y", big: p.tactics.length, s: "sequenced tactics" });
        return tiles.length >= 3 ? (
          <div className="jcontainer">
            <div className="tiles3">
              {tiles.slice(0, 3).map((t, i) => (
                <div key={i} className={`ptile ${t.cls}`}>
                  <div className="big">{t.big}</div>
                  <div className="s">{t.s}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* 1 — problem */}
      <Stage
        id="problem"
        n={num("problem")}
        title={<>The original <span className="serif">problem</span></>}
        agent="intake"
        sub="The starting statement is treated as a hypothesis, not a brief — research tests it."
        limit="Research is not a campaign — everything here serves a decision, not a report."
        revealed={revealed}
        active={active}
      >
        <blockquote className="userquote" data-anim="1">{c.input.problem}</blockquote>
        <div className="kvrow" data-anim="2">
          {([["Organisation", c.input.org], ["Location", c.input.location], ["Desired outcome", c.input.outcome], ["Known decision-maker", c.input.dm], ["Timeframe", c.input.timeframe], ["People affected", c.input.affected], ["Evidence", c.input.evidence], ["Resources", c.input.resources]] as [string, string | undefined][])
            .filter((x) => x[1])
            .map(([k, v]) => <span key={k} className="kv"><b>{k}:</b> {v}</span>)}
        </div>
        {c.interpretation ? (
          <div data-anim="2">
            <h3>How the system read it <Tag label="Generated campaign recommendation" /></h3>
            <p className="callout warm">{c.interpretation}</p>
          </div>
        ) : null}
        {r && (r.missingInfo?.length || r.researchQuestions?.length) ? (
          <div className="cols2" data-anim="3">
            <div>
              <h3>Identified as missing</h3>
              <List items={r.missingInfo} max={6} />
            </div>
            <div>
              <h3>Questions the research had to answer</h3>
              <List items={r.researchQuestions} max={6} />
            </div>
          </div>
        ) : null}
      </Stage>

      {/* 2 — research */}
      {r ? (
        <Stage
          id="research"
          n={num("research")}
          title={<>Researched <span className="serif">context</span></>}
          agent="scout · verifier"
          sub="Live web research against authoritative UK sources. Every claim is labelled and linked in Sources."
          limit="Only what could be verified is labelled 'verified'; unverified facts are flagged, never invented."
          revealed={revealed}
          active={active}
        >
          {r.context ? (
            <div className="cols2" data-anim="1">
              <div>
                <h3>The situation <Tag label="Verified public information" /></h3>
                <p>{r.context.situation}</p>
                {r.context.currentPolicy ? (<><h3>Current policy / restriction</h3><p>{r.context.currentPolicy}</p></>) : null}
                {r.context.howItChanged ? (<><h3>How research changed the request</h3><p className="callout">{r.context.howItChanged}</p></>) : null}
              </div>
              <div>
                {r.context.keyDates?.length ? (<><h3>Key dates &amp; processes</h3><List items={r.context.keyDates} /></>) : null}
                {r.context.institutions?.length ? (<><h3>Institutions involved</h3><List items={r.context.institutions} /></>) : null}
              </div>
            </div>
          ) : null}
          {(c.sources || []).length ? (
            <div data-anim="2">
              <h3>Key claims on the record</h3>
              <div className="wire">
                <div className="wire-bar">
                  <span className="dots"><i /><i /><i /></span> evidence · {c.sources.length} source{c.sources.length === 1 ? "" : "s"} · every claim labelled
                </div>
                <div className="wire-body">
                  {(c.sources || []).slice(0, 6).map((s, i) => (
                    <div key={i} className="line">
                      <span className="c-src">{s.sourceOrg || s.sourceTitle || "Source"}</span>
                      <span>{s.claim} <Tag label={s.status} /></span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="hint-sm">Full source register with URLs, dates and filters in <a href="#j-sources">Sources</a>.</p>
            </div>
          ) : null}
          {r.unresolvedQuestions?.length ? (<div data-anim="3"><h3>Still unresolved</h3><List items={r.unresolvedQuestions} max={5} /></div>) : null}
        </Stage>
      ) : null}

      {/* 3 — objective */}
      {f ? (
        <Stage
          id="objective"
          n={num("objective")}
          title={<>Objective &amp; minimum viable <span className="serif">win</span></>}
          agent="strategy · objective check"
          sub="The formula keeps it honest: a decision-maker, a specific action, a time, and a minimum viable win."
          limit="Editable: change the decision-maker, timeframe or minimum win and the plan recomputes."
          revealed={revealed}
          active={active}
        >
          <div className="checkin" data-anim="1">
            <div className="clock">⏰ Check-in formula</div>
            We want <span className="fill">{f.dm}</span> to <span className="fill">{f.action}</span> by{" "}
            <span className="fill">{f.by}</span>, even if the immediate outcome is only <span className="fill">{f.mvw}</span>.
          </div>
          <div className="cols2" data-anim="2" style={{ marginTop: "1.2rem" }}>
            <div>
              <h3>SMART assessment</h3>
              <table><tbody>{(f.smart || []).map((s, i) => (<tr key={i}><td><b>{s.test}</b></td><td>{s.assessment}</td></tr>))}</tbody></table>
            </div>
            <div>
              {f.success ? (<><h3>Success looks like</h3><p>{f.success}</p></>) : null}
              {f.constraints?.length ? (<><h3>Constraints</h3><List items={f.constraints} /></>) : null}
              {p?.assumptions?.length ? (<><h3>Assumptions needing human review</h3><List items={p.assumptions} max={4} /></>) : null}
            </div>
          </div>
          <div className="stagegate" data-anim="3">
            <span className="g-ok">✓ Objective check</span> framed to the SMART test and the check-in formula — every stage below builds on this.
          </div>
        </Stage>
      ) : null}

      {/* 4 — decision */}
      {r?.decisionMaker || f ? (
        <Stage
          id="decision"
          n={num("decision")}
          title={<>The decision-making <span className="serif">route</span></>}
          agent="power analyst · verifier"
          sub="Formal authority and practical influence are different maps. This is both."
          limit="Formal authority ≠ practical influence. Inferred links are badged and need confirming."
          revealed={revealed}
          active={active}
        >
          <div className="diagram" data-anim="1">
            <div className="dg-label">Who decides — formal route</div>
            <div className="routeviz">
              <span className="rnode">You / the campaign</span><span className="rarrow">→</span>
              {r?.decisionMaker?.implementer ? (<><span className="rnode">{r.decisionMaker.implementer}<small>implements</small></span><span className="rarrow">→</span></>) : null}
              <span className="rnode dm">{r?.decisionMaker?.formal || f?.dm}<small>decides</small></span>
            </div>
          </div>
          <div className="cols2" data-anim="2">
            <div>
              {r?.decisionMaker?.practical ? (<><h3>How it works in practice <Tag label="Supported inference" /></h3><p className="callout">{r.decisionMaker.practical}</p></>) : null}
              {r?.decisionMaker?.processes?.length ? (<><h3>Processes &amp; committees</h3><List items={r.decisionMaker.processes} /></>) : null}
            </div>
            <div>
              {r?.decisionMaker?.interventionPoints?.length ? (<><h3>Intervention points</h3><List items={r.decisionMaker.interventionPoints} /></>) : null}
              {r?.decisionMaker?.deadlines?.length ? (<><h3>Deadlines</h3><List items={r.decisionMaker.deadlines} /></>) : null}
              {r?.decisionMaker?.unresolved?.length ? (<><h3>Unresolved institutional questions</h3><List items={r.decisionMaker.unresolved} /></>) : null}
            </div>
          </div>
        </Stage>
      ) : null}

      {/* 5 — power */}
      {p?.stakeholders?.length ? (
        <Stage
          id="power"
          n={num("power")}
          title={<>Power &amp; <span className="serif">stakeholders</span></>}
          agent="power analyst"
          sub="Click any stakeholder for the full profile — position, evidence, ask, approach, verification status."
          limit="Every position is badged. Inferred positions must be human-confirmed before use."
          revealed={revealed}
          active={active}
        >
          <div className="pmap-live" data-anim="1">
            {tiers.map(([tier, label]) => {
              const rows = (p.stakeholders || []).filter((s) => s.tier === tier);
              if (!rows.length) return null;
              return (
                <div className="pm-tier" key={tier}>
                  <div className="pm-label">{label}</div>
                  <div className="pm-row">
                    {rows.map((s, i) => {
                      const size = s.power === "High" ? "big" : (s.power || "").startsWith("Medium") ? "" : "sm";
                      const inferred = s.positionStatus && TAG_CLS[s.positionStatus] !== "real";
                      return (
                        <button key={i} className={`pm-node ${tierCls[tier] || ""} ${size}`} onClick={() => setStake(s)}>
                          {s.name || s.role}
                          {inferred ? <i className="pm-inf" title={s.positionStatus}>?</i> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <p className="hint-sm">Node size ≈ power · colour = grouping · <i className="pm-inf" style={{ position: "static", display: "inline-flex" }}>?</i> = position inferred or unverified, never confirmed.</p>
          </div>
        </Stage>
      ) : null}

      {/* 6 — pressure */}
      {p?.pressures?.length ? (
        <Stage
          id="pressure"
          n={num("pressure")}
          title={<>Pressure <span className="serif">analysis</span></>}
          agent="power · tactics · lobbying"
          sub={p.statusQuoCost}
          limit="Pressure = making the status quo costlier than change, for THIS decision-maker."
          revealed={revealed}
          active={active}
        >
          <div className="pgrid" data-anim="1">
            {p.pressures.map((pr, i) => (
              <div className="pcardx" key={i}>
                <div className="p-type">{pr.type}</div>
                <p><b>Why it matters to {pr.on}:</b> {pr.why}</p>
                <p><b>Who applies it:</b> {pr.whoApplies} · <b>via</b> {pr.channel}</p>
                {pr.evidence ? <p><b>Evidence:</b> {pr.evidence}</p> : null}
                {pr.action ? <p className="p-act"><b>Campaign action that activates it:</b> {pr.action}</p> : null}
              </div>
            ))}
          </div>
        </Stage>
      ) : null}

      {/* 7 — strategy */}
      {p?.strategy ? (
        <Stage
          id="strategy"
          n={num("strategy")}
          title={<>Campaign <span className="serif">strategy</span></>}
          agent="strategy · all specialists reviewed"
          sub="Why this approach could produce the decision — not a list of outputs."
          limit="Constrained by real resources — no tactic assumes capacity that doesn't exist."
          revealed={revealed}
          active={active}
        >
          {p.strategy.narrative ? <blockquote className="narr" data-anim="1">{p.strategy.narrative}</blockquote> : null}
          {p.strategy.phases?.length ? (
            <div data-anim="2">
              <h3>Phases</h3>
              <div className="tl">{p.strategy.phases.map((ph, i) => (<div key={i} className={`tl-ph p${(i % 4) + 1}`}><b>{ph.name}</b><small>{ph.when}</small><br />{ph.focus}</div>))}</div>
            </div>
          ) : null}
          <div className="cols2" data-anim="3">
            <div>
              {p.strategy.route ? (<><h3>Route to influence</h3><p>{p.strategy.route}</p></>) : null}
              {p.strategy.coalition ? (<><h3>Coalition strategy</h3><p>{p.strategy.coalition}</p></>) : null}
              {p.strategy.audiences?.length ? (<><h3>Priority audiences</h3><List items={p.strategy.audiences} /></>) : null}
            </div>
            <div>
              {p.strategy.avoid?.length ? (<><h3>What the campaign will avoid</h3><List items={p.strategy.avoid} /></>) : null}
              {p.strategy.escalation ? (<><h3>Escalation path</h3><p>{p.strategy.escalation}</p></>) : null}
              {p.strategy.indicators?.length ? (<><h3>Signs it&apos;s working / failing</h3><List items={p.strategy.indicators} /></>) : null}
            </div>
          </div>
        </Stage>
      ) : null}

      {/* 8 — tactics */}
      {p?.tactics?.length ? (
        <Stage
          id="tactics"
          n={num("tactics")}
          title={<>Tactics &amp; <span className="serif">sequencing</span></>}
          agent="tactics · lobbying · media · digital"
          sub="Each tactic has a target, an owner, a success sign, and a human approval point."
          limit="Every tactic names a target, an owner, a success sign and a human approval point."
          revealed={revealed}
          active={active}
        >
          <div data-anim="1">
            {p.tactics.map((t, i) => (
              <details className="tacx" key={i}>
                <summary><span className="t-ph">P{t.phase}</span> <b>{t.name}</b> <span className="t-meta">{t.type} · target: {t.target}</span></summary>
                <table><tbody>
                  {t.purpose ? <tr><td><b>Purpose</b></td><td>{t.purpose}</td></tr> : null}
                  {t.owner ? <tr><td><b>Owner</b></td><td>{t.owner}</td></tr> : null}
                  {t.success ? <tr><td><b>Success sign</b></td><td>{t.success}</td></tr> : null}
                  {t.approval ? <tr><td><b>Human approval</b></td><td>{t.approval}</td></tr> : null}
                  {t.escalation && t.escalation !== "—" ? <tr><td><b>Escalation</b></td><td>{t.escalation}</td></tr> : null}
                </tbody></table>
              </details>
            ))}
          </div>
        </Stage>
      ) : null}

      {/* 9 — organising */}
      {p?.organising ? (
        <Stage
          id="organising"
          n={num("organising")}
          title={<>Organising <span className="serif">people</span></>}
          agent="organising · digital"
          sub={p.organising.whoActs}
          limit="Supporters are owners, not recipients. Relationships stay human."
          revealed={revealed}
          active={active}
        >
          <div className="cols2" data-anim="1">
            <div>
              {p.organising.whyParticipate ? (<><h3>Why people will take part</h3><p>{p.organising.whyParticipate}</p></>) : null}
              {p.organising.asks?.length ? (<><h3>The asks</h3><List items={p.organising.asks} /></>) : null}
              {p.organising.roles?.length ? (<><h3>Volunteer roles</h3><table><tbody>{p.organising.roles.map((ro, i) => (<tr key={i}><td><b>{ro.role}</b></td><td>{ro.what}</td></tr>))}</tbody></table></>) : null}
              {p.organising.oneToOne?.length ? (<><h3>One-to-one conversation guide</h3><ol>{p.organising.oneToOne.map((x, i) => <li key={i}>{x}</li>)}</ol></>) : null}
            </div>
            <div>
              {p.organising.ladder?.length ? (
                <>
                  <h3>Ladder of engagement</h3>
                  <div className="sladder">
                    {p.organising.ladder.map((l, i, arr) => (
                      <div key={i} className={`srung ${i === Math.min(2, arr.length - 1) ? "hot" : ""}`}>
                        <div className="r-t"><span className="r-n">{i + 1}</span>{l.rung}</div>
                        <div className="r-a">{l.action}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              {p.organising.channels?.length ? (<><h3>Channels</h3><List items={p.organising.channels} /></>) : null}
              {p.organising.event ? (<><h3>Event</h3><p>{p.organising.event}</p></>) : null}
              {p.organising.humanEssential?.length ? (<><h3>Where trust and relationships stay human</h3><List items={p.organising.humanEssential} /></>) : null}
            </div>
          </div>
        </Stage>
      ) : null}

      {/* 10 — drafts */}
      {d?.lobbying || d?.media || d?.digital ? (
        <Stage
          id="drafts"
          n={num("drafts")}
          title={<>Drafted <span className="serif">resources</span></>}
          agent="lobbying · media · digital"
          sub="Complete first drafts from the shared plan. [VERIFY: …] items are unresolved facts — never send without resolving them."
          limit="First drafts only — nothing is sent without a person editing and approving it."
          revealed={revealed}
          active={active}
        >
          {d.lobbying ? (
            <>
              <h3 className="draftgroup" data-anim="1">Lobbying</h3>
              <DraftBlock title="Meeting-request email" body={d.lobbying.meetingEmail} />
              <DraftBlock title="Decision-maker briefing" body={d.lobbying.briefing} />
              <DraftBlock title="Doorknocking / public-conversation script" body={d.lobbying.doorknockScript || d.lobbying.contactScript} />
            </>
          ) : null}
          {d.media ? (
            <>
              <h3 className="draftgroup" data-anim="1">Media</h3>
              {d.media.headline ? <DraftBlock title="Suggested headline" body={d.media.headline} /> : null}
              <DraftBlock title="Local press release" body={d.media.pressRelease} />
              <DraftBlock title="Journalist pitch email" body={d.media.pitchEmail} />
              {d.media.quotes?.length ? (
                <div className="draftblock" data-anim="2">
                  <div className="db-head"><b>Draft spokesperson quotes <span className="tag verify">Requires the named speaker&apos;s consent</span></b></div>
                  <div className="db-body">{d.media.quotes.map((q, i) => (<p key={i}>“{q.quote}” — <em>{q.voice}</em>{q.note ? <span className="hint-sm"> ({q.note})</span> : null}</p>))}</div>
                </div>
              ) : null}
            </>
          ) : null}
          {d.digital ? (
            <>
              <h3 className="draftgroup" data-anim="1">Digital</h3>
              <DraftBlock title="Petition / action-page copy" body={d.digital.actionPageCopy} />
              <DraftBlock title="Supporter email" body={d.digital.supporterEmail} />
              {d.digital.socialPosts?.length ? (
                <div className="draftblock" data-anim="2">
                  <div className="db-head"><b>Social posts</b></div>
                  <div className="db-body">{d.digital.socialPosts.map((s, i) => (<p key={i}><span className="tag gen">{s.platform}</span> {withVerify(s.text)}</p>))}</div>
                </div>
              ) : null}
              {d.digital.faq?.length ? (
                <div className="draftblock" data-anim="2">
                  <div className="db-head"><b>Campaign FAQ</b></div>
                  <div className="db-body">{d.digital.faq.map((x, i) => (<p key={i}><b>{x.q}</b><br />{x.a}</p>))}</div>
                </div>
              ) : null}
            </>
          ) : null}
        </Stage>
      ) : null}

      {/* 11 — documents */}
      {docs.length ? (
        <Stage
          id="documents"
          n={num("documents")}
          title={<>Campaign <span className="serif">materials</span></>}
          agent="library"
          sub="One shared campaign plan behind every document. Copy or download each individually."
          limit="Every document reads from one shared campaign object; regenerate any one alone."
          revealed={revealed}
          active={active}
        >
          <div className="docgrid" data-anim="1">
            {docs.map((doc, i) => (
              <div className="doccard" key={doc.title}>
                <span className="d-n">Document {i + 1} of {docs.length}</span>
                <h3>{doc.title}</h3>
                <div className="d-prev">{doc.text.slice(0, 150)}…</div>
                <div className="dd-actions">
                  <button className="toolbtn" onClick={() => copyText(doc.text)}>⧉ Copy</button>
                  <button className="toolbtn" onClick={() => downloadDoc(doc.title, doc.text)}>↓ Word</button>
                </div>
              </div>
            ))}
          </div>
        </Stage>
      ) : null}

      {/* 12 — sources */}
      {c.sources?.length ? (
        <Stage
          id="sources"
          n={num("sources")}
          title={<>Every <span className="serif">source</span> used</>}
          agent="verifier"
          sub="Filter by verification status. Nothing invented is presented as verified."
          limit="Nothing invented is presented as verified — filter to see what each claim rests on."
          revealed={revealed}
          active={active}
        >
          {c.lint?.flags?.length ? (
            <div className="jbanner" data-anim="1" style={{ marginTop: 0 }}>
              <b>{c.lint.flags.length} statement{c.lint.flags.length === 1 ? "" : "s"} to verify before use.</b> The consistency check couldn&apos;t fully reconcile these against the sources — check them before sending anything.
              <List items={c.lint.flags.slice(0, 6).map((fl) => fl.issue)} />
            </div>
          ) : null}
          <div className="srcfilters" data-anim="1">
            <button className={`toolbtn ${srcFilter === "all" ? "on" : ""}`} onClick={() => setSrcFilter("all")}>All ({c.sources.length})</button>
            {present.map((l) => (
              <button key={l} className={`toolbtn ${srcFilter === l ? "on" : ""}`} onClick={() => setSrcFilter(l)}>{l} ({(c.sources || []).filter((s) => s.status === l).length})</button>
            ))}
          </div>
          <div data-anim="2">
            {(shownSources || []).map((s, i) => (
              <div className="srccard" key={i}>
                <div className="src-h"><b>{s.sourceTitle || "Source"}</b> <Tag label={s.status} /><span className={`tag ${s.confidence === "High" ? "real" : s.confidence === "Low" ? "verify" : "mock"}`}>confidence: {s.confidence || "—"}</span></div>
                <p>{s.claim}</p>
                {s.evidence ? <p className="src-ev">“{s.evidence}”</p> : null}
                <p className="src-meta">{s.sourceOrg}{s.url && s.url.startsWith("http") ? (<> · <a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a></>) : null}{s.accessDate ? ` · accessed ${s.accessDate}` : ""}{s.usedFor ? ` · used in: ${s.usedFor}` : ""}</p>
              </div>
            ))}
          </div>
        </Stage>
      ) : null}

      {/* stakeholder detail panel */}
      {stake ? (
        <>
          <div onClick={() => setStake(null)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <aside className="stakepanel show">
            <button className="toolbtn sp-close" onClick={() => setStake(null)}>✕</button>
            <div className="eyebrow">{stake.tier} · power: {stake.power}</div>
            <h3 style={{ margin: "0 0 .4rem" }}>{stake.name || stake.role}</h3>
            <p className="src-meta">{[stake.org, stake.role].filter(Boolean).join(" · ")}</p>
            <table><tbody>
              <tr><td><b>Position</b></td><td>{stake.position} <Tag label={stake.positionStatus} /></td></tr>
              {stake.relationship ? <tr><td><b>Relationship to the decision</b></td><td>{stake.relationship}</td></tr> : null}
              {stake.cares ? <tr><td><b>Likely to care about</b></td><td>{stake.cares}</td></tr> : null}
              {stake.ask ? <tr><td><b>What we ask of them</b></td><td>{stake.ask}</td></tr> : null}
              {stake.approach ? <tr><td><b>Recommended approach</b></td><td>{stake.approach}</td></tr> : null}
              {stake.evidence ? <tr><td><b>Evidence</b></td><td>{stake.evidence}</td></tr> : null}
              <tr><td><b>Confidence</b></td><td>{stake.confidence || "—"}</td></tr>
            </tbody></table>
            <p className="hint-sm">Inferred positions are starting points for human judgement — verify before acting on them.</p>
          </aside>
        </>
      ) : null}
    </div>
  );
}
