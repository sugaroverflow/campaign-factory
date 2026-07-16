import type { RunReadModel } from "@/lib/factory/contracts/api";
import { CANONICAL_DOCUMENTS, DOCUMENT_STATUSES } from "@/lib/factory/contracts/documents";
import type { CompiledDocument, EvidenceAndNextChecks } from "@/lib/factory/documents";

export const OPERATIONS_DEFAULT_SOURCE_ORIGIN = "https://campaign-factory.vercel.app";

export const OPERATIONS_PUBLIC_CAMPAIGNS = [
  { id: "69f257b6-9913-4395-94f7-5c25b4b5fe95", sourceHref: `${OPERATIONS_DEFAULT_SOURCE_ORIGIN}/factory/c/69f257b6-9913-4395-94f7-5c25b4b5fe95`, conferenceHero: true },
  { id: "57678ae0-29fd-4b4b-8a53-5c711cdb21cf", sourceHref: `${OPERATIONS_DEFAULT_SOURCE_ORIGIN}/factory/c/57678ae0-29fd-4b4b-8a53-5c711cdb21cf` },
  { id: "6b54225d-afa3-41d1-b053-89741094f153", sourceHref: `${OPERATIONS_DEFAULT_SOURCE_ORIGIN}/factory/c/6b54225d-afa3-41d1-b053-89741094f153` },
] as const;

export const OPERATIONS_PUBLIC_CAMPAIGN_IDS = new Set<string>(OPERATIONS_PUBLIC_CAMPAIGNS.map((campaign) => campaign.id));

export function normaliseOperationsSourceOrigin(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export type OperationsSourcePayload = {
  sourceOrigin: string;
  run: RunReadModel;
  documents: CompiledDocument[];
  evidence: EvidenceAndNextChecks;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const OPERATIONS_DOCUMENT_KEYS = new Set<string>(CANONICAL_DOCUMENTS.map((doc) => doc.key));
const OPERATIONS_DOCUMENT_STATUSES = new Set<string>(DOCUMENT_STATUSES);

export function isOperationsCompiledDocument(value: unknown): value is CompiledDocument {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === "string" &&
    OPERATIONS_DOCUMENT_KEYS.has(value.key) &&
    isFiniteNumber(value.num) &&
    typeof value.name === "string" &&
    typeof value.status === "string" &&
    OPERATIONS_DOCUMENT_STATUSES.has(value.status) &&
    typeof value.html === "string" &&
    typeof value.plainText === "string" &&
    typeof value.isPack === "boolean" &&
    isStringArray(value.sectionKeys) &&
    isFiniteNumber(value.resourceCount) &&
    isStringArray(value.flags)
  );
}

export function isOperationsCompiledDocumentList(value: unknown): value is CompiledDocument[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const doc of value) {
    if (!isOperationsCompiledDocument(doc) || seen.has(doc.key)) return false;
    seen.add(doc.key);
  }
  return true;
}

export function isOperationsEvidenceAndNextChecks(value: unknown): value is EvidenceAndNextChecks {
  if (!isRecord(value) || !isRecord(value.totals)) return false;
  const totals = value.totals;
  if (
    !isFiniteNumber(totals.claims) ||
    !isFiniteNumber(totals.loadBearing) ||
    !isFiniteNumber(totals.verifiedLoadBearing) ||
    !isFiniteNumber(totals.unresolvedLoadBearing)
  ) {
    return false;
  }
  if (!Array.isArray(value.groups) || !Array.isArray(value.conflicts) || !Array.isArray(value.nextChecks) || !Array.isArray(value.terminalGaps) || !Array.isArray(value.draftNotes)) {
    return false;
  }
  return value.nextChecks.every(
    (check) =>
      isRecord(check) &&
      typeof check.id === "string" &&
      typeof check.description === "string" &&
      typeof check.reason === "string" &&
      isStringArray(check.claimIds) &&
      isStringArray(check.affectedSections),
  );
}

export function isOperationsPublicCampaignId(id: string) {
  return OPERATIONS_PUBLIC_CAMPAIGN_IDS.has(id);
}
