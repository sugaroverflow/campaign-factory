// Runtime, research, cost, and latency limits (parameters §4–§5).
// All spend figures are USD unless suffixed otherwise.

export const RUNTIME_LIMITS = {
  campaignsPerPublicLaunch: 1,
  campaignsPerPresenterBatch: 5, // 1–5
  globalActiveModelCalls: 25,
  activeCallsPerPresenterCampaign: 5,
  activeCallsPerPublicCampaign: 8,
  concurrentResearchCalls: 10,
  agentsPerCampaignTarget: 15,
  agentsPerCampaignHardCap: 20,
  standardAgentTimeoutMs: 240000,
  researchSpecialistTimeoutMs: 300000,
  strategyReviewerTimeoutMs: 360000,
  softCampaignTargetMs: 12 * 60000,
  hardCampaignLimitMs: 20 * 60000,
} as const;

export const RESEARCH_LIMITS = {
  webSearchesPerCampaign: 20,
  directorDiscoverySearches: 2,
  perSpecialistSearches: 4,
  adjudicatorSearches: 2,
  pageExtractionChars: 20000,
  pdfExtractionChars: 60000,
} as const;

export const COST_GUARDS = {
  perCampaignWarningUSD: 4,
  perCampaignHardStopUSD: 8, // stops new model nodes; deterministic finalisation runs
  presenterBatchWarningUSD: 20,
  presenterBatchHardStopUSD: 35,
  dailyProjectKillSwitchGBP: 150, // existing global switch, unchanged
} as const;

export const LATENCY_TARGETS = {
  anchorsAndFirstAgentsMs: 2000,
  meaningfulBackscrollMs: 10000,
  firstSourcedFindingMs: 45000,
  firstAcceptedSectionMs: 90000,
  firstCampaignUsableMs: 8 * 60000,
  batchSubstantiallyCompleteMs: 12 * 60000,
} as const;

// UI choreography caps (parameters §6).
export const UI_LIMITS = {
  factoryLedgerMaxHeightPx: 44,
  maxExpandedCards: 10,
  maxExpandedCardsPerCampaignInBatch: 3,
  expandedCardSize: { w: 300, h: 190 },
  compactCardSize: { w: 180, h: 96 },
  completionReadableMsMin: 800,
  completionReadableMsMax: 1200,
  maxChoreographyDelayMs: 750,
  stepWorkspaceMaxHeightPx: 420,
  backscrollVirtualiseAfterRows: 100,
} as const;
