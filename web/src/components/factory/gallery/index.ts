// Presenter Factory Gallery (W5). The renderer (FactoryGallery) is a pure
// function of the event view model; GalleryLive owns transport. W7 replay reuses
// FactoryGallery directly with folded stored events.

export { FactoryGallery } from "./FactoryGallery";
export type { FactoryGalleryProps } from "./FactoryGallery";
export { GalleryLive } from "./GalleryLive";
export { FactoryLedger, FactoryStatsStrip } from "./FactoryLedger";
export { useFloorFollow } from "./useFloorFollow";
export { CampaignAnchor } from "./CampaignAnchor";
export { CampaignColumn } from "./CampaignColumn";
export { PublishedBriefStack } from "./PublishedBriefStack";
export { JudgementCard } from "./JudgementCard";
export { ConnectorLayer } from "./ConnectorLayer";
export { runVmToCampaignReceipt } from "./receiptModel";
export { selectPresentation, COMPLETION_READABLE_MS } from "./presentation";
export type { PresentationOptions } from "./presentation";
export {
  buildLedger,
  campaignCards,
  campaignEdges,
  deriveShortName,
  type GalleryCampaign,
  type LedgerCounts,
  type ConnectorEdge,
} from "./viewModel";
export { rememberBatch, getBatch, forgetBatch } from "./batchStorage";
export type { StoredBatch, StoredBatchConnection } from "./batchStorage";
