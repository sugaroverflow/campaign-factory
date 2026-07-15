"use client";

// Small connection-state indicator for the Assembly View hero. Honest about the
// transport: live (SSE), polling (fallback), reconnecting, or error — never
// claims "live" when it is polling.

import type { ConnectionState } from "@/lib/factory/client";

const LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  live: "Live",
  polling: "Live (polling)",
  reconnecting: "Reconnecting…",
  closed: "Run finished",
  error: "Offline — retrying",
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className="fa-conn" data-state={state} title={`Stream: ${state}`}>
      <span className="fa-conn__dot" />
      {LABEL[state]}
    </span>
  );
}
