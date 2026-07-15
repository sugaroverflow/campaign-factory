// The single-agent legacy Campaign Builder, relocated off the homepage
// (conference decision, 15 Jul 2026). Unlinked from the nav; kept for
// comparison and as the tested fallback path.

import { CampaignApp } from "@/components/CampaignApp";

export default function LegacyCampaignBuilder() {
  return (
    <main className="min-h-dvh">
      <CampaignApp />
    </main>
  );
}
