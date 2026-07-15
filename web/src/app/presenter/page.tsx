// Convenience alias: /presenter → the presenter desk.

import { redirect } from "next/navigation";

export default function PresenterAlias() {
  redirect("/factory/present");
}
