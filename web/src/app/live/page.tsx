// /live is the conference session surface: the pre-loaded 15-minute replay.
// (The true real-time spectator view remains at /factory/live.)

import { redirect } from "next/navigation";

export default function LiveAlias() {
  redirect("/factory/replay/conference");
}
