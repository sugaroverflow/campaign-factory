import { type RunInput } from "./types";

// Strip the API key before anything gets sent to a model or persisted. The key
// is a per-run secret (BYOK seam) and must never enter a prompt or the DB.
export function publicInput(input: RunInput): Omit<RunInput, "apiKey"> {
  const rest: Omit<RunInput, "apiKey"> & { apiKey?: string } = { ...input };
  delete rest.apiKey;
  return rest;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function now(): string {
  return new Date().toISOString();
}
