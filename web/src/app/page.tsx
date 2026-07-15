// The factory is the front door (conference decision, 15 Jul 2026).
// The single-agent legacy builder lives unlinked at /legacy.

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/factory");
}
