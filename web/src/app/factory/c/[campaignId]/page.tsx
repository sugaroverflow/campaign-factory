// Public Campaign Assembly View route (W4). Server component: unwrap the async
// params (Next 16 — params is a Promise), then hand off to the live client
// container. The brief opens immediately and the client attaches the SSE/polling
// stream; there is no server data fetch here (the read model is events-only and
// the client folds it).

import { AssemblyClient } from "@/components/factory/assembly/AssemblyClient";

export default async function CampaignAssemblyPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  return <AssemblyClient campaignId={campaignId} />;
}
