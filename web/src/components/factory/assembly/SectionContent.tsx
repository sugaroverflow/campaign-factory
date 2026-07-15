"use client";

// Accepted section content renderer (W4), wired to W1's per-section schemas
// (web/src/lib/factory/state/sections.ts). Each JourneyStepKey gets a bespoke
// renderer reusing the existing Journey/journey.css visual language: check-in
// formula, route diagram, power map, pressure cards, timeline, tactics
// accordion, supporter ladder.
//
// Contract notes (W1):
//  - power/pressure/tactics content is an OBJECT wrapping the array under the
//    plural key (stakeholders/pressures/tactics), never a bare array;
//  - the reducer preserves the agent's ORIGINAL content object, so fields
//    beyond the schema survive — after the bespoke fields, any extra fields are
//    rendered through the generic fallback so richness is never lost;
//  - content that fails W1's shape validation falls back entirely to the
//    generic renderer (render what's real, never crash, never invent).

import { useState, type ReactNode } from "react";
import type { JourneyStepKey } from "@/lib/factory/contracts";
import { isJourneyStepKey, validateSectionContent } from "@/lib/factory/state/sections";
import "@/components/factory/documents/documents.css";

/* ---- local field types mirroring sections.ts (schemas are type-erased) ---- */

interface SmartTest {
  test: string;
  assessment?: string;
}
interface StakeholderC {
  name: string;
  org?: string;
  role?: string;
  tier?: "decides" | "influences" | "mobilises" | "resists" | "neutral";
  power?: string;
  position?: string;
  positionStatus?: string;
  relationship?: string;
  cares?: string;
  ask?: string;
  approach?: string;
  evidence?: string;
  confidence?: string;
}
interface PressureC {
  type?: string;
  on?: string;
  why?: string;
  whoApplies?: string;
  channel?: string;
  evidence?: string;
  action?: string;
}
interface PhaseC {
  name: string;
  when?: string;
  focus?: string;
}
interface TacticC {
  name: string;
  phase?: number;
  type?: string;
  purpose?: string;
  target?: string;
  owner?: string;
  pressure?: string;
  resources?: string;
  timing?: string;
  dependencies?: string;
  expected?: string;
  success?: string;
  next?: string;
  escalation?: string;
  approval?: string;
}
interface RoleC {
  role: string;
  what?: string;
}
interface LadderC {
  rung: string;
  action?: string;
}

/* ---- shared bits (mirror Journey.tsx conventions) ---- */

// label → provenance tag class (same mapping as Journey.tsx; local copy because
// the original is not exported and shared files are frozen for this build)
const TAG_CLS: Record<string, string> = {
  "Verified public information": "real",
  "Supported inference": "gen",
  "Generated campaign recommendation": "gen",
  "Campaign assumption": "mock",
  "Conflicting evidence": "verify",
  "Verification incomplete": "verify",
  "External information unavailable": "ext",
};

// Clean prose (product decision, 15 Jul 2026): the seven verification labels
// never render inline in section content. The ONE exception: a fact labelled
// "Conflicting evidence" gets the power-map question-mark visual, linking to
// the Fact checks section at the bottom of the brief. Everything stripped here
// stays visible there — nothing is deleted from data.
function ConflictMark() {
  return (
    <a
      className="pm-inf pm-inf--inline"
      href="#fa-evidence-checks"
      title="Sources disagree on this — see Fact checks"
    >
      ?
    </a>
  );
}

function Tag({ label }: { label?: string }) {
  if (!label) return null;
  if (TAG_CLS[label]) {
    return label === "Conflicting evidence" ? <ConflictMark /> : null;
  }
  // Off-enum statuses render as plain text — never coerced into a chip that
  // visually claims one of the seven verification labels (W1 guidance).
  return <span className="hint-sm">{label}</span>;
}

