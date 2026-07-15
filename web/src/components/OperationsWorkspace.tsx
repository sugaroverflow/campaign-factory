"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STORAGE_KEY = "cf_operations_demo_v3";
const LEGACY_STORAGE_KEYS = ["cf_operations_demo_v2", "cf_operations_demo_v1"];

type SegmentId = "school_gates" | "ward_parents" | "local_allies";
type DraftId = "supporter_email" | "decision_maker_letter" | "press_pitch";
type DraftStatus = "draft" | "review" | "approved" | "queued";
type Mode = "compose" | "preview";
type StageStatus = "complete" | "current" | "blocked" | "soon";
type ViewId =
  | "overview"
  | "brief"
  | "objectives"
  | "power"
  | "strategy"
  | "evidence"
  | "audiences"
  | "contacts"
  | "drafts"
  | "reviews"
  | "outbox"
  | "responses";

type Activity = {
  id: string;
  label: string;
};

type DemoState = {
  selectedSegment: SegmentId;
  subject: string;
  body: string;
  status: DraftStatus;
  mode: Mode;
  activeDraft: DraftId;
  activeView: ViewId;
  contactFilter: SegmentId | "all";
  contactReadinessFilter: "all" | "ready" | "review" | "blocked";
  scheduleIntent: "after_approval" | "tomorrow_morning" | "school_run";
  queuedAt: string | null;
  activity: Activity[];
};

type Segment = {
  id: SegmentId;
  name: string;
  role: string;
  contacts: number;
  ready: number;
  readiness: string;
  ask: string;
  caveat: string;
};

type NavItem = { id: ViewId; label: string; badge?: string; note: string };
type CampaignContextRow = { label: string; detail: string; use: string; owner: string };
type RunwayStage = { label: string; view: ViewId; status: StageStatus; statusLabel: string; detail: string };
type DraftLibraryItem = {
  id: DraftId;
  title: string;
  channel: string;
  state: string;
  detail: string;
  audience: string;
  requires: string;
  outline: string[];
};

type ContactFixture = {
  id: string;
  name: string;
  segmentId: SegmentId;
  segment: string;
  role: string;
  readiness: "Ready fixture" | "Review first" | "Blocked";
  consent: string;
  check: string;
  nextAction: string;
  owner: string;
};

const segments: Segment[] = [
  {
    id: "school_gates",
    name: "School-gate families",
    role: "Primary audience",
    contacts: 48,
    ready: 31,
    readiness: "31 fixture contacts have enough detail for a reviewed local email.",
    ask: "Ask families to back a permanent, enforced school street before the experimental order lapses.",
    caveat: "Contact details are demo fixtures; real import and consent checks are coming soon.",
  },
  {
    id: "ward_parents",
    name: "Nearby ward parents",
    role: "Pressure-building audience",
    contacts: 73,
    ready: 44,
    readiness: "44 fixture contacts include postcode-level relevance and school-run concern tags.",
    ask: "Invite parents nearby to show this is a neighbourhood safety issue, not only a school request.",
    caveat: "The workspace can draft for this segment, but live segmentation is not connected.",
  },
  {
    id: "local_allies",
    name: "Local allies and councillor watchers",
    role: "Review and escalation audience",
    contacts: 16,
    ready: 9,
    readiness: "9 fixture contacts are marked ready for careful, human-reviewed outreach.",
    ask: "Share the campaign ask with allies who can spot council process risks and amplify the decision route.",
    caveat: "No external contacts are messaged from this demo workspace.",
  },
];

const contacts: ContactFixture[] = [
  {
    id: "patel",
    name: "A. Patel",
    segmentId: "school_gates",
    segment: "School-gate families",
    role: "Parent supporter",
    readiness: "Ready fixture",
    consent: "Fixture opt-in noted; real consent record not imported",
    check: "Confirm current school-street timing before real use",
    nextAction: "Good for reviewed supporter email in this local demo",
    owner: "Campaigner",
  },
  {
    id: "johnson",
    name: "R. Johnson",
    segmentId: "school_gates",
    segment: "School-gate families",
    role: "Crossing volunteer",
    readiness: "Review first",
    consent: "Fixture relationship only",
    check: "Ask whether they want a public quote before escalation",
    nextAction: "Keep in review set; do not use for press outline yet",
    owner: "Local organiser",
  },
  {
    id: "davies",
    name: "M. Davies",
    segmentId: "ward_parents",
    segment: "Nearby ward parents",
    role: "Neighbourhood parent",
    readiness: "Ready fixture",
    consent: "Fixture postcode-level relevance; live import missing",
    check: "Verify ward relevance before a real provider list exists",
    nextAction: "Useful for broader supporter framing after review",
    owner: "Campaigner",
  },
  {
    id: "hussain",
    name: "S. Hussain",
    segmentId: "ward_parents",
    segment: "Nearby ward parents",
    role: "Resident supporter",
    readiness: "Blocked",
    consent: "No live consent source in this demo",
    check: "Needs real import and deduplication before use",
    nextAction: "Exclude from any provider list until import exists",
    owner: "Campaigner",
  },
  {
    id: "clean-air",
    name: "Clean Air Leicester",
    segmentId: "local_allies",
    segment: "Local allies and councillor watchers",
    role: "Ally organisation",
    readiness: "Review first",
    consent: "Organisation relationship is fixture-only",
    check: "Confirm named contact and escalation appetite before real use",
    nextAction: "Ask to review process risks before public escalation",
    owner: "Local organiser",
  },
  {
    id: "casework",
    name: "Ward casework watcher",
    segmentId: "local_allies",
    segment: "Local allies and councillor watchers",
    role: "Council-process watcher",
    readiness: "Blocked",
    consent: "Import and permission path coming soon",
    check: "Find a named, permissioned contact before outreach",
    nextAction: "Use as a reminder, not as a contact record",
    owner: "Campaigner",
  },
];

const draftLibrary: DraftLibraryItem[] = [
  {
    id: "supporter_email",
    title: "Supporter email",
    channel: "Email",
    state: "Editable",
    detail: "Working local draft for the selected audience, with compose and preview saved in this browser.",
    audience: "Selected audience segment",
    requires: "Human message review, evidence warnings understood, and explicit approval before local queueing.",
    outline: ["Invite local supporters to back the permanent school street.", "Ask for one local reason families support the change.", "Keep council timing and consent checks visible before real use."],
  },
  {
    id: "decision_maker_letter",
    title: "Decision-maker letter",
    channel: "Letter",
    state: "Staged fixture",
    detail: "Structured outline for the council route; not editable until the formal decision path is checked.",
    audience: "Council decision route, exact recipient not verified",
    requires: "Confirm order status, committee or officer ownership, legal wording, and sign-off route.",
    outline: ["Name the narrow ask: permanent, enforceable school-street decision.", "Show parent support only after consent-safe evidence is ready.", "Request the documented next step without overstating authority."],
  },
  {
    id: "press_pitch",
    title: "Press pitch",
    channel: "Media",
    state: "Staged fixture",
    detail: "Media prompt for later escalation; no newsroom contact list or provider is connected.",
    audience: "Local media and community reporters, not imported",
    requires: "Verify public claims, decide whether escalation helps the strategy, and confirm media contacts.",
    outline: ["Lead with safer school-run streets and the pending decision moment.", "Offer a campaigner voice only after human consent.", "Avoid implying council failure until evidence is checked."],
  },
];

