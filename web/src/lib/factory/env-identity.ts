// Environment Identity Check (ADR 0014, parameters §9). Fail-closed: run
// creation is blocked unless the declared FACTORY_ENV_ID matches the single
// database marker row. Runtime-neutral (takes a Db); used by both web and
// worker before accepting work.

import type { Db } from "./store/types";

export const ENV_ID_VAR = "FACTORY_ENV_ID";

/** Current marker value, or null if the marker row is absent. */
export async function getEnvironmentIdentity(sql: Db): Promise<string | null> {
  const rows = await sql<{ environment_id: string }[]>`
    select environment_id from factory.environment_identity where id = 1`;
  return rows.length ? rows[0].environment_id : null;
}

/**
 * Throw unless the declared FACTORY_ENV_ID matches the DB marker row.
 * Fails closed on: unset FACTORY_ENV_ID, missing marker row, or mismatch.
 */
export async function assertEnvironmentIdentity(sql: Db): Promise<void> {
  const declared = process.env[ENV_ID_VAR];
  if (!declared) {
    throw new Error(`Environment identity check failed: ${ENV_ID_VAR} is not set (fail-closed).`);
  }
  const marker = await getEnvironmentIdentity(sql);
  if (marker === null) {
    throw new Error(
      "Environment identity check failed: no factory.environment_identity marker row " +
        "(seed it on first boot with seedEnvironmentIdentity). Run creation blocked (fail-closed).",
    );
  }
  if (marker !== declared) {
    throw new Error(
      `Environment identity mismatch: declared ${ENV_ID_VAR}='${declared}' but database ` +
        `marker='${marker}'. Run creation blocked (fail-closed).`,
    );
  }
}

/**
 * First-boot seed. Inserts the marker row only if the table is empty; a second
 * call with a different id is a no-op (the row is a permanent singleton).
 * Returns the effective marker value.
 */
export async function seedEnvironmentIdentity(sql: Db, envId: string): Promise<string> {
  await sql`
    insert into factory.environment_identity (id, environment_id)
    values (1, ${envId})
    on conflict (id) do nothing`;
  const marker = await getEnvironmentIdentity(sql);
  if (marker === null) {
    throw new Error("seedEnvironmentIdentity: failed to read marker row after insert");
  }
  return marker;
}
