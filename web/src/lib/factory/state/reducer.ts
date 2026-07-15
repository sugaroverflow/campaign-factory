// Typed state reducer (ADR 0008). Pure, runtime-neutral. Agents never mutate
// state: the Synthesis Reviewer accepts a ChangeProposal, then this reducer
// applies ONLY the allow-listed ProposalOp variants against an explicit base
// version. A stale proposal (baseStateVersion != state.version) is REJECTED
// with a distinct error code and never applied. Application is atomic: if any
// op fails validation, the input state is returned unchanged.

import type { CampaignId } from "../contracts/core";
import type { JourneyStepKey } from "../contracts/journey";
import { JOURNEY_STEPS } from "../contracts/journey";
import { CANONICAL_DOCUMENTS, type CanonicalDocumentKey } from "../contracts/documents";
import type {
  CampaignDocumentState,
  CampaignSectionState,
  CampaignState,
  ChangeProposal,
  ProposalOp,
  TerminalGap,
} from "../contracts/state";
import {
  isJourneyStepKey,
  nextCheckSchema,
  packResourceSchema,
  validateSectionContent,
} from "./sections";
import { z } from "zod";

export const PROPOSAL_ERROR = {
  STALE: "E_STALE_PROPOSAL",
  UNKNOWN_OP: "E_UNKNOWN_OP",
  UNKNOWN_SECTION: "E_UNKNOWN_SECTION",
  INVALID_SECTION_CONTENT: "E_INVALID_SECTION_CONTENT",
  INVALID_PACK_DOCUMENT: "E_INVALID_PACK_DOCUMENT",
  INVALID_PACK_RESOURCES: "E_INVALID_PACK_RESOURCES",
  INVALID_NEXT_CHECK: "E_INVALID_NEXT_CHECK",
  INVALID_TERMINAL_GAP: "E_INVALID_TERMINAL_GAP",
} as const;

export type ProposalErrorCode = (typeof PROPOSAL_ERROR)[keyof typeof PROPOSAL_ERROR];

const PACK_KEYS: ReadonlySet<string> = new Set([
  "lobbying_pack",
  "media_pack",
  "digital_pack",
]);