const campaignContext = {
  brief: {
    title: "Campaign brief",
    intro:
      "Seeded school-street campaign brief, shown as fixture context rather than verified current research. Each section points to the operational work it should influence.",
    rows: [
      {
        label: "Outcome",
        detail: "Make the school street outside St John the Baptist CofE Primary permanent and enforced.",
        use: "Keep the ask narrow in supporter copy and the later decision-maker letter.",
        owner: "Campaigner",
      },
      {
        label: "Place",
        detail: "Leicester; school-run streets around St John the Baptist CofE Primary.",
        use: "Anchor audience selection to families and nearby ward parents before broader ally outreach.",
        owner: "Local organiser",
      },
      {
        label: "Narrative",
        detail: "Safer routes, cleaner air, and a council decision route parents can understand before the order lapses.",
        use: "Use this language in the editable supporter email, with the timing claim checked first.",
        owner: "Reviewer",
      },
      {
        label: "Provenance",
        detail: "Local fixture state for the OpenClaw Build Reveal; campaigners must verify current council process before real use.",
        use: "Keep demo/local truth labels visible across review and queue steps.",
        owner: "Workbench",
      },
    ],
  },
  objectives: {
    title: "Objective & targets",
    intro: "The target map keeps political decisions human-readable before drafting or approval.",
    rows: [
      {
        label: "Primary objective",
        detail: "Secure a permanent, enforced school-street decision before the experimental order lapses.",
        use: "Use as the subject-line spine and as the first review check.",
        owner: "Campaigner",
      },
      {
        label: "Decision-maker",
        detail: "Leicester City Council transport decision route; exact committee/officer path needs verification.",
        use: "Blocks the staged decision-maker letter until the formal route is checked.",
        owner: "Reviewer",
      },
      {
        label: "Influence targets",
        detail: "School leadership, ward councillors, nearby parents, clean-air allies, and local media only after review.",
        use: "Shapes the audience sequence and explains why supporter email comes before press work.",
        owner: "Local organiser",
      },
    ],
  },
  power: {
    title: "Power map",
    intro: "A plain map of who can help, block, or be persuaded without pretending fixture contacts are live campaign intelligence.",
    rows: [
      {
        label: "Allies",
        detail: "School-gate families, clean-air supporters, and councillor watchers who can validate local concerns.",
        use: "Start with the selected audience, then ask allies to check process risks before escalation.",
        owner: "Campaigner",
      },
      {
        label: "Persuadables",
        detail: "Nearby parents and ward residents affected by traffic but not yet involved.",
        use: "Use the ward-parents segment when copy needs broader neighbourhood framing.",
        owner: "Local organiser",
      },
      {
        label: "Potential blockers",
        detail: "Implementation cost concerns, enforcement doubts, and objections from through-traffic users.",
        use: "Keep the review gate focused on claims that could be challenged publicly.",
        owner: "Reviewer",
      },
    ],
  },
  strategy: {
    title: "Strategy & tactics",
    intro: "The campaign sequence connects the brief to reviewable communications work and keeps owners visible.",
    rows: [
      {
        label: "1. Verify route",
        detail: "Confirm order status, lapse timing, and who can make the permanent decision.",
        use: "Must happen before approving decision-maker or press materials.",
        owner: "Reviewer",
      },
      {
        label: "2. Build support",
        detail: "Invite school-gate families and nearby parents to record support and local reasons.",
        use: "This is the working supporter-email flow in Drafts and Reviews.",
        owner: "Campaigner",
      },
      {
        label: "3. Escalate carefully",
        detail: "Brief allies and prepare decision-maker contact only after evidence and consent checks are clear.",
        use: "Keeps staged draft types honest until they can be reviewed.",
        owner: "Local organiser",
      },
    ],
  },
  evidence: {
    title: "Evidence & checks",
    intro: "Claims stay visible until a person is comfortable with them; approval is blocked by judgement, not automation.",
    rows: [
      {
        label: "Council timing",
        detail: "Verify current order status and the deadline before using the draft externally.",
        use: "Mentioned in the review warning and should be checked before provider setup.",
        owner: "Reviewer",
      },
      {
        label: "Legal wording",
        detail: "Confirm the exact school-street order language and enforcement route.",
        use: "Prevents overclaiming in the supporter email and later formal letter.",
        owner: "Reviewer",
      },
      {
        label: "Contact consent",
        detail: "Fixture contacts are not a live consent record; import and reconciliation are Coming soon.",
        use: "Explains why outbox remains local and provider connection stays disabled.",
        owner: "Local organiser",
      },
    ],
  },
} satisfies Record<"brief" | "objectives" | "power" | "strategy" | "evidence", { title: string; intro: string; rows: CampaignContextRow[] }>;

const viewIds: ViewId[] = [
  "overview",
  "brief",
  "objectives",
  "power",
  "strategy",
  "evidence",
  "audiences",
  "contacts",
  "drafts",
  "reviews",
  "outbox",
  "responses",
];

const initialState: DemoState = {
  selectedSegment: "school_gates",
  subject: "Make the St John the Baptist school street permanent",
  body:
    "Hello,\n\nWe are asking Leicester City Council to make the school street outside St John the Baptist CofE Primary permanent, with clear enforcement before the experimental order lapses.\n\nThe campaign is focused on safer school-run streets, cleaner air at the gates, and a decision route parents can follow. If you support the permanent order, please add your name to the campaign update and share one local reason this matters to your family.\n\nBefore any provider connection is used, a campaigner should check the council timing, the wording of the order, and whether this message fits your contact consent records.\n\nThank you,\nCampaign Factory demo workspace",
  status: "draft",
  mode: "compose",
  activeDraft: "supporter_email",
  activeView: "overview",
  contactFilter: "all",
  contactReadinessFilter: "all",
  scheduleIntent: "after_approval",
  queuedAt: null,
  activity: [{ id: "seed", label: "Demo workspace loaded with seeded campaign brief and local fixture contacts." }],
};

const statusCopy: Record<DraftStatus, { label: string; text: string }> = {
  draft: {
    label: "Draft",
    text: "Editable local draft. It has not been reviewed or queued.",
  },
  review: {
    label: "Needs human review",
    text: "A campaigner has marked this draft ready for checking. External action is still blocked.",
  },
  approved: {
    label: "Approved by human",
    text: "Approved for the demo queue only. Provider connection is not active.",
  },
  queued: {
    label: "Queued for demo",
    text: "Stored in this browser as a local demo queue item. Provider connection is off.",
  },
};

const stageStatusCopy: Record<StageStatus, string> = {
  complete: "Complete",
  current: "Current",
  blocked: "Blocked",
  soon: "Coming soon boundary",
};

const stageClass: Record<StageStatus, string> = {
  complete: "ops-stage-complete",
  current: "ops-stage-current",
  blocked: "ops-stage-blocked",
  soon: "ops-stage-soon",
};

