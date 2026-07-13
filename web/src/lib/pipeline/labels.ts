// The seven verification labels. This is the product's integrity spine: every
// claim carries exactly one of these, enforced as an enum. Order is significant
// only for display grouping, not precedence.
export const VERIFICATION_LABELS = [
  "Verified public information",
  "Supported inference",
  "Generated campaign recommendation",
  "Campaign assumption",
  "Conflicting evidence",
  "Verification incomplete",
  "External information unavailable",
] as const;

export type VerificationLabel = (typeof VERIFICATION_LABELS)[number];

export function isVerificationLabel(v: unknown): v is VerificationLabel {
  return typeof v === "string" && (VERIFICATION_LABELS as readonly string[]).includes(v);
}

// Coerce an unknown model-supplied label to a valid one. Anything off-enum is
// treated as unverified rather than silently trusted — the no-synthetic-data
// principle applied to labels themselves.
export function coerceLabel(v: unknown): VerificationLabel {
  return isVerificationLabel(v) ? v : "Verification incomplete";
}
