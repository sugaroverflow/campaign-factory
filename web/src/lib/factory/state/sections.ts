// Per-section content schemas (zod v4). Pure, runtime-neutral — no next/* and
// no DB imports. Field names are aligned with the existing pipeline output
// types (web/src/lib/pipeline/types.ts / PLAN_SCHEMA) so the Assembly View can
// reuse its renderers and producing agents can model outputs on a known shape.
//
// Validation policy is pragmatic: each section requires a small load-bearing
// core and leaves the rest optional. Extra fields are NOT an error — the
// reducer validates the SHAPE for correctness but persists the agent's
// original content object unchanged, so richer fields survive for the UI.
//
// Verification labels on nested fields (e.g. a stakeholder's positionStatus)
// are validated as free strings here; the seven-label integrity spine is
// enforced at the Claim level (factory.claims + coerceLabel), not in section
// content.

import { z } from "zod";
import type { JourneyStepKey } from "../contracts/journey";
import { JOURNEY_STEPS } from "../contracts/journey";

const strArr = z.array(z.string());

/* ---- shared sub-schemas (mirror pipeline types) ---- */

const smartTestSchema = z.object({
  test: z.string(),
  assessment: z.string().optional(),
});

const stakeholderSchema = z.object({
  name: z.string(),
  org: z.string().optional(),
  role: z.string().optional(),
  tier: z.enum(["decides", "influences", "mobilises", "resists", "neutral"]).optional(),
  power: z.enum(["High", "Medium-High", "Medium", "Low-Medium", "Low"]).optional(),
  position: z.string().optional(),
  positionStatus: z.string().optional(),
  relationship: z.string().optional(),
  cares: z.string().optional(),
  ask: z.string().optional(),
  approach: z.string().optional(),
  evidence: z.string().optional(),
  confidence: z.enum(["High", "Medium", "Low"]).optional(),
});

const pressureSchema = z.object({
  type: z.string().optional(),
  on: z.string().optional(),
  why: z.string().optional(),
  whoApplies: z.string().optional(),
  channel: z.string().optional(),
  evidence: z.string().optional(),
  action: z.string().optional(),
});

const phaseSchema = z.object({
  name: z.string(),
  when: z.string().optional(),
  focus: z.string().optional(),
});

const tacticSchema = z.object({
  name: z.string(),
  phase: z.number().int().optional(),
  type: z.string().optional(),
  purpose: z.string().optional(),
  target: z.string().optional(),
  owner: z.string().optional(),
  pressure: z.string().optional(),
  resources: z.string().optional(),
  timing: z.string().optional(),
  dependencies: z.string().optional(),
  expected: z.string().optional(),
  success: z.string().optional(),
  next: z.string().optional(),
  escalation: z.string().optional(),
  approval: z.string().optional(),
});

const roleSchema = z.object({ role: z.string(), what: z.string().optional() });
const ladderSchema = z.object({ rung: z.string(), action: z.string().optional() });

/* ---- per-section content schemas ---- */

const problemSchema = z.object({
  statement: z.string().min(1),
  campaignName: z.string().optional(),
  interpretation: z.string().optional(),
  context: z
    .object({
      situation: z.string().optional(),
      currentPolicy: z.string().optional(),
      affected: strArr.optional(),
      keyDates: strArr.optional(),
      institutions: strArr.optional(),
      howItChanged: z.string().optional(),
    })
    .optional(),
});

const evidenceSchema = z.object({
  // Optional (not required): the Evidence section is built incrementally — the
  // Research Director set_sections a summary, then specialists merge_section
  // their lane blocks. A merge that lands before the summary must still
  // validate, so summary is not a hard requirement at the reducer's shape gate
  // (completeness is the reviewer's concern).
  summary: z.string().optional(),
  researchQuestions: strArr.optional(),
  keyDates: strArr.optional(),
  institutions: strArr.optional(),
  allies: strArr.optional(),
  opponents: strArr.optional(),
  localMedia: strArr.optional(),
  unresolved: strArr.optional(),
});

