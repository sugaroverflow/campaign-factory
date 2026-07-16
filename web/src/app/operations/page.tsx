import { OperationsWorkspace } from "@/components/OperationsWorkspace";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string }>;
}) {
  const sp = await searchParams;
  return <OperationsWorkspace campaignId={sp.campaignId?.trim() || undefined} />;
}
