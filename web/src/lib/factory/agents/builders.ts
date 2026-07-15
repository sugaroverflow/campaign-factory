// Contract builders for the two common agent shapes: an agent that writes one
// brief section (set_section) and a producer that writes one pack (set_pack).
// The model emits only domain content + which claim refs support it; these
// builders construct the allow-listed proposal op deterministically, so a
// disallowed op or wrong-step write is impossible by construction.

import type { AgentKey } from "../contracts/roster";
import type { CanonicalDocumentKey } from "../contracts/documents";
import { A, S, str, strA, type JSchema } from "./schema";
import type { AgentContract } from "./types";
import {
  agentOutputSchema,
  baseBody,
  buildPackProposal,
  buildSectionProposal,
  coercePackResources,
  coerceRefs,
  systemPrompt,
  userMessageHeader,
} from "./shared";

export interface SectionContractSpec {
  key: AgentKey;
  step: number;
  role: string; // role-specific system-prompt body
  tail: string[]; // shared spine fragments
  contentField: string; // domain field name carrying the section content
  contentSchema: JSchema; // JSchema for that content
  summary: string; // human proposal summary
  structuredOutput?: boolean;
  // Optional last-mile coercion of the model's content object before it becomes
  // a proposal, to guarantee w1 reducer-required nested fields exist (e.g. every
  // power stakeholder must carry a `name` string). Never invents data — only
  // fills required-but-empty fields from sibling fields already present.
  normalizeContent?: (content: Record<string, unknown>) => Record<string, unknown>;
}

export function makeSectionContract(spec: SectionContractSpec): AgentContract {
  const schema = agentOutputSchema(
    { [spec.contentField]: spec.contentSchema, evidenceClaimRefs: strA },
    [spec.contentField, "evidenceClaimRefs"],
  );
  return {
    key: spec.key,
    schema,
    structuredOutput: spec.structuredOutput,
    system: () => systemPrompt(spec.role, spec.tail, schema),
    userMessage: (env, ctx) => userMessageHeader(env, ctx),
    toResult: (raw, ctx) => {
      const body = baseBody(raw, ctx);
      const refs = coerceRefs(raw.evidenceClaimRefs);
      const rawContent = (raw[spec.contentField] ?? {}) as Record<string, unknown>;
      const content = spec.normalizeContent ? spec.normalizeContent(rawContent) : rawContent;
      body.proposals.unshift(buildSectionProposal(ctx.envelope, spec.step, content, refs, { summary: spec.summary }));
      return body;
    },
  };
}

export const packResourceSchema: JSchema = S(
  {
    key: str,
    title: str,
    body: str,
    verificationNotes: strA,
    claimIds: strA,
  },
  ["key", "title", "body"],
);

export interface PackContractSpec {
  key: AgentKey;
  document: Extract<CanonicalDocumentKey, "lobbying_pack" | "media_pack" | "digital_pack">;
  role: string;
  tail: string[];
  summary: string;
  extraDomain?: Record<string, JSchema>;
  extraRequired?: string[];
  structuredOutput?: boolean;
}

export function makePackContract(spec: PackContractSpec): AgentContract {
  const schema = agentOutputSchema(
    { resources: A(packResourceSchema), evidenceClaimRefs: strA, ...(spec.extraDomain ?? {}) },
    ["resources", "evidenceClaimRefs", ...(spec.extraRequired ?? [])],
  );
  return {
    key: spec.key,
    schema,
    structuredOutput: spec.structuredOutput,
    system: () => systemPrompt(spec.role, spec.tail, schema),
    userMessage: (env, ctx) => userMessageHeader(env, ctx),
    toResult: (raw, ctx) => {
      const body = baseBody(raw, ctx);
      const refs = coerceRefs(raw.evidenceClaimRefs);
      const resources = coercePackResources(raw.resources);
      body.proposals.unshift(buildPackProposal(ctx.envelope, spec.document, resources, refs, { summary: spec.summary }));
      return body;
    },
  };
}
