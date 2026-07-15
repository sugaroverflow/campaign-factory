// The multi-campaign demo (presenter desk). If a valid presenter session cookie
// is already present we skip straight to batch intake; otherwise a session is
// opened first. The cookie is HttpOnly and verified server-side (ADR 0013).

import { cookies } from "next/headers";
import { PRESENTER_COOKIE, verifyPresenterToken } from "@/app/api/factory/present/session";
import { PresenterEntry } from "./PresenterEntry";

export const dynamic = "force-dynamic"; // reads the request cookie

export default async function MultiCampaignDemoPage() {
  const store = await cookies();
  const authed = verifyPresenterToken(store.get(PRESENTER_COOKIE)?.value);
  return (
    <main className="min-h-dvh">
      <PresenterEntry initiallyAuthed={authed} />
    </main>
  );
}
