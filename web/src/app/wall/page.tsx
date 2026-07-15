// Old gallery path, kept so shared links survive the rename to /gallery
// (15 Jul 2026).

import { redirect } from "next/navigation";

export default function WallAlias() {
  redirect("/gallery");
}
