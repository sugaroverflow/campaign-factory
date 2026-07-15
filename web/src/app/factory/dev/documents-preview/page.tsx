import { notFound } from "next/navigation";
import { DocumentsPreview } from "./DocumentsPreview";

// Dev-only preview of the W6 documents surface: the nine-document Library, the
// Your Judgement Card in all three states, and the Campaign Completion + Batch
// receipts — all driven by a clearly-labelled fixture (no real run, no network,
// no model calls). Not available in production.
export default function DocumentsPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DocumentsPreview />;
}
