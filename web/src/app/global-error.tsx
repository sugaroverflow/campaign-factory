"use client";

// Root-level error boundary. Replaces the root layout when an error escapes it,
// so it MUST render its own <html>/<body> and cannot rely on the app's fonts or
// stylesheets — everything here is inline and self-contained.
// Next 16 also exposes `unstable_retry`; `reset()` is the stable prop we use here.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fff" }}>
        <div
          style={{
            maxWidth: "34rem",
            margin: "0 auto",
            padding: "3rem 1.25rem",
            color: "#1a1a1a",
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.5,
          }}
        >
          <h1 style={{ fontSize: "1.35rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
            Something went wrong on this page
          </h1>
          <p style={{ margin: "0 0 1.5rem", color: "#444" }}>
            Your campaign run is still going in the background. You can try
            re-loading this view, or head back to the Factory.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <button
              onClick={() => reset()}
              style={{
                appearance: "none",
                border: "none",
                borderRadius: "8px",
                background: "#1a1a1a",
                color: "#fff",
                padding: "0.7rem 1.1rem",
                fontSize: "1rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a href="/factory" style={{ color: "#1a1a1a", fontSize: "1rem", textDecoration: "underline" }}>
              Back to the Factory
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