function isPackKey(k: string): k is Extract<CanonicalDocumentKey, "lobbying_pack" | "media_pack" | "digital_pack"> {
  return PACK_KEYS.has(k);
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function unionIds(a: string[] | undefined, b: string[] | undefined): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

/** Empty accepted state for a fresh campaign (version 0). */
export function emptyCampaignState(campaignId: CampaignId, problem: string, place: string): CampaignState {
  const sections = {} as Record<JourneyStepKey, CampaignSectionState>;
  for (const s of JOURNEY_STEPS) {
    sections[s.key] = { status: "empty", content: null, evidenceClaimIds: [] };
  }
  const documents: CampaignDocumentState[] = CANONICAL_DOCUMENTS.map((d) => ({
    key: d.key,
    status: "assembling",
    version: 0,
    ...(isPackKey(d.key) ? { resources: [] } : {}),
  }));
  return {
    campaignId,
    version: 0,
    problem,
    place,
    sections,
    documents,
    nextChecks: [],
    terminalGaps: [],
  };
}

/**
 * Apply an accepted proposal to campaign state.
 *
 * Returns the next state (version bumped by 1) on success, or the ORIGINAL
 * state plus one or more coded errors on failure. Stale proposals are rejected
 * with PROPOSAL_ERROR.STALE and never applied.
 */
export function applyProposal(
  state: CampaignState,
  proposal: ChangeProposal,
): { state: CampaignState; errors: string[] } {
  // Stale check first — distinct error code, never applied.
  if (proposal.baseStateVersion !== state.version) {
    return {
      state,
      errors: [
        `${PROPOSAL_ERROR.STALE}: proposal base version ${proposal.baseStateVersion} does not match current state version ${state.version}`,
      ],
    };
  }

  const errors: string[] = [];
  const next: CampaignState = structuredClone(state);
  const newVersion = state.version + 1;
  const touchedSections = new Set<JourneyStepKey>();

  for (const op of proposal.ops as ProposalOp[]) {
    switch (op.op) {
      case "set_section": {
        if (!isJourneyStepKey(op.step)) {
          errors.push(`${PROPOSAL_ERROR.UNKNOWN_SECTION}: '${String(op.step)}'`);
          break;
        }
        const v = validateSectionContent(op.step, op.content);
        if (!v.ok) {
          errors.push(`${PROPOSAL_ERROR.INVALID_SECTION_CONTENT}: [${op.step}] ${v.errors.join("; ")}`);
          break;
        }
        const prev = next.sections[op.step];
        next.sections[op.step] = {
          ...prev,
          content: op.content,
          evidenceClaimIds: op.evidenceClaimIds ?? [],
          status: "accepted",
          acceptedAtVersion: newVersion,
        };
        touchedSections.add(op.step);
        break;
      }

      case "merge_section": {
        if (!isJourneyStepKey(op.step)) {
          errors.push(`${PROPOSAL_ERROR.UNKNOWN_SECTION}: '${String(op.step)}'`);
          break;
        }
        const prev = next.sections[op.step];
        const merged = { ...asRecord(prev?.content), ...op.patch };
        const v = validateSectionContent(op.step, merged);
        if (!v.ok) {
          errors.push(`${PROPOSAL_ERROR.INVALID_SECTION_CONTENT}: [${op.step}] ${v.errors.join("; ")}`);
          break;
        }
        next.sections[op.step] = {
          ...prev,
          content: merged,
          evidenceClaimIds: unionIds(prev?.evidenceClaimIds, op.evidenceClaimIds),
          status: "accepted",
          acceptedAtVersion: newVersion,
        };
        touchedSections.add(op.step);
        break;
      }

      case "set_pack": {
        if (!isPackKey(op.document)) {
          errors.push(`${PROPOSAL_ERROR.INVALID_PACK_DOCUMENT}: '${String(op.document)}'`);
          break;
        }
        const parsed = z.array(packResourceSchema).safeParse(op.resources);
        if (!parsed.success) {
          errors.push(
            `${PROPOSAL_ERROR.INVALID_PACK_RESOURCES}: [${op.document}] ${parsed.error.issues
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join("; ")}`,
          );
          break;
        }
        const idx = next.documents.findIndex((d) => d.key === op.document);
        if (idx === -1) {
          next.documents.push({
            key: op.document,
            status: "ready",
            version: 1,
            resources: op.resources,
          });
        } else {
          const doc = next.documents[idx];
          next.documents[idx] = {
            ...doc,
            resources: op.resources,
            status: "ready",
            version: doc.version + 1,
          };
        }
        break;
      }

      case "add_next_check": {
        const parsed = nextCheckSchema.safeParse(op.check);
        if (!parsed.success) {
          errors.push(
            `${PROPOSAL_ERROR.INVALID_NEXT_CHECK}: ${parsed.error.issues
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join("; ")}`,
          );
          break;
        }
        next.nextChecks.push({ id: newId(), ...op.check });
        break;
      }

      case "record_terminal_gap": {
        if (typeof op.description !== "string" || op.description.length === 0) {
          errors.push(`${PROPOSAL_ERROR.INVALID_TERMINAL_GAP}: description is required`);
          break;
        }
        const gap: TerminalGap = {
          id: newId(),
          description: op.description,
          at: nowIso(),
          ...(op.step != null ? { step: op.step } : {}),
          ...(proposal.agentRunId ? { agentRunId: proposal.agentRunId } : {}),
        };
        next.terminalGaps.push(gap);
        break;
      }

      default: {
        errors.push(`${PROPOSAL_ERROR.UNKNOWN_OP}: '${String((op as { op?: unknown }).op)}'`);
        break;
      }
    }
  }

  // Atomic: any error => no mutation applied.
  if (errors.length > 0) return { state, errors };

  next.version = newVersion;
  return { state: next, errors: [] };
}

/**
 * Helper for the runtime (W2/W3): resolve local claim refs of the form `c{n}`
 * (1-based index into an AgentResult.claims array) into the concrete claim ids
 * assigned when those claims were persisted, across a proposal's
 * evidence-bearing ops. Leaves any entry that is not a `c{n}` token untouched
 * (already-existing claim uuids pass through). Call this BEFORE applyProposal;
 * the reducer itself stays pure and never sees unresolved tokens.
 */
export function resolveEvidenceRefs(proposal: ChangeProposal, assignedClaimIds: string[]): ChangeProposal {
  const resolve = (ids: string[]): string[] =>
    ids.map((id) => {
      const m = /^c(\d+)$/.exec(id);
      if (!m) return id;
      const i = Number(m[1]) - 1;
      return assignedClaimIds[i] ?? id;
    });

  const ops = proposal.ops.map((op): ProposalOp => {
    if (op.op === "set_section" || op.op === "merge_section" || op.op === "set_pack") {
      return { ...op, evidenceClaimIds: resolve(op.evidenceClaimIds) };
    }
    return op;
  });

  return { ...proposal, ops };
}
