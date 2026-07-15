import { notFound } from "next/navigation";
import { FixturePreview } from "./FixturePreview";

// Dev-only preview of the Campaign Assembly View driven by fixture events (W4).
// Not available in production. This never renders a real run — it replays a
// canned FactoryEvent sequence through the real fold + UI, clearly labelled.
export default function FactoryDevPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FixturePreview />;
}
