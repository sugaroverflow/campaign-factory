// Agent → lucide icon mapping. One recognisable civic/organising glyph per
// roster responsibility. No robot/terminal/sci-fi iconography (parameters §6).

import { createElement } from "react";
import {
  Activity,
  BookOpen,
  Building,
  Building2,
  ClipboardCheck,
  Compass,
  Gauge,
  GitBranch,
  HeartHandshake,
  Landmark,
  ListChecks,
  Mail,
  Map,
  Megaphone,
  Network,
  Newspaper,
  Scale,
  Smartphone,
  Target,
  Vote,
  type LucideIcon,
} from "lucide-react";
import type { AgentKey } from "@/lib/factory/contracts";

const AGENT_ICONS: Record<AgentKey, LucideIcon> = {
  // fixed backbone
  research_director: Compass,
  evidence_adjudicator: Scale,
  objective_strategist: Target,
  decision_route: GitBranch,
  power_stakeholder: Network,
  pressure_analysis: Gauge,
  strategy_architect: Map,
  tactics_planner: ListChecks,
  organising_designer: HeartHandshake,
  lobbying_producer: Mail,
  media_producer: Megaphone,
  digital_producer: Smartphone,
  synthesis_reviewer: ClipboardCheck,
  // registered specialists
  local_government: Landmark,
  parliamentary: Vote,
  public_body: Building,
  planning: Building2,
  local_media: Newspaper,
  precedent_opposition: BookOpen,
};

export function agentIcon(key: AgentKey | undefined): LucideIcon {
  return (key && AGENT_ICONS[key]) || Activity;
}

export function AgentIcon({
  agentKey,
  size = 14,
  className,
  strokeWidth = 2,
}: {
  agentKey: AgentKey | undefined;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  // createElement (not <Icon/>) so the linter doesn't read a function-returned
  // component as a component defined during render.
  return createElement(agentIcon(agentKey), {
    size,
    strokeWidth,
    className,
    "aria-hidden": true,
  });
}