const List = ({ items, max }: { items?: string[]; max?: number }) =>
  items?.length ? (
    <ul>
      {items.slice(0, max ?? 99).map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  ) : null;

const H3List = ({ title, items }: { title: string; items?: string[] }) =>
  items?.length ? (
    <>
      <h3>{title}</h3>
      <List items={items} />
    </>
  ) : null;

function humanise(key: string): string {
  // lane_council_records → "Council records" (specialists merge lane findings
  // under lane_<key>; the prefix is plumbing, not content)
  const s = key
    .replace(/^lane_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/* ---- generic fallback renderer (also renders preserved extra fields) ---- */

function leafLabel(o: Record<string, unknown>): { text?: string; label?: string } {
  const text = ["text", "statement", "claim", "title", "name", "value"]
    .map((k) => o[k])
    .find((v) => typeof v === "string") as string | undefined;
  const label = ["label", "status", "tier"].map((k) => o[k]).find((v) => typeof v === "string") as
    | string
    | undefined;
  return { text, label };
}

function renderValue(value: unknown, depth: number): ReactNode {
  if (value == null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <p>{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return (
        <ul>
          {value.map((v, i) => (
            <li key={i}>{String(v)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div>
        {value.map((v, i) => {
          if (isPlainObject(v)) {
            const { text, label } = leafLabel(v);
            if (text) {
              return (
                <p key={i}>
                  {text}
                  {label ? (
                    <span style={{ marginLeft: ".4rem" }}>
                      <Tag label={label} />
                    </span>
                  ) : null}
                </p>
              );
            }
          }
          return <div key={i}>{renderValue(v, depth + 1)}</div>;
        })}
      </div>
    );
  }
  if (isPlainObject(value)) {
    if (depth > 4) return null;
    return (
      <div>
        {Object.entries(value).map(([k, v]) => {
          const rendered = renderValue(v, depth + 1);
          if (rendered == null) return null;
          return (
            <div key={k}>
              <h4>{humanise(k)}</h4>
              {rendered}
            </div>
          );
        })}
      </div>
    );
  }
  return null;
}

/** Renders any fields the bespoke renderer didn't consume — the reducer keeps
 *  the agent's original object, so richer-than-schema output still shows. */
function Extras({ content, consumed }: { content: Record<string, unknown>; consumed: readonly string[] }) {
  const extra = Object.entries(content).filter(
    ([k, v]) => !consumed.includes(k) && v != null && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  if (!extra.length) return null;
  return (
    <>
      {extra.map(([k, v]) => (
        <div key={k}>
          <h4>{humanise(k)}</h4>
          {renderValue(v, 1)}
        </div>
      ))}
    </>
  );
}

/* ---- per-section bespoke renderers ---- */

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const strs = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : undefined;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// -- 1 problem --
const PROBLEM_KEYS = ["statement", "campaignName", "interpretation", "context"] as const;
function ProblemContent(c: Record<string, unknown>) {
  const ctx = isPlainObject(c.context) ? c.context : undefined;
  return (
    <>
      {str(c.campaignName) ? <div className="eyebrow">{str(c.campaignName)}</div> : null}
      <blockquote className="userquote">{str(c.statement)}</blockquote>
      {str(c.interpretation) ? (
        <>
          <h3>How the agent factory read it</h3>
          <p className="callout warm">{str(c.interpretation)}</p>
        </>
      ) : null}
      {ctx ? (
        <div className="cols2">
          <div>
            {str(ctx.situation) ? (
              <>
                <h3>The situation</h3>
                <p>{str(ctx.situation)}</p>
              </>
            ) : null}
            {str(ctx.currentPolicy) ? (
              <>
                <h3>Current policy / restriction</h3>
                <p>{str(ctx.currentPolicy)}</p>
              </>
            ) : null}
            {str(ctx.howItChanged) ? (
              <>
                <h3>How research changed the request</h3>
                <p className="callout">{str(ctx.howItChanged)}</p>
              </>
            ) : null}
          </div>
          <div>
            <H3List title="Key dates & processes" items={strs(ctx.keyDates)} />
            <H3List title="Institutions involved" items={strs(ctx.institutions)} />
            <H3List title="Who is affected" items={strs(ctx.affected)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

// -- 2 evidence --
const EVIDENCE_KEYS = [
  "summary",
  "researchQuestions",
  "keyDates",
  "institutions",
  "allies",
  "opponents",
  "localMedia",
  "unresolved",
] as const;
function EvidenceContent(c: Record<string, unknown>) {
  return (
    <>
      {str(c.summary) ? <p>{str(c.summary)}</p> : null}
      <div className="cols2">
        <div>
          <H3List title="Questions the research answered" items={strs(c.researchQuestions)} />
          <H3List title="Key dates & processes" items={strs(c.keyDates)} />
          <H3List title="Institutions involved" items={strs(c.institutions)} />
        </div>
        <div>
          <H3List title="Likely allies" items={strs(c.allies)} />
          <H3List title="Likely opponents" items={strs(c.opponents)} />
          <H3List title="Local media" items={strs(c.localMedia)} />
          <H3List title="Still unresolved" items={strs(c.unresolved)} />
        </div>
      </div>
    </>
  );
}

// -- 3 objective --
const OBJECTIVE_KEYS = ["dm", "action", "by", "mvw", "success", "constraints", "smart"] as const;
function ObjectiveContent(c: Record<string, unknown>) {
  const smart = arr<SmartTest>(c.smart);
  return (
    <>
      <div className="checkin">
        <div className="clock">⏰ Check-in formula</div>
        We want <span className="fill">{str(c.dm)}</span> to <span className="fill">{str(c.action)}</span>
        {str(c.by) ? (
          <>
            {" "}
            by <span className="fill">{str(c.by)}</span>
          </>
        ) : null}
        {str(c.mvw) ? (
          <>
            , even if the immediate outcome is only <span className="fill">{str(c.mvw)}</span>
          </>
        ) : null}
        .
      </div>
      <div className="cols2" style={{ marginTop: "1.2rem" }}>
        <div>
          {smart.length ? (
            <>
              <h3>SMART assessment</h3>
              <table>
                <tbody>
                  {smart.map((s, i) => (
                    <tr key={i}>
                      <td>
                        <b>{s.test}</b>
                      </td>
                      <td>{s.assessment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </div>
        <div>
          {str(c.success) ? (
            <>
              <h3>Success looks like</h3>
              <p>{str(c.success)}</p>
            </>
          ) : null}
          <H3List title="Constraints" items={strs(c.constraints)} />
        </div>
      </div>
    </>
  );
}

// -- 4 decision_route --
const ROUTE_KEYS = [
  "formal",
  "implementer",
  "practical",
  "processes",
  "interventionPoints",
  "deadlines",
  "unresolved",
] as const;
function DecisionRouteContent(c: Record<string, unknown>) {
  return (
    <>
      <div className="diagram">
        <div className="dg-label">Who decides — formal route</div>
        <div className="routeviz">
          <span className="rnode">You / the campaign</span>
          <span className="rarrow">→</span>
          {str(c.implementer) ? (
            <>
              <span className="rnode">
                {str(c.implementer)}
                <small>implements</small>
              </span>
              <span className="rarrow">→</span>
            </>
          ) : null}
          <span className="rnode dm">
            {str(c.formal)}
            <small>decides</small>
          </span>
        </div>
      </div>
      <div className="cols2">
        <div>
          {str(c.practical) ? (
            <>
              <h3>How it works in practice</h3>
              <p className="callout">{str(c.practical)}</p>
            </>
          ) : null}
          <H3List title="Processes & committees" items={strs(c.processes)} />
        </div>
        <div>
          <H3List title="Intervention points" items={strs(c.interventionPoints)} />
          <H3List title="Deadlines" items={strs(c.deadlines)} />
          <H3List title="Unresolved institutional questions" items={strs(c.unresolved)} />
        </div>
      </div>
    </>
  );
}

// -- 5 power --
const POWER_KEYS = ["stakeholders", "statusQuoCost"] as const;
const TIERS: [NonNullable<StakeholderC["tier"]>, string][] = [
  ["decides", "Decides"],
  ["influences", "Influences"],
  ["mobilises", "Mobilises"],
  ["resists", "May resist"],
  ["neutral", "Neutral"],
];
const TIER_CLS: Record<string, string> = { decides: "dm", mobilises: "ally", resists: "opp", neutral: "neut" };

function PowerContent(c: Record<string, unknown>) {
  return <PowerMap stakeholders={arr<StakeholderC>(c.stakeholders)} statusQuoCost={str(c.statusQuoCost)} />;
}

function PowerMap({ stakeholders, statusQuoCost }: { stakeholders: StakeholderC[]; statusQuoCost?: string }) {
  const [sel, setSel] = useState<StakeholderC | null>(null);
  const tierOf = (s: StakeholderC) => s.tier ?? "neutral";
  return (
    <>
      {statusQuoCost ? <p className="callout warm">{statusQuoCost}</p> : null}
      <div className="pmap-live" style={statusQuoCost ? { marginTop: "1rem" } : undefined}>
        {TIERS.map(([tier, label]) => {
          const rows = stakeholders.filter((s) => tierOf(s) === tier);
          if (!rows.length) return null;
          return (
            <div className="pm-tier" key={tier}>
              <div className="pm-label">{label}</div>
              <div className="pm-row">
                {rows.map((s, i) => {
                  const size = s.power === "High" ? "big" : (s.power || "").startsWith("Medium") ? "" : "sm";
                  const inferred = s.positionStatus && TAG_CLS[s.positionStatus] !== "real";
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`pm-node ${TIER_CLS[tier] || ""} ${size}`}
                      onClick={() => setSel(sel === s ? null : s)}
                    >
                      {s.name || s.role}
                      {inferred ? (
                        <i className="pm-inf" title={s.positionStatus}>
                          ?
                        </i>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <p className="hint-sm">
          Click a stakeholder for their profile · node size ≈ power ·{" "}
          <i className="pm-inf" style={{ position: "static", display: "inline-flex" }}>
            ?
          </i>{" "}
          = position inferred or unverified, never confirmed.
        </p>
      </div>
      {sel ? (
        <div className="pcardx" style={{ marginTop: "1rem" }}>
          <div className="p-type">
            {sel.tier ?? "stakeholder"} · power: {sel.power ?? "—"}
          </div>
          <p>
            <b>{sel.name || sel.role}</b>
            {sel.org || sel.role ? (
              <span className="hint-sm"> · {[sel.org, sel.role].filter(Boolean).join(" · ")}</span>
            ) : null}
          </p>
          {sel.position ? (
            <p>
              <b>Position:</b> {sel.position} <Tag label={sel.positionStatus} />
            </p>
          ) : null}
          {sel.relationship ? (
            <p>
              <b>Relationship to the decision:</b> {sel.relationship}
            </p>
          ) : null}
          {sel.cares ? (
            <p>
              <b>Likely to care about:</b> {sel.cares}
            </p>
          ) : null}
          {sel.ask ? (
            <p>
              <b>What we ask of them:</b> {sel.ask}
            </p>
          ) : null}
          {sel.approach ? (
            <p>
              <b>Recommended approach:</b> {sel.approach}
            </p>
          ) : null}
          {sel.evidence ? (
            <p>
              <b>Evidence:</b> {sel.evidence}
            </p>
          ) : null}
          {sel.confidence ? (
            <p>
              <b>Confidence:</b> {sel.confidence}
            </p>
          ) : null}
          <p className="hint-sm">Inferred positions are starting points for human judgement — verify before acting.</p>
        </div>
      ) : null}
    </>
  );
}

// -- 6 pressure --
const PRESSURE_KEYS = ["pressures", "statusQuoCost"] as const;
function PressureContent(c: Record<string, unknown>) {
  const pressures = arr<PressureC>(c.pressures);
  return (
    <>
      {str(c.statusQuoCost) ? <p className="callout warm">{str(c.statusQuoCost)}</p> : null}
      <div className="pgrid" style={str(c.statusQuoCost) ? { marginTop: "1rem" } : undefined}>
        {pressures.map((pr, i) => (
          <div className="pcardx" key={i}>
            {pr.type ? <div className="p-type">{pr.type}</div> : null}
            {pr.why ? (
              <p>
                <b>Why it matters{pr.on ? ` to ${pr.on}` : ""}:</b> {pr.why}
              </p>
            ) : null}
            {pr.whoApplies || pr.channel ? (
              <p>
                {pr.whoApplies ? (
                  <>
                    <b>Who applies it:</b> {pr.whoApplies}
                  </>
                ) : null}
                {pr.whoApplies && pr.channel ? " · " : null}
                {pr.channel ? (
                  <>
                    <b>via</b> {pr.channel}
                  </>
                ) : null}
              </p>
            ) : null}
            {pr.evidence ? (
              <p>
                <b>Evidence:</b> {pr.evidence}
              </p>
            ) : null}
            {pr.action ? (
              <p className="p-act">
                <b>Campaign action that activates it:</b> {pr.action}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

// -- 7 strategy --
const STRATEGY_KEYS = [
  "narrative",
  "audiences",
  "route",
  "coalition",
  "phases",
  "resources",
  "constraints",
  "risks",
  "tradeoffs",
  "escalation",
  "avoid",
  "indicators",
  "statusQuoCost",
] as const;
function StrategyContent(c: Record<string, unknown>) {
  const phases = arr<PhaseC>(c.phases);
  return (
    <>
      {str(c.narrative) ? <blockquote className="narr">{str(c.narrative)}</blockquote> : null}
      {phases.length ? (
        <>
          <h3>Phases</h3>
          <div className="tl">
            {phases.map((ph, i) => (
              <div key={i} className={`tl-ph p${(i % 4) + 1}`}>
                <b>{ph.name}</b>
                {ph.when ? <small>{ph.when}</small> : null}
                <br />
                {ph.focus}
              </div>
            ))}
          </div>
        </>
      ) : null}
      <div className="cols2">
        <div>
          {str(c.route) ? (
            <>
              <h3>Route to influence</h3>
              <p>{str(c.route)}</p>
            </>
          ) : null}
          {str(c.coalition) ? (
            <>
              <h3>Coalition strategy</h3>
              <p>{str(c.coalition)}</p>
            </>
          ) : null}
          <H3List title="Priority audiences" items={strs(c.audiences)} />
          <H3List title="Resources assumed" items={strs(c.resources)} />
          <H3List title="Constraints" items={strs(c.constraints)} />
        </div>
        <div>
          <H3List title="Risks" items={strs(c.risks)} />
          <H3List title="Trade-offs accepted" items={strs(c.tradeoffs)} />
          <H3List title="What the campaign will avoid" items={strs(c.avoid)} />
          {str(c.escalation) ? (
            <>
              <h3>Escalation path</h3>
              <p>{str(c.escalation)}</p>
            </>
          ) : null}
          <H3List title="Signs it's working / failing" items={strs(c.indicators)} />
          {str(c.statusQuoCost) ? (
            <>
              <h3>Cost of the status quo</h3>
              <p>{str(c.statusQuoCost)}</p>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

// -- 8 tactics --
const TACTICS_KEYS = ["tactics"] as const;
function TacticsContent(c: Record<string, unknown>) {
  const tactics = arr<TacticC>(c.tactics);
  const row = (label: string, v?: string) =>
    v && v !== "—" ? (
      <tr>
        <td>
          <b>{label}</b>
        </td>
        <td>{v}</td>
      </tr>
    ) : null;
  return (
    <div>
      {tactics.map((t, i) => (
        <details className="tacx" key={i}>
          <summary>
            {typeof t.phase === "number" ? <span className="t-ph">P{t.phase}</span> : null} <b>{t.name}</b>{" "}
            <span className="t-meta">
              {[t.type, t.target ? `target: ${t.target}` : null].filter(Boolean).join(" · ")}
            </span>
          </summary>
          <table>
            <tbody>
              {row("Purpose", t.purpose)}
              {row("Owner", t.owner)}
              {row("Timing", t.timing)}
              {row("Dependencies", t.dependencies)}
              {row("Resources", t.resources)}
              {row("Pressure it applies", t.pressure)}
              {row("Expected effect", t.expected)}
              {row("Success sign", t.success)}
              {row("What follows", t.next)}
              {row("Escalation", t.escalation)}
              {row("Human approval", t.approval)}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

// -- 9 organising --
const ORGANISING_KEYS = [
  "whoActs",
  "whyParticipate",
  "asks",
  "roles",
  "coalition",
  "oneToOne",
  "outreach",
  "event",
  "ladder",
  "channels",
  "followup",
  "sustain",
  "metrics",
  "humanEssential",
] as const;
function OrganisingContent(c: Record<string, unknown>) {
  const roles = arr<RoleC>(c.roles);
  const ladder = arr<LadderC>(c.ladder);
  const oneToOne = strs(c.oneToOne);
  return (
    <>
      {str(c.whoActs) ? <p className="callout">{str(c.whoActs)}</p> : null}
      <div className="cols2" style={str(c.whoActs) ? { marginTop: "1rem" } : undefined}>
        <div>
          {str(c.whyParticipate) ? (
            <>
              <h3>Why people will take part</h3>
              <p>{str(c.whyParticipate)}</p>
            </>
          ) : null}
          <H3List title="The asks" items={strs(c.asks)} />
          {roles.length ? (
            <>
              <h3>Volunteer roles</h3>
              <table>
                <tbody>
                  {roles.map((ro, i) => (
                    <tr key={i}>
                      <td>
                        <b>{ro.role}</b>
                      </td>
                      <td>{ro.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {oneToOne?.length ? (
            <>
              <h3>One-to-one conversation guide</h3>
              <ol>
                {oneToOne.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </>
          ) : null}
          <H3List title="Coalition partners" items={strs(c.coalition)} />
          {str(c.outreach) ? (
            <>
              <h3>Outreach</h3>
              <p>{str(c.outreach)}</p>
            </>
          ) : null}
        </div>
        <div>
          {ladder.length ? (
            <>
              <h3>Ladder of engagement</h3>
              <div className="sladder">
                {ladder.map((l, i, a) => (
                  <div key={i} className={`srung ${i === Math.min(2, a.length - 1) ? "hot" : ""}`}>
                    <div className="r-t">
                      <span className="r-n">{i + 1}</span>
                      {l.rung}
                    </div>
                    <div className="r-a">{l.action}</div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <H3List title="Channels" items={strs(c.channels)} />
          {str(c.event) ? (
            <>
              <h3>Event</h3>
              <p>{str(c.event)}</p>
            </>
          ) : null}
          {str(c.followup) ? (
            <>
              <h3>Follow-up</h3>
              <p>{str(c.followup)}</p>
            </>
          ) : null}
          {str(c.sustain) ? (
            <>
              <h3>Sustaining involvement</h3>
              <p>{str(c.sustain)}</p>
            </>
          ) : null}
          <H3List title="Organising metrics" items={strs(c.metrics)} />
          <H3List title="Where trust and relationships stay human" items={strs(c.humanEssential)} />
        </div>
      </div>
    </>
  );
}

// -- 10 documents --
const DOCUMENTS_KEYS = ["summary", "notes"] as const;
function DocumentsContent(c: Record<string, unknown>) {
  return (
    <>
      {str(c.summary) ? <p>{str(c.summary)}</p> : null}
      <List items={strs(c.notes)} />
    </>
  );
}

/* ---- dispatch ---- */

const BESPOKE: Record<
  JourneyStepKey,
  { render: (c: Record<string, unknown>) => ReactNode; consumed: readonly string[] }
> = {
  problem: { render: ProblemContent, consumed: PROBLEM_KEYS },
  evidence: { render: EvidenceContent, consumed: EVIDENCE_KEYS },
  objective: { render: ObjectiveContent, consumed: OBJECTIVE_KEYS },
  decision_route: { render: DecisionRouteContent, consumed: ROUTE_KEYS },
  power: { render: PowerContent, consumed: POWER_KEYS },
  pressure: { render: PressureContent, consumed: PRESSURE_KEYS },
  strategy: { render: StrategyContent, consumed: STRATEGY_KEYS },
  tactics: { render: TacticsContent, consumed: TACTICS_KEYS },
  organising: { render: OrganisingContent, consumed: ORGANISING_KEYS },
  documents: { render: DocumentsContent, consumed: DOCUMENTS_KEYS },
};

export function SectionContent({ stepKey, content }: { stepKey?: JourneyStepKey; content: unknown }) {
  if (content == null) return null;

  if (stepKey && isJourneyStepKey(stepKey) && isPlainObject(content)) {
    const { ok } = validateSectionContent(stepKey, content);
    if (ok) {
      const { render, consumed } = BESPOKE[stepKey];
      return (
        <div className="rc fa-content">
          {render(content)}
          <Extras content={content} consumed={consumed} />
        </div>
      );
    }
  }

  // Shape didn't validate (or no step key): render what's real, generically.
  const body = renderValue(content, 0);
  if (body == null) return null;
  return <div className="rc fa-content">{body}</div>;
}
