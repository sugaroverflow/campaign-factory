// The worker's own postgres.js client (direct/unpooled connection). This is the
// `sql` handed to the store facade and to w3's executor via ExecutorDeps.
//
// pg-boss and PostgresSaver open their OWN pools from the same connection
// string (they use node-postgres internally); this module is only the store +
// LISTEN client.

import postgres from "postgres";
import { config, needsSsl, requireDatabaseUrl } from "../config.js";

export type Sql = ReturnType<typeof postgres>;

let client: Sql | null = null;

export function sql(): Sql {
  if (client) return client;
  const url = requireDatabaseUrl();
  client = postgres(url, {
    ssl: needsSsl(url) ? "require" : false,
    max: config.dbPoolMax,
    idle_timeout: 20,
    // Keep names stable so DB dashboards show the worker distinctly.
    connection: { application_name: "campaign-factory-worker" },
  });
  return client;
}

export async function closeSql(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
}
