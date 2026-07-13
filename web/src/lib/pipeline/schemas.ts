import { VERIFICATION_LABELS } from "./labels";

/* JSON-Schema builders (mirrors the prototype's tiny S/A/str helpers). */
type JSchema = Record<string, unknown>;
const S = (props: Record<string, JSchema>, req?: string[]): JSchema => ({
  type: "object",
  properties: props,
  required: req ?? Object.keys(props),
  additionalProperties: false,
});
const A = (items: JSchema): JSchema => ({ type: "array", items });
const str: JSchema = { type: "string" };
const strA = A(str);

/* --------------------------------------------------- plan (prompt-JSON) --- */
// Too large for structured-output grammar compilation (verified against the live
// API in the prototype), so Stage B uses prompt-specified JSON + tolerant parse.
export const PLAN_SCHEMA: JSchema = S({
  objective: S({
    dm: str,
    action: str,
    by: str,
    mvw: str,
    success: str,
    constraints: strA,
    smart: A(S({ test: str, assessment: str })),
  }),
  stakeholders: A(
    S({
      name: str,
      org: str,
      role: str,
      tier: { type: "string", enum: ["decides", "influences", "mobilises", "resists", "neutral"] },
      power: { type: "string", enum: ["High", "Medium-High", "Medium", "Low-Medium", "Low"] },
      position: str,
      positionStatus: { type: "string", enum: VERIFICATION_LABELS },
      relationship: str,
      cares: str,
      ask: str,
      approach: str,
      evidence: str,
      confidence: { type: "string", enum: ["High", "Medium", "Low"] },
    }),
  ),
  pressures: A(S({ type: str, on: str, why: str, whoApplies: str, channel: str, evidence: str, action: str })),
  statusQuoCost: str,
  strategy: S({
    narrative: str,
    audiences: strA,
    route: str,
    coalition: str,
    phases: A(S({ name: str, when: str, focus: str })),
    resources: strA,
    constraints: strA,
    risks: strA,
    tradeoffs: strA,
    escalation: str,
    avoid: strA,
    indicators: strA,
  }),
  tactics: A(
    S({
      name: str,
      phase: { type: "integer" },
      type: str,
      purpose: str,
      target: str,
      owner: str,
      pressure: str,
      resources: str,
      timing: str,
      dependencies: str,
      expected: str,
      success: str,
      next: str,
      escalation: str,
      approval: str,
    }),
  ),
  organising: S({
    whoActs: str,
    whyParticipate: str,
    asks: strA,
    roles: A(S({ role: str, what: str })),
    coalition: strA,
    oneToOne: strA,
    outreach: str,
    event: str,
    ladder: A(S({ rung: str, action: str })),
    channels: strA,
    followup: str,
    sustain: str,
    metrics: strA,
    humanEssential: strA,
  }),
  risks: strA,
  assumptions: strA,
  metrics: S({ campaign: strA, organising: strA }),
  qualityFlags: strA,
});

/* ------------------------------------ drafts (structured output, per group) --- */
const QA = A(S({ q: str, a: str }));

export const DRAFTS_SCHEMA = {
  lobbying: S({
    briefing: str,
    meetingEmail: str,
    agenda: str,
    keyArguments: strA,
    talkingPoints: strA,
    questionsToAsk: strA,
    objections: A(S({ objection: str, response: str })),
    contactScript: str,
    doorknockScript: str,
    followupEmail: str,
    escalationOptions: strA,
  }),
  media: S({
    pressRelease: str,
    pitchEmail: str,
    headline: str,
    altAngles: strA,
    spokespeople: str,
    quotes: A(S({ voice: str, quote: str, note: str })),
    qa: QA,
    hostileQA: QA,
    timing: str,
    visual: str,
  }),
  digital: S({
    landingCopy: str,
    actionPageCopy: str,
    supporterEmail: str,
    volunteerMessage: str,
    socialPosts: A(S({ platform: str, text: str })),
    audienceVariants: A(S({ audience: str, text: str })),
    faq: QA,
    ctas: strA,
    contentSequence: str,
    sharingMessage: str,
    graphicConcepts: strA,
  }),
} as const;

export type DraftGroup = keyof typeof DRAFTS_SCHEMA;
