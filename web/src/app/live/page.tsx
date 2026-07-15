// Old alias kept so links shared before the rename survive. The session
// surface is /replay (user decision, 15 Jul 2026); the true real-time
// spectator view remains at /factory/live.

import { redirect } from "next/navigation";

export default function LiveAlias() {
  redirect("/replay");
}
