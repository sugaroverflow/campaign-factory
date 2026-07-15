// Shared store types. Runtime-neutral: no next/* imports. Every store function
// takes a `Db` (a `postgres` Sql instance) as its first argument so both the
// web app (pooled) and the worker (direct/unpooled) can inject their own.

import type { Sql } from "postgres";

export type Db = Sql;

// `postgres` requires JSON values to be wrapped with sql.json(). Our stored
// objects/arrays are JSON-safe; this is the parameter type json() expects.
export type JsonInput = Parameters<Db["json"]>[0];

// Rows come back with snake_case keys and untyped values.
export type Row = Record<string, unknown>;

export function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function toIsoOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  return toIso(v);
}

export function numOrUndef(v: unknown): number | undefined {
  if (v == null) return undefined;
  return Number(v);
}

export function strOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  return String(v);
}

export function newId(): string {
  return crypto.randomUUID();
}
