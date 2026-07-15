// LangGraph PostgresSaver checkpointer in schema `lg` (ADR 0016). Its own pg
// Pool so SSL can be set explicitly for Neon. setup() creates the checkpoint
// tables; the graph checkpoints after every completed node so a worker restart
// resumes each campaign from its last checkpoint (thread_id = campaignId).

import pg from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { CHECKPOINT_SCHEMA } from "@web/lib/factory/contracts/tables.js";
import { needsSsl, requireDatabaseUrl } from "../config.js";

let pool: pg.Pool | null = null;
let saver: PostgresSaver | null = null;

export function getCheckpointer(): PostgresSaver {
  if (saver) return saver;
  const url = requireDatabaseUrl();
  pool = new pg.Pool({
    connectionString: url,
    ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined,
    max: 5,
    application_name: "campaign-factory-worker-checkpoints",
  });
  saver = new PostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA });
  return saver;
}

export async function setupCheckpointer(): Promise<void> {
  await getCheckpointer().setup();
}

export async function closeCheckpointer(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    saver = null;
  }
}
