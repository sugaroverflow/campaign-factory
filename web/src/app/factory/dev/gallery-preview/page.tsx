// Dev-only fixture preview of the Factory Gallery. Not available in production.
import { notFound } from "next/navigation";
import { GalleryPreviewClient } from "./GalleryPreviewClient";

export const dynamic = "force-dynamic";

export default function GalleryPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="min-h-dvh">
      <GalleryPreviewClient />
    </main>
  );
}
