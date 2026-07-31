import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { getEnv } from "@/lib/config/env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let database: Database | undefined;

export function getPool(): Pool {
  if (pool) return pool;
  const env = getEnv();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    application_name: "shredit",
  });
  return pool;
}

export function getDatabase(): Database {
  if (database) return database;
  database = drizzle(getPool(), { schema });
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
  database = undefined;
}

export async function databasePing(): Promise<boolean> {
  try {
    const db = getDatabase();
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function databaseReady(): Promise<boolean> {
  try {
    const db = getDatabase();
    const result = await db.execute<{ ready: boolean }>(sql`
      select (
        exists(select 1 from shredit_schema_version where singleton = true and version = 1)
        and exists(select 1 from note_capacity where id = 1)
        and to_regclass('public.notes') is not null
        and to_regclass('public.note_create_idempotency') is not null
        and to_regclass('public.notes_expires_at_idx') is not null
        and to_regclass('public.note_create_idempotency_note_id_digest_uq') is not null
        and not exists (
          select 1
          from (values
            ('notes', 'notes_protocol_version_check'),
            ('notes', 'notes_iv_length_check'),
            ('notes', 'notes_payload_size_check'),
            ('notes', 'notes_id_format_check'),
            ('notes', 'notes_expiry_check'),
            ('note_capacity', 'note_capacity_id_check'),
            ('note_capacity', 'note_capacity_count_check'),
            ('note_capacity', 'note_capacity_bytes_check'),
            ('note_create_idempotency', 'note_create_idempotency_key_digest_len_check'),
            ('note_create_idempotency', 'note_create_idempotency_fingerprint_len_check'),
            ('note_create_idempotency', 'note_create_idempotency_note_digest_len_check'),
            ('note_create_idempotency', 'note_create_idempotency_surface_check'),
            ('shredit_schema_version', 'shredit_schema_version_singleton_check'),
            ('shredit_schema_version', 'shredit_schema_version_positive_check')
          ) as expected(table_name, constraint_name)
          left join pg_class relation
            on relation.relname = expected.table_name
           and relation.relnamespace = 'public'::regnamespace
          left join pg_constraint constraint_record
            on constraint_record.conrelid = relation.oid
           and constraint_record.conname = expected.constraint_name
          where constraint_record.oid is null
        )
      ) as ready
    `);
    return result.rows[0]?.ready === true;
  } catch {
    return false;
  }
}
