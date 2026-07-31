CREATE TABLE IF NOT EXISTS "notes" (
  "id" text PRIMARY KEY NOT NULL,
  "protocol_version" smallint NOT NULL DEFAULT 1,
  "iv" bytea NOT NULL,
  "ciphertext" bytea NOT NULL,
  "payload_bytes" integer NOT NULL,
  "password_hash" text,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notes_protocol_version_check" CHECK ("protocol_version" = 1),
  CONSTRAINT "notes_iv_length_check" CHECK (octet_length("iv") = 12),
  CONSTRAINT "notes_payload_size_check" CHECK ("payload_bytes" = octet_length("ciphertext") AND "payload_bytes" BETWEEN 16 AND 65552),
  CONSTRAINT "notes_id_format_check" CHECK ("id" ~ '^[A-Za-z0-9_-]{32}$'),
  CONSTRAINT "notes_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "created_at")
);
CREATE INDEX IF NOT EXISTS "notes_expires_at_idx" ON "notes" USING btree ("expires_at");

CREATE TABLE IF NOT EXISTS "note_capacity" (
  "id" integer PRIMARY KEY NOT NULL,
  "active_note_count" bigint NOT NULL DEFAULT 0,
  "active_payload_bytes" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "note_capacity_id_check" CHECK ("id" = 1),
  CONSTRAINT "note_capacity_count_check" CHECK ("active_note_count" >= 0),
  CONSTRAINT "note_capacity_bytes_check" CHECK ("active_payload_bytes" >= 0)
);

CREATE TABLE IF NOT EXISTS "note_create_idempotency" (
  "key_digest" bytea PRIMARY KEY NOT NULL,
  "request_fingerprint" bytea NOT NULL,
  "note_id_digest" bytea NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "note_deleted_at" timestamptz,
  "response_expires_at" timestamptz,
  "surface" text NOT NULL,
  CONSTRAINT "note_create_idempotency_key_digest_len_check" CHECK (octet_length("key_digest") = 32),
  CONSTRAINT "note_create_idempotency_fingerprint_len_check" CHECK (octet_length("request_fingerprint") = 32),
  CONSTRAINT "note_create_idempotency_note_digest_len_check" CHECK (octet_length("note_id_digest") = 32),
  CONSTRAINT "note_create_idempotency_surface_check" CHECK ("surface" IN ('clearnet', 'onion'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "note_create_idempotency_note_id_digest_uq" ON "note_create_idempotency" USING btree ("note_id_digest");
CREATE INDEX IF NOT EXISTS "note_create_idempotency_deleted_idx" ON "note_create_idempotency" USING btree ("note_deleted_at");

CREATE TABLE IF NOT EXISTS "shredit_schema_version" (
  "singleton" boolean PRIMARY KEY NOT NULL DEFAULT true,
  "version" integer NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shredit_schema_version_singleton_check" CHECK ("singleton" = true),
  CONSTRAINT "shredit_schema_version_positive_check" CHECK ("version" >= 1)
);

INSERT INTO "shredit_schema_version" ("singleton", "version")
VALUES (true, 1)
ON CONFLICT ("singleton") DO UPDATE SET "version" = EXCLUDED."version", "applied_at" = now();

INSERT INTO "note_capacity" ("id", "active_note_count", "active_payload_bytes")
VALUES (1, (SELECT count(*) FROM "notes" WHERE "expires_at" IS NULL OR "expires_at" > now()), (SELECT coalesce(sum("payload_bytes"), 0) FROM "notes" WHERE "expires_at" IS NULL OR "expires_at" > now()))
ON CONFLICT ("id") DO NOTHING;
