// BYOK (bring-your-own-key) sealed storage. Public runs carry the visitor's
// Anthropic API key: sealed with AES-256-GCM under FACTORY_BYOK_SECRET before
// it touches the database, opened only when a run executes, and stripped from
// run meta at the terminal event. The plaintext key must never be logged,
// emitted on an event, or included in an error message.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

export interface ByokBlob {
  v: 1;
  iv: string; // base64, 12 bytes
  tag: string; // base64 GCM auth tag
  data: string; // base64 ciphertext
}

export function byokEnabled(): boolean {
  return Boolean(config.byokSecret);
}

function aesKey(): Buffer {
  if (!config.byokSecret) throw new Error("FACTORY_BYOK_SECRET is not set");
  return createHash("sha256").update(config.byokSecret).digest();
}

export function sealByok(apiKey: string): ByokBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(), iv);
  const data = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function openByok(blob: ByokBlob): string {
  const decipher = createDecipheriv("aes-256-gcm", aesKey(), Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function isByokBlob(v: unknown): v is ByokBlob {
  const b = v as Partial<ByokBlob> | null;
  return Boolean(
    b && b.v === 1 && typeof b.iv === "string" && typeof b.tag === "string" && typeof b.data === "string",
  );
}
