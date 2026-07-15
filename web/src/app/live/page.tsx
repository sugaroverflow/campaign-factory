// Convenience alias: /live → the factory spectator view.

import { redirect } from "next/navigation";

export default function LiveAlias() {
  redirect("/factory/live");
}