const objectiveSchema = z.object({
  dm: z.string().min(1),
  action: z.string().min(1),
  by: z.string().optional(),
  mvw: z.string().optional(),
  success: z.string().optional(),
  constraints: strArr.optional(),
  smart: z.array(smartTestSchema).optional(),
});

const decisionRouteSchema = z.object({
  formal: z.string().min(1),
  implementer: z.string().optional(),
  practical: z.string().optional(),
  processes: strArr.optional(),
  interventionPoints: strArr.optional(),
  deadlines: strArr.optional(),
  unresolved: strArr.optional(),
});

const powerSchema = z.object({
  stakeholders: z.array(stakeholderSchema),
  statusQuoCost: z.string().optional(),
});

const pressureSectionSchema = z.object({
  pressures: z.array(pressureSchema),
  statusQuoCost: z.string().optional(),
});

const strategySchema = z.object({
  narrative: z.string().min(1),
  audiences: strArr.optional(),
  route: z.string().optional(),
  coalition: z.string().optional(),
  phases: z.array(phaseSchema).optional(),
  resources: strArr.optional(),
  constraints: strArr.optional(),
  risks: strArr.optional(),
  tradeoffs: strArr.optional(),
  escalation: z.string().optional(),
  avoid: strArr.optional(),
  indicators: strArr.optional(),
  statusQuoCost: z.string().optional(),
});

const tacticsSchema = z.object({
  tactics: z.array(tacticSchema),
});

const organisingSchema = z.object({
  whoActs: z.string().optional(),
  whyParticipate: z.string().optional(),
  asks: strArr.optional(),
  roles: z.array(roleSchema).optional(),
  coalition: strArr.optional(),
  oneToOne: strArr.optional(),
  outreach: z.string().optional(),
  event: z.string().optional(),
  ladder: z.array(ladderSchema).optional(),
  channels: strArr.optional(),
  followup: z.string().optional(),
  sustain: z.string().optional(),
  metrics: strArr.optional(),
  humanEssential: strArr.optional(),
});

// Step 10. Documents flow through set_pack ops + document_versions; the section
// content is a short overview. Kept lenient.
const documentsSchema = z.object({
  summary: z.string().optional(),
  notes: strArr.optional(),
});

export const SECTION_SCHEMAS: Record<JourneyStepKey, z.ZodType> = {
  problem: problemSchema,
  evidence: evidenceSchema,
  objective: objectiveSchema,
  decision_route: decisionRouteSchema,
  power: powerSchema,
  pressure: pressureSectionSchema,
  strategy: strategySchema,
  tactics: tacticsSchema,
  organising: organisingSchema,
  documents: documentsSchema,
};

// Resource fragment inside a pack (docs 7–9). Mirrors PackResource.
export const packResourceSchema = z.object({
  key: z.string().min(1),
  title: z.string(),
  body: z.string(),
  verificationNotes: strArr.optional(),
  claimIds: strArr.optional(),
});

// A "next check" entry (Omit<NextCheck, "id">).
export const nextCheckSchema = z.object({
  description: z.string().min(1),
  reason: z.string(),
  affectedSections: strArr,
  claimIds: strArr.optional(),
});

const JOURNEY_KEYS = new Set<string>(JOURNEY_STEPS.map((s) => s.key));

export function isJourneyStepKey(k: unknown): k is JourneyStepKey {
  return typeof k === "string" && JOURNEY_KEYS.has(k);
}

function issuesToStrings(err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const path = i.path.length ? i.path.join(".") : "(root)";
    return `${path}: ${i.message}`;
  });
}

export function validateSectionContent(
  step: JourneyStepKey,
  content: unknown,
): { ok: boolean; errors: string[] } {
  const schema = SECTION_SCHEMAS[step];
  if (!schema) return { ok: false, errors: [`no schema for section '${step}'`] };
  const result = schema.safeParse(content);
  return result.success ? { ok: true, errors: [] } : { ok: false, errors: issuesToStrings(result.error) };
}
