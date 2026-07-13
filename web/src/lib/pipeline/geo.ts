import { type SourceClaim } from "./types";

// Deterministic, keyless geography lookup via postcodes.io (ONS data). Ported
// verbatim in spirit from the prototype: if the input contains a UK postcode,
// resolve ward / constituency / local authority as a Verified claim. No LLM.
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/;

export async function postcodeLookup(location: string): Promise<SourceClaim | null> {
  const m = (location || "").toUpperCase().match(UK_POSTCODE);
  if (!m) return null;
  try {
    const res = await fetch(
      "https://api.postcodes.io/postcodes/" + encodeURIComponent(m[0].replace(/\s/g, "")),
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: PostcodeResult };
    const d = j.result;
    if (!d) return null;
    return {
      claim: `${m[0]} → ward ${d.admin_ward}, constituency ${d.parliamentary_constituency}, local authority ${d.admin_district}`,
      status: "Verified public information",
      sourceTitle: "postcodes.io postcode lookup",
      sourceOrg: "postcodes.io (ONS data)",
      url: "https://api.postcodes.io",
      date: "",
      accessDate: new Date().toISOString().slice(0, 10),
      evidence: `admin_ward=${d.admin_ward}; constituency=${d.parliamentary_constituency}; district=${d.admin_district}`,
      confidence: "High",
      usedFor: "Researched context; Power & Stakeholder Map",
    };
  } catch {
    return null;
  }
}

export interface PostcodeResult {
  admin_ward: string;
  parliamentary_constituency: string;
  admin_district: string;
  [k: string]: unknown;
}
