// Factory Gallery route. Presenter cookie required — otherwise redirect to the
// presenter entry (ADR 0013). The actual live gallery is client-rendered because
// the per-campaign stream coordinates live in the browser's localStorage.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PRESENTER_COOKIE, verifyPresenterToken } from "@/app/api/factory/present/session";
import { GalleryBoot } from "./GalleryBoot";

export const dynamic = "force-dynamic"; // reads the request cookie

export default async function GalleryPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const store = await cookies();
  if (!verifyPresenterToken(store.get(PRESENTER_COOKIE)?.value)) {
    redirect("/factory/multi-campaign-demo");
  }
  return (
    <main className="min-h-dvh">
      <GalleryBoot batchId={batchId} presenter />
    </main>
  );
}
