// Shared factory contracts — the single source of truth for types crossing
// workstream boundaries. Owned by the build coordinator; workstreams request
// changes rather than editing. Everything here is runtime-neutral (importable
// from Next.js and the worker alike).
//
// Worker-side gotcha: tsx/esbuild cannot statically link named VALUE imports
// through `export *` barrels. Worker code must import runtime values from the
// specific module (./roster, ./journey, ./limits, …); type-only imports may
// use this barrel freely.

export * from "./core";
export * from "./journey";
export * from "./documents";
export * from "./evidence";
export * from "./roster";
export * from "./state";
export * from "./envelope";
export * from "./limits";
export * from "./api";
export * from "./tables";
