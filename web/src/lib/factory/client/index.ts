// Client event runtime (W4). Owned here; W5 (gallery) and W7 (replay) build on
// the pure fold. Keep this barrel free of Next-only imports so the fold stays
// unit-testable and reusable from a replay renderer.

export * from "./fold";
export * from "./storage";
export { useFactoryRun } from "./useFactoryRun";
export type { ConnectionState, UseFactoryRunOptions, UseFactoryRunResult } from "./useFactoryRun";
