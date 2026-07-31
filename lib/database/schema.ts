import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const binary = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    protocolVersion: smallint("protocol_version").notNull().default(1),
    iv: binary("iv").notNull(),
    ciphertext: binary("ciphertext").notNull(),
    payloadBytes: integer("payload_bytes").notNull(),
    passwordHash: text("password_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notes_expires_at_idx").on(table.expiresAt),
    check("notes_protocol_version_check", sql`${table.protocolVersion} = 1`),
    check("notes_iv_length_check", sql`octet_length(${table.iv}) = 12`),
    check(
      "notes_payload_size_check",
      sql`${table.payloadBytes} = octet_length(${table.ciphertext}) AND ${table.payloadBytes} BETWEEN 16 AND 65552`,
    ),
    check("notes_id_format_check", sql`${table.id} ~ '^[A-Za-z0-9_-]{32}$'`),
    check(
      "notes_expiry_check",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const noteCapacity = pgTable(
  "note_capacity",
  {
    id: integer("id").primaryKey(),
    activeNoteCount: bigint("active_note_count", { mode: "number" })
      .notNull()
      .default(0),
    activePayloadBytes: bigint("active_payload_bytes", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("note_capacity_id_check", sql`${table.id} = 1`),
    check("note_capacity_count_check", sql`${table.activeNoteCount} >= 0`),
    check("note_capacity_bytes_check", sql`${table.activePayloadBytes} >= 0`),
  ],
);

export const noteCreateIdempotency = pgTable(
  "note_create_idempotency",
  {
    keyDigest: binary("key_digest").primaryKey(),
    requestFingerprint: binary("request_fingerprint").notNull(),
    noteIdDigest: binary("note_id_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    noteDeletedAt: timestamp("note_deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
    responseExpiresAt: timestamp("response_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    surface: text("surface").notNull(),
  },
  (table) => [
    uniqueIndex("note_create_idempotency_note_id_digest_uq").on(
      table.noteIdDigest,
    ),
    index("note_create_idempotency_deleted_idx").on(table.noteDeletedAt),
    check(
      "note_create_idempotency_key_digest_len_check",
      sql`octet_length(${table.keyDigest}) = 32`,
    ),
    check(
      "note_create_idempotency_fingerprint_len_check",
      sql`octet_length(${table.requestFingerprint}) = 32`,
    ),
    check(
      "note_create_idempotency_note_digest_len_check",
      sql`octet_length(${table.noteIdDigest}) = 32`,
    ),
    check(
      "note_create_idempotency_surface_check",
      sql`${table.surface} IN ('clearnet', 'onion')`,
    ),
  ],
);

export const schemaVersion = pgTable(
  "shredit_schema_version",
  {
    singleton: boolean("singleton").primaryKey().notNull().default(true),
    version: integer("version").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "shredit_schema_version_singleton_check",
      sql`${table.singleton} = true`,
    ),
    check("shredit_schema_version_positive_check", sql`${table.version} >= 1`),
  ],
);

export const schema = {
  notes,
  noteCapacity,
  noteCreateIdempotency,
  schemaVersion,
};
