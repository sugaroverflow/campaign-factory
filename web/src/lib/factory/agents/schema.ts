// Hand-built JSON-Schema toolkit for the factory agents (style of
// pipeline/schemas.ts). Each agent ships a schema that (a) is serialised into
// its prompt as the exact required output shape and (b) drives a light
// validation pass that gates the one correction retry. Runtime-neutral: no
// node/next imports.

export type JSchema = Record<string, unknown>;

export const str: JSchema = { type: "string" };
export const bool: JSchema = { type: "boolean" };
export const int: JSchema = { type: "integer" };
export const num: JSchema = { type: "number" };

export const S = (props: Record<string, JSchema>, req?: string[]): JSchema => ({
  type: "object",
  properties: props,
  required: req ?? Object.keys(props),
  additionalProperties: false,
});

export const A = (items: JSchema): JSchema => ({ type: "array", items });

export const strA = A(str);

export const enumStr = (values: readonly string[]): JSchema => ({
  type: "string",
  enum: [...values],
});

// ---- Prompt shape describer ----------------------------------------------
// Turns a JSchema into a compact, human-legible shape the model can follow.
// Optional keys (those absent from `required`) are suffixed with "?".
export function describeSchema(schema: JSchema, indent = 0): string {
  const pad = "  ".repeat(indent);
  const padIn = "  ".repeat(indent + 1);
  const t = schema.type as string | undefined;

  if (Array.isArray(schema.enum)) {
    return (schema.enum as string[]).map((v) => JSON.stringify(v)).join(" | ");
  }
  if (t === "object") {
    const props = (schema.properties ?? {}) as Record<string, JSchema>;
    const required = new Set((schema.required as string[] | undefined) ?? Object.keys(props));
    const keys = Object.keys(props);
    if (keys.length === 0) return "{}";
    const lines = keys.map((k) => {
      const opt = required.has(k) ? "" : "?";
      return `${padIn}${k}${opt}: ${describeSchema(props[k], indent + 1)}`;
    });
    return `{\n${lines.join(",\n")}\n${pad}}`;
  }
  if (t === "array") {
    return `[${describeSchema((schema.items ?? {}) as JSchema, indent)}]`;
  }
  if (t === "integer") return "integer";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  return "string";
}

// ---- Light validator ------------------------------------------------------
// Enforces required keys, primitive types, enum membership, and array element
// types. It does NOT reject unexpected extra keys (models sometimes add prose
// fields) — tolerant by design, since the executor strips to the contract in
// toResult anyway. Returns human-readable error strings for the retry prompt.
export function validateAgainst(schema: JSchema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  const t = schema.type as string | undefined;

  if (Array.isArray(schema.enum)) {
    if (typeof value !== "string" || !(schema.enum as string[]).includes(value)) {
      errors.push(`${path}: expected one of ${(schema.enum as string[]).map((v) => `"${v}"`).join(", ")}`);
    }
    return errors;
  }

  switch (t) {
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${path}: expected object`);
        return errors;
      }
      const props = (schema.properties ?? {}) as Record<string, JSchema>;
      const required = (schema.required as string[] | undefined) ?? Object.keys(props);
      const obj = value as Record<string, unknown>;
      for (const key of required) {
        if (obj[key] === undefined || obj[key] === null) {
          errors.push(`${path}.${key}: required field missing`);
        }
      }
      for (const [key, sub] of Object.entries(props)) {
        if (obj[key] !== undefined && obj[key] !== null) {
          errors.push(...validateAgainst(sub, obj[key], `${path}.${key}`));
        }
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`);
        return errors;
      }
      const items = (schema.items ?? {}) as JSchema;
      value.forEach((el, i) => errors.push(...validateAgainst(items, el, `${path}[${i}]`)));
      break;
    }
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) errors.push(`${path}: expected integer`);
      break;
    case "number":
      if (typeof value !== "number") errors.push(`${path}: expected number`);
      break;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${path}: expected boolean`);
      break;
    case "string":
    default:
      if (typeof value !== "string") errors.push(`${path}: expected string`);
      break;
  }
  return errors;
}