function normaliseState(parsed: Partial<DemoState>): DemoState {
  return {
    ...initialState,
    ...parsed,
    selectedSegment: segments.some((segment) => segment.id === parsed.selectedSegment)
      ? (parsed.selectedSegment as SegmentId)
      : initialState.selectedSegment,
    status: ["draft", "review", "approved", "queued"].includes(parsed.status || "")
      ? (parsed.status as DraftStatus)
      : initialState.status,
    activeDraft: draftLibrary.some((draft) => draft.id === parsed.activeDraft)
      ? (parsed.activeDraft as DraftId)
      : initialState.activeDraft,
    activeView: viewIds.includes(parsed.activeView as ViewId) ? (parsed.activeView as ViewId) : "overview",
    contactFilter:
      parsed.contactFilter === "all" || segments.some((segment) => segment.id === parsed.contactFilter)
        ? (parsed.contactFilter as SegmentId | "all")
        : initialState.contactFilter,
    contactReadinessFilter: ["all", "ready", "review", "blocked"].includes(parsed.contactReadinessFilter || "")
      ? (parsed.contactReadinessFilter as DemoState["contactReadinessFilter"])
      : initialState.contactReadinessFilter,
    scheduleIntent: ["after_approval", "tomorrow_morning", "school_run"].includes(parsed.scheduleIntent || "")
      ? (parsed.scheduleIntent as DemoState["scheduleIntent"])
      : initialState.scheduleIntent,
    activity: parsed.activity?.length ? parsed.activity : initialState.activity,
    mode: parsed.mode === "preview" ? "preview" : "compose",
  };
}

function loadState(): DemoState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    if (!parsed.subject || !parsed.body || !parsed.selectedSegment) return initialState;
    return normaliseState(parsed);
  } catch {
    return initialState;
  }
}

function record(label: string): Activity {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, label };
}

