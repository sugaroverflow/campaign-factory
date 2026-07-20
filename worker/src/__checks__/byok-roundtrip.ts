// One-shot check: BYOK seal/open roundtrip, IV freshness, tamper detection.
// Run: FACTORY_MODEL_MODE=mock FACTORY_BYOK_SECRET=<any> npx tsx src/__checks__/byok-roundtrip.ts
import { sealByok, openByok, isByokBlob } from "../byok.js";

const key = "sk-ant-api03-test-roundtrip-key-000";
const blob = sealByok(key);
console.log("blob shape ok:", isByokBlob(blob), "| ciphertext hides key:", !JSON.stringify(blob).includes("test-roundtrip"));
console.log("roundtrip ok:", openByok(blob) === key);
const other = sealByok(key);
console.log("fresh IV per seal:", other.iv !== blob.iv);
try {
  openByok({ ...blob, tag: other.tag });
  console.log("TAMPER NOT DETECTED — BAD");
} catch {
  console.log("tamper detected: ok");
}
