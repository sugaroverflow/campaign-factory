// Old presenter-desk path, kept so existing links and QR codes survive the
// rename to /factory/multi-campaign-demo (15 Jul 2026).

import { redirect } from "next/navigation";

export default function PresentAlias() {
  redirect("/factory/multi-campaign-demo");
}
