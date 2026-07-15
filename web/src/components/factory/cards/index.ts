// Shared Agent Work Cards (W5). Adopted by W4-assembly (inline Step Workspace)
// and W5's Factory Gallery, and reused by W7 replay. Pure presentational
// components: props in, no fetching, no live clock except the supplied `now`.

export { AgentWorkCard } from "./AgentWorkCard";
export { CompactAgentCard } from "./CompactAgentCard";
export { AgentIdentityPill } from "./AgentIdentityPill";
export { AgentIcon, agentIcon } from "./icons";
export { CAMPAIGN_HUES, hueByIndex, hueIndexForPosition } from "./hues";
export { foldAgentToCardVM, adaptAgentCardVM } from "./cardAdapter";
export type { AgentCardVMInput, CardAdaptContext } from "./cardAdapter";
export { clockStamp, elapsedClock } from "./format";
export type {
  AgentCardVM,
  AgentCardProps,
  BackscrollRow,
  CardActivity,
  CardProposalState,
  CardPresentation,
  CampaignHueIndex,
} from "./types";
export type { CampaignHue } from "./hues";