function formatQueuedTime(value: string | null) {
  if (!value) return "Not queued";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[var(--r-2xl)] border border-border bg-background p-5 ${className}`}>{children}</section>;
}

function SmallLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{children}</p>;
}

export function OperationsWorkspace() {
  const [state, setState] = useState<DemoState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setState(loadState());
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  }, [hydrated, state]);

  const selected = useMemo(
    () => segments.find((segment) => segment.id === state.selectedSegment) ?? segments[0],
    [state.selectedSegment],
  );

  const status = statusCopy[state.status];
  const activeDraft = draftLibrary.find((draft) => draft.id === state.activeDraft) ?? draftLibrary[0];
  const activeDraftEditable = activeDraft.id === "supporter_email";
  const canRequestReview = state.subject.trim().length > 8 && state.body.trim().length > 80;
  const reviewBlocked = !canRequestReview;
  const queuedCount = state.status === "queued" ? "1" : undefined;
  const reviewBadge = state.status === "review" ? "1" : undefined;
  const readinessMatches = (contact: ContactFixture) => {
    if (state.contactReadinessFilter === "all") return true;
    if (state.contactReadinessFilter === "ready") return contact.readiness === "Ready fixture";
    if (state.contactReadinessFilter === "review") return contact.readiness === "Review first";
    return contact.readiness === "Blocked";
  };
  const filteredContacts = contacts.filter(
    (contact) => (state.contactFilter === "all" || contact.segmentId === state.contactFilter) && readinessMatches(contact),
  );
  const selectedSegmentContacts = contacts.filter((contact) => contact.segmentId === selected.id);
  const readyContactCount = contacts.filter((contact) => contact.readiness === "Ready fixture").length;
  const reviewContactCount = contacts.filter((contact) => contact.readiness === "Review first").length;
  const blockedContactCount = contacts.filter((contact) => contact.readiness === "Blocked").length;
  const scheduleCopy: Record<DemoState["scheduleIntent"], string> = {
    after_approval: "Hold until a campaigner connects a provider after review",
    tomorrow_morning: "Demo intent: next school-run morning after provider setup",
    school_run: "Demo intent: school-run reminder window after consent import",
  };
  const runwayStages: RunwayStage[] = [
    {
      label: "Brief",
      view: "brief",
      status: "complete",
      statusLabel: "Fixture brief loaded",
      detail: "Outcome, place, and provenance are visible before any communication work starts.",
    },
    {
      label: "Evidence",
      view: "evidence",
      status: state.status === "review" || state.status === "approved" || state.status === "queued" ? "complete" : "current",
      statusLabel: state.status === "draft" ? "Checks in view" : "Checks understood",
      detail: "Council timing, legal wording, and contact consent stay attached to review.",
    },
    {
      label: "Audience",
      view: "audiences",
      status: selected.ready > 0 ? "complete" : "blocked",
      statusLabel: `${selected.name}: ${selected.ready}/${selected.contacts} ready fixtures`,
      detail: "The selected segment follows Drafts, Reviews, and the local queue.",
    },
    {
      label: "Draft",
      view: "drafts",
      status: !canRequestReview ? "blocked" : state.status === "draft" ? "current" : "complete",
      statusLabel: !canRequestReview ? "Needs copy" : status.label,
      detail: activeDraftEditable ? "Supporter email is editable and saved in this browser." : "Staged fixture; not available for approval.",
    },
    {
      label: "Human approval",
      view: "reviews",
      status: state.status === "approved" || state.status === "queued" ? "complete" : state.status === "review" ? "current" : "blocked",
      statusLabel: state.status === "approved" || state.status === "queued" ? "Approved by human" : state.status === "review" ? "Waiting for approval" : "Required before queue",
      detail: "A person must explicitly approve before anything enters the local demo queue.",
    },
    {
      label: "Local outbox",
      view: "outbox",
      status: state.status === "queued" ? "complete" : state.status === "approved" ? "current" : "soon",
      statusLabel: state.status === "queued" ? "Queued for demo" : state.status === "approved" ? "Ready to queue locally" : "Provider off",
      detail: state.status === "queued" ? "Stored locally in this browser; no provider used." : "Local queue only; production scheduling and provider connection remain off.",
    },
  ];

  const navGroups: { title: string; items: NavItem[] }[] = [
    {
      title: "Campaign",
      items: [
        { id: "overview", label: "Overview", note: "Today’s work and next decision" },
        { id: "brief", label: "Campaign brief", note: "Outcome, place, provenance" },
        { id: "objectives", label: "Objective & targets", note: "Decision-maker and influences" },
        { id: "power", label: "Power map", note: "Allies, blockers, persuadables" },
        { id: "strategy", label: "Strategy & tactics", note: "Pressure sequence and owners" },
        { id: "evidence", label: "Evidence & checks", note: "Claims needing verification" },
      ],
    },
    {
      title: "People",
      items: [
        { id: "audiences", label: "Audiences", note: "Segments and readiness" },
        { id: "contacts", label: "Contacts", note: "Fixture contact list" },
      ],
    },
    {
      title: "Communications",
      items: [
        { id: "drafts", label: "Drafts", note: "Library, editor, preview" },
        { id: "reviews", label: "Reviews & approvals", note: "Human approval gate", badge: reviewBadge },
        { id: "outbox", label: "Outbox & schedule", note: "Local queue boundary", badge: queuedCount },
        { id: "responses", label: "Responses & results", note: "Coming soon boundary" },
      ],
    },
  ];

  const setView = (activeView: ViewId) => {
    setState((current) => ({ ...current, activeView }));
  };

  const setActiveDraft = (activeDraft: DraftId) => {
    setState((current) => ({
      ...current,
      activeDraft,
      activity:
        current.activeDraft === activeDraft
          ? current.activity
          : [record(`Opened draft library item: ${draftLibrary.find((draft) => draft.id === activeDraft)?.title ?? "Draft"}.`), ...current.activity].slice(0, 7),
    }));
  };

  const updateDraft = (patch: Partial<Pick<DemoState, "subject" | "body">>) => {
    setState((current) => ({
      ...current,
      ...patch,
      status: current.status === "approved" || current.status === "queued" ? "draft" : current.status,
      queuedAt: current.status === "queued" ? null : current.queuedAt,
      activity:
        current.status === "approved" || current.status === "queued"
          ? [record("Edited communication copy; approval and local queue state were cleared for re-review."), ...current.activity].slice(0, 7)
          : current.activity,
    }));
  };

  const selectSegment = (segment: Segment) => {
    setState((current) => ({
      ...current,
      selectedSegment: segment.id,
      contactFilter: segment.id,
      status: current.status === "approved" || current.status === "queued" ? "draft" : current.status,
      queuedAt: current.status === "queued" ? null : current.queuedAt,
      activity: [record(`Selected audience segment: ${segment.name}.`), ...current.activity].slice(0, 7),
    }));
  };

  const requestReview = () => {
    setState((current) => ({
      ...current,
      status: "review",
      activeView: "reviews",
      activity: [record("Marked the draft ready for human review."), ...current.activity].slice(0, 7),
    }));
  };

  const approve = () => {
    setState((current) => ({
      ...current,
      status: "approved",
      activity: [record("Human approval recorded for this local demo draft."), ...current.activity].slice(0, 7),
    }));
  };

  const queue = () => {
    setState((current) => ({
      ...current,
      status: "queued",
      activeView: "outbox",
      queuedAt: new Date().toISOString(),
      activity: [record("Placed approved draft into the local demo queue. No provider connection used."), ...current.activity].slice(0, 7),
    }));
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    setState({
      ...initialState,
      activity: [record("Demo state reset to the seeded campaign workspace."), ...initialState.activity],
    });
  };

  const renderNav = (compact = false, ink = false) => (
    <nav aria-label="Campaign operations views" className="space-y-6">
      {navGroups.map((group) => (
        <div key={group.title}>
          <div className={`mb-2 px-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] ${ink ? "text-white/55" : "text-muted-foreground"}`}>
            {group.title}
          </div>
          <div className={compact ? "grid gap-2 sm:grid-cols-2" : "space-y-1"}>
            {group.items.map((item) => {
              const active = state.activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`ops-nav-button w-full rounded-[var(--r-xl)] border px-3 text-left motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out ${ink ? "py-2" : "py-2.5"} ${
                    active
                      ? ink
                        ? "border-white/15 bg-ops-yellow text-ops-ink shadow-sm"
                        : "border-foreground bg-foreground text-background"
                      : ink
                        ? "border-transparent text-white/88 hover:border-white/15 hover:bg-white/[0.08]"
                        : "border-transparent text-foreground hover:border-border hover:bg-secondary"
                  }`}
                  aria-current={active ? "page" : undefined}
                  aria-label={`${item.label}: ${active ? "Current view" : "Open view"}, ${item.note}${item.badge ? `, ${item.badge} item${item.badge === "1" ? "" : "s"}` : ""}`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {item.label}
                    {item.badge ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-background text-foreground" : ink ? "bg-ops-coral text-ops-ink" : "bg-tint-yellow text-foreground"}`}>
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                  {ink ? null : (
                    <span className={`mt-0.5 block text-xs ${active ? "text-background/75" : "text-muted-foreground"}`}>{item.note}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const goButton = (view: ViewId, label: string) => (
    <Button type="button" variant="outline" onClick={() => setView(view)}>
      {label}
    </Button>
  );

  const renderAudienceView = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
      <Panel>
        <SmallLabel>Audiences</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Choose the contact set</h2>
        <p className="mt-3 text-muted-foreground">
          The selected segment follows the draft, review, and queue views. Counts are fixture contacts for this browser demo.
        </p>
        <p className="mt-4 rounded-[var(--r-xl)] bg-tint-yellow px-4 py-3 text-sm">
          Real import and consent matching are <span className="font-semibold">Coming soon</span>; this view does not contact people.
        </p>
      </Panel>
      <div className="space-y-3" role="list" aria-label="Audience segments">
        {segments.map((segment) => {
          const active = segment.id === selected.id;
          return (
            <button
              key={segment.id}
              type="button"
              onClick={() => selectSegment(segment)}
              className={`w-full rounded-[var(--r-2xl)] border p-4 text-left motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ops-ink focus-visible:ring-0 ${
                active ? "border-foreground bg-tint-blue" : "border-border bg-background hover:bg-secondary"
              }`}
              aria-pressed={active}
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-base font-medium">{segment.name}</span>
                  <span className="block text-sm text-muted-foreground">{segment.role}</span>
                </span>
                <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs">
                  {segment.contacts} fixture contacts
                </span>
              </span>
              <span className="mt-3 block text-sm text-muted-foreground">{segment.readiness}</span>
              <span className="mt-2 block text-sm">{segment.ask}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderDraftsView = () => (
    <div className="grid gap-5 xl:grid-cols-[285px_minmax(0,1fr)_275px]">
      <Panel className="bg-ops-ink text-white">
        <SmallLabel>Draft library</SmallLabel>
        <h2 className="mt-2 text-2xl font-medium tracking-tight">Communications</h2>
        <p className="mt-2 text-sm text-white/65">
          An editorial desk for the outreach sequence. Only the supporter email is working/editable in this local demo.
        </p>
        <div className="mt-5 space-y-3">
          {draftLibrary.map((draft, index) => (
            <button
              key={draft.id}
              type="button"
              onClick={() => setActiveDraft(draft.id)}
              className={`w-full rounded-[var(--r-xl)] border p-3 text-left motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ops-yellow focus-visible:ring-0 ${
                state.activeDraft === draft.id ? "border-ops-yellow bg-ops-yellow text-ops-ink" : "border-white/15 bg-white/[0.07] text-white hover:bg-white/[0.12]"
              }`}
              aria-pressed={state.activeDraft === draft.id}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{index + 1}. {draft.title}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs ${state.activeDraft === draft.id ? "bg-background/70" : "bg-white/10"}`}>{draft.id === "supporter_email" ? status.label : draft.state}</span>
              </div>
              <p className={`mt-1 text-xs font-semibold uppercase tracking-[0.1em] ${state.activeDraft === draft.id ? "text-ops-ink/65" : "text-white/50"}`}>{draft.channel}</p>
              <p className={`mt-1 text-sm ${state.activeDraft === draft.id ? "text-ops-ink/75" : "text-white/[0.62]"}`}>{draft.detail}</p>
            </button>
          ))}
        </div>
      </Panel>
      <Panel className="bg-[linear-gradient(90deg,oklch(0.96_0.012_82)_0_1px,transparent_1px),linear-gradient(oklch(0.96_0.012_82)_0_1px,transparent_1px)] bg-[size:28px_28px] shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <SmallLabel>{activeDraft.channel} draft</SmallLabel>
            <h2 className="mt-1 text-3xl font-medium tracking-tight">
              {activeDraftEditable ? `Parent update for ${selected.name.toLowerCase()}` : activeDraft.title}
            </h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              {activeDraftEditable ? selected.ask : activeDraft.detail}
            </p>
          </div>
          <div className="flex rounded-full border border-border bg-background p-1" aria-label="Draft mode">
            {(["compose", "preview"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setState((current) => ({ ...current, mode }))}
                disabled={!activeDraftEditable}
                className={`rounded-full px-4 py-1.5 text-sm capitalize motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  state.mode === mode && activeDraftEditable ? "bg-ops-ink text-white" : "text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                }`}
                aria-pressed={state.mode === mode}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-[var(--r-2xl)] border border-dashed border-[var(--ring)] bg-ops-yellow/45 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Review warning:</span> {activeDraft.requires} {activeDraftEditable ? selected.caveat : "This staged fixture is not available for approval or queueing."}
        </div>

        {!activeDraftEditable ? (
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-[var(--r-2xl)] border border-border bg-white p-6 shadow-sm">
              <SmallLabel>Staged outline</SmallLabel>
              <h3 className="mt-2 text-2xl font-medium">{activeDraft.title}</h3>
              <p className="mt-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">Intended audience:</span> {activeDraft.audience}</p>
              <ol className="mt-5 space-y-3 text-sm">
                {activeDraft.outline.map((item, index) => (
                  <li key={item} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ops-blue text-xs font-semibold">{index + 1}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-[var(--r-2xl)] border border-border bg-background/80 p-4 text-sm">
              <p className="font-medium">Why this is not editable yet</p>
              <p className="mt-2 text-muted-foreground">Campaign Factory can show the operational placeholder, but real recipients, evidence, and escalation judgement must be resolved before this item becomes working copy.</p>
              <div className="mt-4 flex flex-col gap-3">
                {goButton("evidence", "Review checks")}
                {goButton("contacts", "Inspect contacts")}
              </div>
            </div>
          </div>
        ) : state.mode === "compose" ? (
          <div className="mt-6 space-y-5 rounded-[var(--r-2xl)] border border-border bg-background p-5 shadow-sm">
            <div className="space-y-2">
              <Label htmlFor="operations-subject">Subject</Label>
              <Input
                id="operations-subject"
                value={state.subject}
                onChange={(event) => updateDraft({ subject: event.target.value })}
                className="h-auto rounded-full border-[1.5px] px-4 py-2.5 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="operations-body">Message</Label>
              <Textarea
                id="operations-body"
                value={state.body}
                onChange={(event) => updateDraft({ body: event.target.value })}
                rows={13}
                className="min-h-[22rem] rounded-[var(--r-2xl)] border-[1.5px] p-4 text-base leading-relaxed"
              />
            </div>
          </div>
        ) : (
          <article className="mt-6 rounded-[var(--r-2xl)] border border-border bg-white p-6 shadow-sm">
            <div className="border-b border-border pb-4 text-sm text-muted-foreground">
              <p><span className="font-medium text-foreground">To:</span> {selected.name} · {selected.ready} ready fixture contacts</p>
              <p><span className="font-medium text-foreground">Status:</span> {status.label}</p>
            </div>
            <h3 className="mt-5 text-2xl font-medium">{state.subject || "Untitled campaign email"}</h3>
            <div className="mt-4 whitespace-pre-wrap text-base leading-relaxed">{state.body}</div>
          </article>
        )}

        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
          <Button type="button" size="lg" onClick={requestReview} disabled={!activeDraftEditable || !canRequestReview || state.status === "review" || state.status === "approved" || state.status === "queued"}>
            Mark ready for review
          </Button>
          {goButton("reviews", "Open review gate")}
        </div>
      </Panel>
      <Panel className="bg-ops-blue/[0.65]">
        <SmallLabel>Desk notes</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Copy follows the runway</h3>
        <div className="mt-5 space-y-4 text-sm">
          <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3">
            <p className="font-medium">Audience</p>
            <p className="mt-1 text-muted-foreground">{selected.name}: {selected.ready}/{selected.contacts} ready fixtures.</p>
          </div>
          <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3">
            <p className="font-medium">Approval state</p>
            <p className="mt-1 text-muted-foreground">{status.text}</p>
          </div>
          <div className="rounded-[var(--r-xl)] border border-ops-line bg-background/75 p-3">
            <p className="font-medium">Boundary</p>
            <p className="mt-1 text-muted-foreground">Provider, import, and production scheduling are not connected.</p>
          </div>
        </div>
      </Panel>
    </div>
  );

  const renderReviewView = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.65fr)]">
      <Panel className="bg-ops-paper">
        <SmallLabel>Reviews & approvals</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Human approval gate</h2>
        <p className="mt-3 text-muted-foreground">
          A draft cannot enter the local queue until a person explicitly approves it. Blockers are shown in text, not just colour.
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-2" aria-label="Approval gates">
          {[
            { label: "Message has enough substance to review", ok: canRequestReview, detail: canRequestReview ? "Subject and body are long enough for a meaningful check." : "Add a clear subject and message before requesting review." },
            { label: "Audience readiness understood", ok: selected.ready > 0, detail: `${selected.ready}/${selected.contacts} selected fixture contacts are marked ready.` },
            { label: "Evidence checks still visible", ok: true, detail: "Council timing, legal-order wording, and consent remain called out before any real provider use." },
            { label: "External action blocked", ok: true, detail: "Provider connection is not active; approval only unlocks the local demo queue." },
          ].map((item) => (
            <div key={item.label} className={`rounded-[var(--r-xl)] border p-4 motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${item.ok ? "border-ops-line bg-background" : "border-ops-coral bg-ops-coral/[0.55]"}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{item.label}</p>
                <span className={`rounded-full px-2.5 py-1 text-xs ${item.ok ? "bg-ops-mint" : "bg-background"}`}>
                  {item.ok ? "Clear" : "Blocked"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
          <Button type="button" size="lg" onClick={requestReview} disabled={!canRequestReview || state.status === "review" || state.status === "approved" || state.status === "queued"}>
            Mark ready for review
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={approve} disabled={state.status !== "review"}>
            Approve as human reviewer
          </Button>
          <Button type="button" size="lg" variant="secondary" onClick={queue} disabled={state.status !== "approved"}>
            Queue locally for demo
          </Button>
        </div>
      </Panel>
      <Panel className="bg-ops-ink text-white">
        <SmallLabel>Current review item</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">{status.label}</h3>
        <p className="mt-3 text-sm text-white/65">{status.text}</p>
        {reviewBlocked ? (
          <p className="mt-4 rounded-[var(--r-xl)] bg-ops-coral px-4 py-3 text-sm text-ops-ink">
            Blocked: the supporter email needs enough copy before it can be checked.
          </p>
        ) : null}
        <article className="mt-5 rounded-[var(--r-xl)] border border-white/15 bg-white p-4 text-sm text-foreground shadow-sm" aria-label="Communication preview for approval">
          <p className="font-medium">{state.subject || "Untitled campaign email"}</p>
          <p className="mt-1 text-muted-foreground">Audience: {selected.name}</p>
          <div className="mt-4 line-clamp-6 whitespace-pre-wrap border-t border-border pt-4 text-muted-foreground">{state.body}</div>
        </article>
        <div className="mt-5 rounded-[var(--r-xl)] border border-white/15 bg-white/[0.08] p-3 text-sm">
          <p className="font-medium">Approval desk rule</p>
          <p className="mt-1 text-white/60">Human approval changes only this browser-local workflow. It never connects the provider.</p>
        </div>
      </Panel>
    </div>
  );

  const renderOutboxView = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="bg-ops-paper">
        <SmallLabel>Outbox & schedule</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">{state.status === "queued" ? "One local queue item" : "Nothing queued yet"}</h2>
        <p id="operations-provider-note" className="mt-3 text-muted-foreground">
          {state.status === "queued"
            ? "The approved draft is stored in this browser for the conference demo. It is not connected to an email provider."
            : "Approve the draft before it can enter the local demo queue. Provider outreach stays disabled."}
        </p>
        <div className="mt-6 rounded-[var(--r-2xl)] border border-border bg-background p-4">
          <SmallLabel>Local dispatch runway</SmallLabel>
          <div className="mt-4 grid gap-3 md:grid-cols-4" aria-label="Local dispatch runway">
            {[
              { label: "Human approval", state: state.status === "draft" ? "Blocked" : state.status === "review" ? "Current" : "Complete", tone: state.status === "draft" ? "bg-ops-coral" : state.status === "review" ? "bg-ops-yellow" : "bg-ops-mint", detail: status.label },
              { label: "Local queue", state: state.status === "queued" ? "Complete" : state.status === "approved" ? "Current" : "Locked", tone: state.status === "queued" ? "bg-ops-mint" : state.status === "approved" ? "bg-ops-yellow" : "bg-ops-blue", detail: state.status === "queued" ? "Stored in this browser" : "Needs approval first" },
              { label: "Provider", state: "Locked", tone: "bg-ops-blue", detail: "Coming soon · not connected" },
              { label: "Responses", state: "Locked", tone: "bg-ops-blue", detail: "Coming soon · no response stream" },
            ].map((step, index) => (
              <div key={step.label} className={`rounded-[var(--r-xl)] border border-ops-line p-4 motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${step.tone}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/70 text-xs font-semibold">{index + 1}</span>
                  <span className="text-xs font-semibold uppercase tracking-[0.1em]">{step.state}</span>
                </div>
                <p className="mt-4 font-medium">{step.label}</p>
                <p className="mt-1 text-sm text-ops-ink/70">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded-[var(--r-2xl)] border border-border bg-background">
          <div className="hidden grid-cols-[1.1fr_0.8fr_0.7fr_0.8fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
            <span>Communication</span><span>Audience</span><span>State</span><span>Local timing</span>
          </div>
          {state.status === "queued" ? (
            <div className="grid gap-3 px-4 py-4 text-sm md:grid-cols-[1.1fr_0.8fr_0.7fr_0.8fr]">
              <div><span className="md:hidden font-medium">Communication: </span>{state.subject}</div>
              <div><span className="md:hidden font-medium">Audience: </span>{selected.name}</div>
              <div><span className="md:hidden font-medium">State: </span>Queued for demo</div>
              <div><span className="md:hidden font-medium">Local timing: </span>{formatQueuedTime(state.queuedAt)} · {scheduleCopy[state.scheduleIntent]}</div>
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No local queue rows yet. Use the Reviews & approvals view to record human approval first.
            </div>
          )}
        </div>
        <button
          type="button"
          disabled
          aria-describedby="operations-provider-note"
          className="mt-5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground opacity-70"
          title="Provider connection is coming soon; this demo does not use email outreach."
        >
          Email provider · Coming soon
        </button>
      </Panel>
      <Panel>
        <SmallLabel>Scheduling boundary</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Local intent only</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Production scheduling is not connected. This workbench can show what a campaigner intends to prepare, but it cannot place work onto a live provider calendar.
        </p>
        <div className="mt-5 space-y-2">
          <Label htmlFor="operations-schedule-intent">Local schedule intent</Label>
          <select
            id="operations-schedule-intent"
            value={state.scheduleIntent}
            onChange={(event) => setState((current) => ({ ...current, scheduleIntent: event.target.value as DemoState["scheduleIntent"] }))}
            className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="after_approval">Hold after approval</option>
            <option value="tomorrow_morning">Next school-run morning</option>
            <option value="school_run">School-run reminder window</option>
          </select>
          <p className="text-sm text-muted-foreground">{scheduleCopy[state.scheduleIntent]}</p>
        </div>
        <Button type="button" variant="outline" disabled className="mt-4" title="Production scheduling is coming soon and is not connected in this demo.">
          Production scheduler · Coming soon
        </Button>
        <Button type="button" variant="ghost" className="mt-5" onClick={reset}>
          Reset demo state
        </Button>
      </Panel>
    </div>
  );

  const renderRunway = () => (
    <section aria-labelledby="campaign-runway-title" className="rounded-[var(--r-3xl)] bg-ops-ink p-2 text-ops-ink shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 px-3 pb-3 pt-2 text-white">
        <div>
          <SmallLabel>Campaign Runway</SmallLabel>
          <h2 id="campaign-runway-title" className="mt-1 text-2xl font-medium tracking-tight sm:text-3xl">
            Brief to safe local outbox, one stage at a time.
          </h2>
        </div>
        <p className="max-w-md text-sm text-white/65">
          Every node is derived from fixture/local state. Select a stage to work there; no provider action is connected.
        </p>
      </div>
      <div className="ops-runway" role="list" aria-label="Six-stage campaign runway">
        {runwayStages.map((stage, index) => (
          <button
            key={stage.label}
            type="button"
            onClick={() => setView(stage.view)}
            className={`ops-runway-stage ${stageClass[stage.status]}`}
            aria-label={`${stage.label}: ${stageStatusCopy[stage.status]}, ${stage.statusLabel}`}
          >
            <span className="flex items-center gap-3" aria-hidden="true">
              <span className="ops-stage-node">{index + 1}</span>
              {index < runwayStages.length - 1 ? <span className="ops-stage-line" /> : null}
            </span>
            <span className="mt-4 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ops-ink/65">
              {stageStatusCopy[stage.status]}
            </span>
            <span className="mt-1 block text-xl font-medium tracking-tight">{stage.label}</span>
            <span className="mt-2 block text-sm font-semibold">{stage.statusLabel}</span>
            <span className="mt-3 block text-sm leading-snug text-ops-ink/72">{stage.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );

  const renderOverview = () => (
    <div className="space-y-5">
      <Panel className="bg-ops-paper">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
          <SmallLabel>Today</SmallLabel>
          <h1 className="mt-2 max-w-3xl text-4xl font-medium tracking-tight sm:text-5xl">
            Make the St John the Baptist school street <span className="font-serif font-normal italic">permanent</span> before the order lapses.
          </h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            The workbench keeps the campaign brief, audience choice, draft copy, review gate, and local queue in one place. Fixture data is labelled; real provider and import steps remain off.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {goButton("audiences", `Audience: ${selected.name}`)}
            {goButton("drafts", `Draft: ${status.label}`)}
            {goButton("reviews", state.status === "review" ? "Approve now" : "Open approval gate")}
            {goButton("outbox", state.status === "queued" ? "Inspect local queue" : "Outbox locked")}
          </div>
          </div>
          <div className="rounded-[var(--r-2xl)] border border-ops-line bg-background/80 p-4">
            <SmallLabel>Next human decision</SmallLabel>
            <h2 className="mt-2 text-2xl font-medium">Approve only after the claim checks are understood.</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Council timing, legal-order wording, and contact consent are the key checks before any real provider connection is considered.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">{goButton("reviews", "Open reviews")}{goButton("evidence", "See checks")}</div>
          </div>
        </div>
      </Panel>
      {renderRunway()}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Panel className="bg-ops-blue/70">
          <SmallLabel>Current communications</SmallLabel>
          <h2 className="mt-2 text-2xl font-medium">{status.label}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{status.text}</p>
          <div className="mt-5 flex flex-wrap gap-3">{goButton("drafts", "Edit draft")}{goButton("outbox", "Open outbox")}</div>
        </Panel>
        <Panel className="bg-background">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SmallLabel>Field notes from this browser</SmallLabel>
              <p className="mt-2 text-sm text-muted-foreground">Only genuine local actions appear here.</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{state.activity.length} local note{state.activity.length === 1 ? "" : "s"}</span>
          </div>
          <ul className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            {state.activity.slice(0, 4).map((item) => (
              <li key={item.id} className="border-l-2 border-ops-ink/25 pl-3 text-muted-foreground">
                {item.label}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );

  const renderPowerMapView = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="bg-ops-paper">
        <SmallLabel>Influence map</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Power map</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          A spatial influence board for allies, persuadables, blockers, and the decision target. It is fixture-grounded and uses text labels as well as colour.
        </p>
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)_minmax(0,1fr)] lg:items-stretch">
          <div className="space-y-4">
            <div className="rounded-[var(--r-2xl)] border border-ops-line bg-ops-mint p-4">
              <SmallLabel>Allies · ready to validate</SmallLabel>
              <h3 className="mt-2 text-xl font-medium">School-gate families</h3>
              <p className="mt-2 text-sm text-ops-ink/72">Primary supporter base; selected audience can move directly into the supporter email after review.</p>
            </div>
            <div className="rounded-[var(--r-2xl)] border border-ops-line bg-ops-mint/[0.70] p-4">
              <SmallLabel>Allies · process check</SmallLabel>
              <h3 className="mt-2 text-xl font-medium">Clean-air supporters</h3>
              <p className="mt-2 text-sm text-ops-ink/72">Useful for spotting escalation risks before a public-facing press prompt exists.</p>
            </div>
          </div>
          <div className="flex flex-col justify-between rounded-[var(--r-2xl)] border-2 border-ops-ink bg-background p-5 text-center shadow-sm">
            <SmallLabel>Decision target</SmallLabel>
            <h3 className="mt-3 text-2xl font-medium">Leicester transport decision route</h3>
            <p className="mt-3 text-sm text-muted-foreground">Exact committee/officer path must be verified before formal decision-maker copy is unlocked.</p>
            <div className="mt-5 rounded-full bg-ops-coral px-3 py-2 text-sm font-medium text-ops-ink">Current blocker: route verification</div>
          </div>
          <div className="space-y-4">
            <div className="rounded-[var(--r-2xl)] border border-ops-line bg-ops-yellow p-4">
              <SmallLabel>Persuadables · broaden pressure</SmallLabel>
              <h3 className="mt-2 text-xl font-medium">Nearby ward parents</h3>
              <p className="mt-2 text-sm text-ops-ink/72">Neighbourhood framing makes the safety issue wider than one school gate.</p>
            </div>
            <div className="rounded-[var(--r-2xl)] border border-ops-line bg-ops-coral p-4">
              <SmallLabel>Potential blockers · answer carefully</SmallLabel>
              <h3 className="mt-2 text-xl font-medium">Cost, enforcement, traffic objections</h3>
              <p className="mt-2 text-sm text-ops-ink/72">Keep public claims conservative until evidence checks and local consent are clear.</p>
            </div>
          </div>
        </div>
        <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border bg-background">
          <div className="hidden gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid md:grid-cols-[0.75fr_minmax(0,1.15fr)_minmax(0,1fr)_0.55fr]">
            <span>Group</span><span>What the fixture says</span><span>Operational use</span><span>Owner</span>
          </div>
          {campaignContext.power.rows.map((row) => (
            <div key={row.label} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[0.75fr_minmax(0,1.15fr)_minmax(0,1fr)_0.55fr]">
              <div><span className="font-medium md:hidden">Group: </span><span className="font-medium">{row.label}</span></div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">What the fixture says: </span>{row.detail}</div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Operational use: </span>{row.use}</div>
              <div><span className="font-medium md:hidden">Owner: </span>{row.owner}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SmallLabel>Use this map next</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Move from influence to copy</h3>
        <p className="mt-3 text-sm text-muted-foreground">Select the audience that best matches the pressure path, then keep blockers visible in review.</p>
        <div className="mt-5 flex flex-col gap-3">
          {goButton("audiences", "Choose audience")}
          {goButton("drafts", "Open drafts")}
          {goButton("evidence", "Review blockers")}
        </div>
      </Panel>
    </div>
  );

  const renderCampaignContextView = (section: (typeof campaignContext)[keyof typeof campaignContext]) => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel>
        <SmallLabel>Campaign context</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">{section.title}</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">{section.intro}</p>
        <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border">
          <div className="hidden grid-cols-[0.75fr_minmax(0,1.15fr)_minmax(0,1fr)_0.55fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
            <span>Brief item</span>
            <span>What the fixture says</span>
            <span>Operational use</span>
            <span>Owner</span>
          </div>
          {section.rows.map((row) => (
            <div key={row.label} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[0.75fr_minmax(0,1.15fr)_minmax(0,1fr)_0.55fr]">
              <div><span className="font-medium md:hidden">Brief item: </span><span className="font-medium">{row.label}</span></div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">What the fixture says: </span>{row.detail}</div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Operational use: </span>{row.use}</div>
              <div><span className="font-medium md:hidden">Owner: </span>{row.owner}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SmallLabel>Use this context next</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Keep the brief tied to action</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          These rows are intentionally operational: each one either shapes audience choice, copy, review, or the provider boundary.
        </p>
        <div className="mt-5 space-y-3 rounded-[var(--r-xl)] border border-border p-3 text-sm">
          <p><span className="font-medium">Selected audience:</span> {selected.name}</p>
          <p><span className="font-medium">Draft status:</span> {status.label}</p>
          <p><span className="font-medium">Provider:</span> Not connected</p>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {goButton("audiences", "Choose Audiences")}
          {goButton("drafts", "Open Drafts")}
          {goButton("reviews", "Open Reviews")}
        </div>
      </Panel>
    </div>
  );

  const renderContacts = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel>
        <SmallLabel>Contacts</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Fixture-backed contact readiness</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          This work area helps a campaigner see which local fixture contacts are usable for the demo draft, which need a check, and which are blocked until real import exists.
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3" aria-label="Contact readiness summary">
          {[
            { label: "Ready fixtures", count: readyContactCount, detail: "Can be used in reviewed local demo copy" },
            { label: "Review first", count: reviewContactCount, detail: "Needs a human consent or claim check" },
            { label: "Blocked", count: blockedContactCount, detail: "Requires real import before use" },
          ].map((item) => (
            <div key={item.label} className="rounded-[var(--r-xl)] border border-border bg-secondary/55 p-4">
              <p className="text-2xl font-medium">{item.count}</p>
              <p className="mt-1 text-sm font-semibold">{item.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-3 rounded-[var(--r-2xl)] border border-border bg-secondary/45 p-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="operations-contact-segment">Segment filter</Label>
            <select
              id="operations-contact-segment"
              value={state.contactFilter}
              onChange={(event) => setState((current) => ({ ...current, contactFilter: event.target.value as DemoState["contactFilter"] }))}
              className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="all">All fixture contacts</option>
              {segments.map((segment) => (
                <option key={segment.id} value={segment.id}>{segment.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="operations-contact-readiness">Readiness filter</Label>
            <select
              id="operations-contact-readiness"
              value={state.contactReadinessFilter}
              onChange={(event) => setState((current) => ({ ...current, contactReadinessFilter: event.target.value as DemoState["contactReadinessFilter"] }))}
              className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="all">All readiness states</option>
              <option value="ready">Ready fixtures</option>
              <option value="review">Review first</option>
              <option value="blocked">Blocked until import</option>
            </select>
          </div>
          <p className="text-sm text-muted-foreground md:col-span-2">
            Real contact import, deduplication, consent reconciliation, and provider sync are <span className="font-medium text-foreground">Coming soon</span>; these rows are local fixture records only.
          </p>
        </div>

        <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border">
          <div className="hidden grid-cols-[0.8fr_0.8fr_0.75fr_1fr_1fr_0.65fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground lg:grid">
            <span>Name</span><span>Segment</span><span>Readiness</span><span>Consent boundary</span><span>Next check</span><span>Owner</span>
          </div>
          {filteredContacts.length ? filteredContacts.map((contact) => (
            <div key={contact.id} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 lg:grid-cols-[0.8fr_0.8fr_0.75fr_1fr_1fr_0.65fr]">
              <div><span className="font-medium lg:hidden">Name: </span><span className="font-medium">{contact.name}</span><p className="text-xs text-muted-foreground">{contact.role}</p></div>
              <div><span className="font-medium lg:hidden">Segment: </span>{contact.segment}</div>
              <div><span className="font-medium lg:hidden">Readiness: </span>{contact.readiness}</div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground lg:hidden">Consent boundary: </span>{contact.consent}</div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground lg:hidden">Next check: </span>{contact.check}</div>
              <div><span className="font-medium lg:hidden">Owner: </span>{contact.owner}</div>
            </div>
          )) : (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No fixture contacts match those filters. Clear a filter or use this as a reminder that real import is not connected.
            </div>
          )}
        </div>
      </Panel>
      <Panel>
        <SmallLabel>Selected audience check</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">{selected.name}</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          {selectedSegmentContacts.filter((contact) => contact.readiness === "Ready fixture").length}/{selectedSegmentContacts.length} fixture contacts in this segment are ready enough for the local supporter email after review.
        </p>
        <div className="mt-5 space-y-3 text-sm">
          {selectedSegmentContacts.map((contact) => (
            <div key={contact.id} className="rounded-[var(--r-xl)] border border-border p-3">
              <p className="font-medium">{contact.name} · {contact.readiness}</p>
              <p className="mt-1 text-muted-foreground">{contact.nextAction}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {goButton("audiences", "Change selected audience")}
          {goButton("drafts", "Use in supporter draft")}
          <Button type="button" variant="outline" disabled title="Real import is coming soon; this demo has no provider or consent database.">
            Import contacts · Coming soon
          </Button>
        </div>
      </Panel>
    </div>
  );

  const renderResponses = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel>
        <SmallLabel>Responses & results</SmallLabel>
        <h2 className="mt-2 text-3xl font-medium tracking-tight">Coming soon: response handling after a real provider exists</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          There are no fabricated analytics here. This page records the boundary and the review questions that would matter once a provider, consent-safe import, and response stream exist.
        </p>
        <div className="mt-6 overflow-hidden rounded-[var(--r-2xl)] border border-border">
          <div className="hidden grid-cols-[0.8fr_1fr_0.9fr] gap-3 border-b border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
            <span>Future signal</span><span>Why it matters</span><span>Current boundary</span>
          </div>
          {[
            { signal: "Replies", why: "Would show supporter questions or local stories needing a human response.", boundary: "No provider or inbox stream is connected." },
            { signal: "List health", why: "Would help spot bounce and consent issues after a real import.", boundary: "No live list, bounce, or suppression data exists." },
            { signal: "Campaign outcome notes", why: "Would connect communications to the council decision route.", boundary: "No result is claimed from this demo queue." },
          ].map((item) => (
            <div key={item.signal} className="grid gap-2 border-b border-border px-4 py-4 text-sm last:border-0 md:grid-cols-[0.8fr_1fr_0.9fr]">
              <div><span className="font-medium md:hidden">Future signal: </span><span className="font-medium">{item.signal}</span></div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Why it matters: </span>{item.why}</div>
              <div className="text-muted-foreground"><span className="font-medium text-foreground md:hidden">Current boundary: </span>{item.boundary}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SmallLabel>Empty state</SmallLabel>
        <h3 className="mt-2 text-2xl font-medium">Not connected</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          No live provider, response stream, external measurement, or production result tracking is used in this demo workspace.
        </p>
        <div className="mt-5 rounded-[var(--r-2xl)] border border-dashed border-[var(--ring)] bg-secondary p-5 text-sm">
          <p className="font-medium">What campaigners can do now</p>
          <p className="mt-2 text-muted-foreground">Use Reviews and Outbox to prepare a locally queued item, then stop before any real outreach.</p>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {goButton("reviews", "Open approval gate")}
          {goButton("outbox", "Inspect local queue")}
        </div>
      </Panel>
    </div>
  );

  const viewContent: Record<ViewId, React.ReactNode> = {
    overview: renderOverview(),
    brief: renderCampaignContextView(campaignContext.brief),
    objectives: renderCampaignContextView(campaignContext.objectives),
    power: renderPowerMapView(),
    strategy: renderCampaignContextView(campaignContext.strategy),
    evidence: renderCampaignContextView(campaignContext.evidence),
    audiences: renderAudienceView(),
    contacts: renderContacts(),
    drafts: renderDraftsView(),
    reviews: renderReviewView(),
    outbox: renderOutboxView(),
    responses: renderResponses(),
  };

  return (
    <div className="min-h-screen bg-ops-paper text-foreground">
      <header className="sticky top-0 z-40 border-b border-ops-line bg-ops-paper/96 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link href="/" className="text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full">
              Campaign Factory
            </Link>
            <span className="text-muted-foreground" aria-hidden="true">/</span>
            <span className="rounded-full bg-ops-ink px-3 py-1 text-sm font-medium text-white">Campaign Operations</span>
            <span className="rounded-full bg-ops-yellow px-3 py-1 text-xs font-semibold uppercase tracking-[0.09em] text-ops-ink">Demo workspace</span>
            <span className="rounded-full border border-ops-line bg-background/70 px-3 py-1 text-xs text-muted-foreground">Local fixture state</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">St John the Baptist school street · Leicester</span>
            <span className="rounded-full bg-ops-mint px-3 py-1 text-xs text-ops-ink">
              {hydrated ? "Saved in this browser" : "Loading local state"}
            </span>
            <Link href="/factory" className="rounded-full border border-ops-line bg-background/70 px-3 py-1.5 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Back to Factory
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-6">
        <aside className="hidden lg:block">
          <div className="sticky top-[5.25rem] max-h-[calc(100vh-6rem)] overflow-auto rounded-[var(--r-2xl)] border border-ops-ink bg-ops-ink p-3 shadow-sm">
            <div className="mb-4 rounded-[var(--r-xl)] border border-white/10 bg-white/10 p-3 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/55">Runway state</p>
              <p className="mt-1 text-sm font-medium">{runwayStages.find((stage) => stage.status === "current")?.label ?? (state.status === "queued" ? "Local outbox" : "Human approval")}</p>
              <p className="mt-1 text-xs text-white/55">{status.label} · {selected.name}</p>
            </div>
            {renderNav(false, true)}
          </div>
        </aside>

        <details className="rounded-[var(--r-2xl)] border border-ops-line bg-background/70 p-3 lg:hidden">
          <summary className="cursor-pointer rounded-[var(--r-xl)] px-2 py-1 font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Operations navigation · {navGroups.flatMap((group) => group.items).find((item) => item.id === state.activeView)?.label}
          </summary>
          <div className="mt-4">{renderNav(true)}</div>
        </details>

        <main className="min-w-0" aria-live="polite">
          {viewContent[state.activeView]}
        </main>
      </div>

      <footer className="border-t border-ops-line bg-ops-paper">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-2 px-4 py-3 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <p>
            Local demo storage · Email provider not connected · Human approval required before local queueing.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/how" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full">How it works</Link>
            <Link href="/" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full">New campaign</Link>
            <button type="button" onClick={reset} className="rounded-full border border-border px-3 py-1.5 hover:bg-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Reset demo state
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
