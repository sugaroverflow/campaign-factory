// W6 documents domain — the deterministic nine-document compiler, the Evidence
// and Next Checks builder, and the receipt builders. All runtime-neutral (no
// next/*): the worker's finalisation node and the web UI import from here alike.

export {
  compileDocuments,
  sectionDocStatus,
  isExportable,
  DOC_SECTIONS,
  type CompiledDocument,
} from "./compile";

export {
  buildEvidenceAndNextChecks,
  evidenceSection,
  claimDetailLines,
  type EvidenceAndNextChecks,
  type SourceLedgerGroup,
  type EvidenceClaimView,
  type EvidenceTotals,
  type DraftNote,
} from "./evidence";

export {
  PLAIN_LABEL,
  plainLabel,
  campaignGrade,
  documentPill,
  PLAIN_DOC_STATUS,
  plainDocStatus,
  PLAIN_SECTION_STATUS,
  sectionStatusPhrase,
  plainFlag,
  plainOutputName,
  DOCUMENT_DISCLAIMER,
  TERMINAL_GAPS_TITLE,
  TERMINAL_GAPS_NOTE,
  FACT_CHECKS_TITLE,
  NEXT_CHECKS_GROUP,
  JUDGEMENT_FRAME,
  JUDGEMENT_DEFAULT_CHIP,
  UNRESOLVED_EVIDENCE_GROUPS,
  SETTLED_EVIDENCE_GROUP,
  type EvidenceGroupCopy,
} from "./language";

export {
  buildCampaignReceipt,
  buildBatchReceipt,
  isSubstantiallyUsable,
  type CampaignReceipt,
  type BatchReceipt,
  type BatchReceiptCampaignInput,
  type BatchReceiptTotals,
  type AgentTally,
  type ClaimTally,
  type JudgementTally,
} from "./receipts";

export {
  LABEL_TAG_CLASS,
  UNRESOLVED_LABELS,
  isUnresolvedLabel,
  escapeHtml,
  type Block,
} from "./render";
