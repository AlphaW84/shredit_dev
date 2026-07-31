import { timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { PoolClient } from "pg";
import { getEnv, type RequestSurface } from "@/lib/config/env";
import { verifyPassword } from "@/lib/crypto/password";
import { noteIdDigest, type ExpirySelection } from "@/lib/crypto/protocol";
import { getDatabase, getPool } from "@/lib/database/client";
import { noteCreateIdempotency, notes } from "@/lib/database/schema";

type Hex = string;

export interface NoteCreateRecord {
  id: string;
  protocolVersion: 1;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  expiresAt: Date | null;
  passwordHash?: string;
  keyDigest: Uint8Array;
  fingerprint: Uint8Array;
  noteIdDigest: Uint8Array;
  surface: RequestSurface;
}

export interface ReplayLookup {
  id: string;
  keyDigest: Uint8Array;
  fingerprint: Uint8Array;
  surface: RequestSurface;
}

interface StoredNote extends NoteCreateRecord {
  createdAt: Date;
  payloadBytes: number;
}

interface IdempotencyRow {
  keyDigest: Uint8Array;
  fingerprint: Uint8Array;
  noteIdDigest: Uint8Array;
  surface: RequestSurface;
  expiresAt: Date | null;
  createdAt: Date;
  noteDeletedAt: Date | null;
}

export type ReplayResult =
  | { kind: "missing" }
  | { kind: "replay"; id: string; expiresAt: Date | null }
  | { kind: "idempotency-conflict" };

export type CreateResult =
  | { kind: "created"; id: string; expiresAt: Date | null }
  | { kind: "replay"; id: string; expiresAt: Date | null }
  | { kind: "idempotency-conflict" }
  | { kind: "note-id-conflict" }
  | { kind: "storage-full" };

export type ConsumeResult =
  | {
      kind: "success";
      protocolVersion: 1;
      id: string;
      iv: Uint8Array;
      ciphertext: Uint8Array;
    }
  | { kind: "unavailable" };

interface NoteStoreBackend {
  checkReplay(input: ReplayLookup): Promise<ReplayResult>;
  hasNoteIdCollision(id: string, digest: Uint8Array): Promise<boolean>;
  create(input: NoteCreateRecord): Promise<CreateResult>;
  metadata(id: string): Promise<{ requiresPassword: boolean } | null>;
  consume(id: string, password?: string): Promise<ConsumeResult>;
  cleanupExpired(
    limit?: number,
  ): Promise<{ deleted: number; payloadBytes: number }>;
  cleanupTombstones(retentionDays: number): Promise<number>;
  reconcile(): Promise<{ activeNoteCount: number; activePayloadBytes: number }>;
  stats(): Promise<{ activeNoteCount: number; activePayloadBytes: number }>;
  resetForTests(): Promise<void>;
}

function hex(bytes: Uint8Array): Hex {
  return Buffer.from(bytes).toString("hex");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

class MemoryNoteStore implements NoteStoreBackend {
  private readonly notes = new Map<string, StoredNote>();
  private readonly idempotency = new Map<Hex, IdempotencyRow>();
  private activeNoteCount = 0;
  private activePayloadBytes = 0;
  private lock: Promise<void> = Promise.resolve();

  private async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private removeLocked(note: StoredNote, now: Date): void {
    this.notes.delete(note.id);
    this.activeNoteCount -= 1;
    this.activePayloadBytes -= note.payloadBytes;
    const row = this.idempotency.get(hex(note.keyDigest));
    if (row) row.noteDeletedAt = now;
  }

  async checkReplay(input: ReplayLookup): Promise<ReplayResult> {
    return this.withLock(() => {
      const existing = this.idempotency.get(hex(input.keyDigest));
      if (!existing) return { kind: "missing" };
      if (
        !equalBytes(existing.fingerprint, input.fingerprint) ||
        existing.surface !== input.surface
      ) {
        return { kind: "idempotency-conflict" };
      }
      return { kind: "replay", id: input.id, expiresAt: existing.expiresAt };
    });
  }

  async hasNoteIdCollision(id: string, digest: Uint8Array): Promise<boolean> {
    return this.withLock(
      () =>
        this.notes.has(id) ||
        Array.from(this.idempotency.values()).some((row) =>
          equalBytes(row.noteIdDigest, digest),
        ),
    );
  }

  async create(input: NoteCreateRecord): Promise<CreateResult> {
    return this.withLock(() => {
      const key = hex(input.keyDigest);
      const existing = this.idempotency.get(key);
      if (existing) {
        if (
          !equalBytes(existing.fingerprint, input.fingerprint) ||
          existing.surface !== input.surface
        ) {
          return { kind: "idempotency-conflict" };
        }
        return { kind: "replay", id: input.id, expiresAt: existing.expiresAt };
      }

      const sameNoteId = Array.from(this.idempotency.values()).some((row) =>
        equalBytes(row.noteIdDigest, input.noteIdDigest),
      );
      if (sameNoteId || this.notes.has(input.id))
        return { kind: "note-id-conflict" };

      const env = getEnv();
      const payloadBytes = input.ciphertext.byteLength;
      const maxBytes = env.MAX_ACTIVE_NOTE_BYTES ?? 268_435_456;
      const maxCount = env.MAX_ACTIVE_NOTE_COUNT ?? 10_000;
      if (
        this.activeNoteCount + 1 > maxCount ||
        this.activePayloadBytes + payloadBytes > maxBytes
      ) {
        return { kind: "storage-full" };
      }

      const now = new Date();
      const note: StoredNote = { ...input, createdAt: now, payloadBytes };
      this.notes.set(note.id, note);
      this.idempotency.set(key, {
        keyDigest: input.keyDigest,
        fingerprint: input.fingerprint,
        noteIdDigest: input.noteIdDigest,
        surface: input.surface,
        expiresAt: input.expiresAt,
        createdAt: now,
        noteDeletedAt: null,
      });
      this.activeNoteCount += 1;
      this.activePayloadBytes += payloadBytes;
      return { kind: "created", id: note.id, expiresAt: note.expiresAt };
    });
  }

  async metadata(id: string): Promise<{ requiresPassword: boolean } | null> {
    return this.withLock(() => {
      const note = this.notes.get(id);
      if (!note) return null;
      if (note.expiresAt && note.expiresAt.getTime() <= Date.now()) {
        this.removeLocked(note, new Date());
        return null;
      }
      return { requiresPassword: Boolean(note.passwordHash) };
    });
  }

  async consume(id: string, password?: string): Promise<ConsumeResult> {
    const candidate = await this.withLock(() => {
      const note = this.notes.get(id);
      if (!note) return undefined;
      if (note.expiresAt && note.expiresAt.getTime() <= Date.now()) {
        this.removeLocked(note, new Date());
        return undefined;
      }
      return { passwordHash: note.passwordHash };
    });
    if (!candidate) return { kind: "unavailable" };
    if (candidate.passwordHash) {
      if (!password) return { kind: "unavailable" };
      try {
        if (!(await verifyPassword(password, candidate.passwordHash)))
          return { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    } else if (password !== undefined) {
      return { kind: "unavailable" };
    }

    return this.withLock(() => {
      const current = this.notes.get(id);
      if (
        !current ||
        (current.expiresAt && current.expiresAt.getTime() <= Date.now())
      ) {
        if (current) this.removeLocked(current, new Date());
        return { kind: "unavailable" };
      }
      if (current.passwordHash !== candidate.passwordHash)
        return { kind: "unavailable" };
      const result = {
        kind: "success" as const,
        protocolVersion: current.protocolVersion,
        id: current.id,
        iv: current.iv,
        ciphertext: current.ciphertext,
      };
      this.removeLocked(current, new Date());
      return result;
    });
  }

  async cleanupExpired(
    limit = 100,
  ): Promise<{ deleted: number; payloadBytes: number }> {
    return this.withLock(() => {
      const now = Date.now();
      let deleted = 0;
      let payloadBytes = 0;
      for (const note of this.notes.values()) {
        if (deleted >= limit) break;
        if (note.expiresAt && note.expiresAt.getTime() <= now) {
          payloadBytes += note.payloadBytes;
          this.removeLocked(note, new Date(now));
          deleted += 1;
        }
      }
      return { deleted, payloadBytes };
    });
  }

  async cleanupTombstones(retentionDays: number): Promise<number> {
    return this.withLock(() => {
      const cutoff = Date.now() - retentionDays * 86_400_000;
      let deleted = 0;
      for (const [key, row] of this.idempotency) {
        if (row.noteDeletedAt && row.noteDeletedAt.getTime() <= cutoff) {
          this.idempotency.delete(key);
          deleted += 1;
        }
      }
      return deleted;
    });
  }

  async reconcile(): Promise<{
    activeNoteCount: number;
    activePayloadBytes: number;
  }> {
    return this.withLock(() => {
      let activeNoteCount = 0;
      let activePayloadBytes = 0;
      for (const note of this.notes.values()) {
        if (!note.expiresAt || note.expiresAt.getTime() > Date.now()) {
          activeNoteCount += 1;
          activePayloadBytes += note.payloadBytes;
        }
      }
      this.activeNoteCount = activeNoteCount;
      this.activePayloadBytes = activePayloadBytes;
      return { activeNoteCount, activePayloadBytes };
    });
  }

  async stats(): Promise<{
    activeNoteCount: number;
    activePayloadBytes: number;
  }> {
    return this.withLock(() => ({
      activeNoteCount: this.activeNoteCount,
      activePayloadBytes: this.activePayloadBytes,
    }));
  }

  async resetForTests(): Promise<void> {
    await this.withLock(() => {
      this.notes.clear();
      this.idempotency.clear();
      this.activeNoteCount = 0;
      this.activePayloadBytes = 0;
    });
  }
}

class PostgresNoteStore implements NoteStoreBackend {
  async checkReplay(input: ReplayLookup): Promise<ReplayResult> {
    const [row] = await getDatabase()
      .select({
        requestFingerprint: noteCreateIdempotency.requestFingerprint,
        responseExpiresAt: noteCreateIdempotency.responseExpiresAt,
        surface: noteCreateIdempotency.surface,
      })
      .from(noteCreateIdempotency)
      .where(eq(noteCreateIdempotency.keyDigest, Buffer.from(input.keyDigest)))
      .limit(1);
    if (!row) return { kind: "missing" };
    if (
      !equalBytes(row.requestFingerprint, input.fingerprint) ||
      row.surface !== input.surface
    ) {
      return { kind: "idempotency-conflict" };
    }
    return { kind: "replay", id: input.id, expiresAt: row.responseExpiresAt };
  }

  async hasNoteIdCollision(id: string, digest: Uint8Array): Promise<boolean> {
    const result = await getPool().query(
      "SELECT 1 FROM notes WHERE id = $1 UNION ALL SELECT 1 FROM note_create_idempotency WHERE note_id_digest = $2 LIMIT 1",
      [id, Buffer.from(digest)],
    );
    return Boolean(result.rowCount);
  }

  async create(input: NoteCreateRecord): Promise<CreateResult> {
    const env = getEnv();
    return transaction(async (client) => {
      const capacity = await client.query<{
        active_note_count: string;
        active_payload_bytes: string;
      }>(
        "SELECT active_note_count, active_payload_bytes FROM note_capacity WHERE id = 1 FOR UPDATE",
      );
      if (capacity.rowCount !== 1)
        throw new Error("Capacity ledger is not initialized");

      const existing = await client.query<{
        request_fingerprint: Buffer;
        response_expires_at: Date | null;
        surface: string;
      }>(
        "SELECT request_fingerprint, response_expires_at, surface FROM note_create_idempotency WHERE key_digest = $1",
        [Buffer.from(input.keyDigest)],
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (
          !equalBytes(row.request_fingerprint, input.fingerprint) ||
          row.surface !== input.surface
        ) {
          return { kind: "idempotency-conflict" };
        }
        return {
          kind: "replay",
          id: input.id,
          expiresAt: row.response_expires_at,
        };
      }

      const collision = await client.query(
        "SELECT 1 FROM notes WHERE id = $1 UNION ALL SELECT 1 FROM note_create_idempotency WHERE note_id_digest = $2 LIMIT 1",
        [input.id, Buffer.from(input.noteIdDigest)],
      );
      if (collision.rowCount) return { kind: "note-id-conflict" };

      const activeNoteCount = Number(capacity.rows[0].active_note_count);
      const activePayloadBytes = Number(capacity.rows[0].active_payload_bytes);
      const maxCount = env.MAX_ACTIVE_NOTE_COUNT;
      const maxBytes = env.MAX_ACTIVE_NOTE_BYTES;
      if (!maxCount || !maxBytes)
        throw new Error("Finite capacity is not configured");
      if (
        activeNoteCount + 1 > maxCount ||
        activePayloadBytes + input.ciphertext.byteLength > maxBytes
      ) {
        return { kind: "storage-full" };
      }

      await client.query(
        `INSERT INTO notes (id, protocol_version, iv, ciphertext, payload_bytes, password_hash, expires_at)
         VALUES ($1, 1, $2, $3, $4, $5, $6)`,
        [
          input.id,
          Buffer.from(input.iv),
          Buffer.from(input.ciphertext),
          input.ciphertext.byteLength,
          input.passwordHash ?? null,
          input.expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO note_create_idempotency
           (key_digest, request_fingerprint, note_id_digest, response_expires_at, surface)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          Buffer.from(input.keyDigest),
          Buffer.from(input.fingerprint),
          Buffer.from(input.noteIdDigest),
          input.expiresAt,
          input.surface,
        ],
      );
      await client.query(
        `UPDATE note_capacity
         SET active_note_count = active_note_count + 1,
             active_payload_bytes = active_payload_bytes + $1,
             updated_at = now()
         WHERE id = 1`,
        [input.ciphertext.byteLength],
      );
      return { kind: "created", id: input.id, expiresAt: input.expiresAt };
    });
  }

  async metadata(id: string): Promise<{ requiresPassword: boolean } | null> {
    const [row] = await getDatabase()
      .select({ passwordHash: notes.passwordHash })
      .from(notes)
      .where(
        and(
          eq(notes.id, id),
          or(isNull(notes.expiresAt), gt(notes.expiresAt, new Date())),
        ),
      )
      .limit(1);
    return row ? { requiresPassword: row.passwordHash !== null } : null;
  }

  private async consumePasswordless(id: string): Promise<ConsumeResult> {
    const metadata = await this.metadata(id);
    if (!metadata || metadata.requiresPassword) return { kind: "unavailable" };
    const digest = noteIdDigest(id, getEnv().IDEMPOTENCY_HMAC_SECRET);
    return transaction(async (client) => {
      const capacity = await client.query(
        "SELECT id FROM note_capacity WHERE id = 1 FOR UPDATE",
      );
      if (capacity.rowCount !== 1)
        throw new Error("Capacity ledger is not initialized");
      const deleted = await client.query<{
        protocol_version: number;
        id: string;
        iv: Buffer;
        ciphertext: Buffer;
        payload_bytes: number;
      }>(
        `DELETE FROM notes
         WHERE id = $1
           AND password_hash IS NULL
           AND (expires_at IS NULL OR expires_at > now())
         RETURNING protocol_version, id, iv, ciphertext, payload_bytes`,
        [id],
      );
      if (!deleted.rowCount) return { kind: "unavailable" };
      const row = deleted.rows[0];
      await client.query(
        "UPDATE note_create_idempotency SET note_deleted_at = now() WHERE note_id_digest = $1 AND note_deleted_at IS NULL",
        [Buffer.from(digest)],
      );
      await client.query(
        `UPDATE note_capacity
         SET active_note_count = active_note_count - 1,
             active_payload_bytes = active_payload_bytes - $1,
             updated_at = now()
         WHERE id = 1`,
        [row.payload_bytes],
      );
      return {
        kind: "success",
        protocolVersion: 1,
        id: row.id,
        iv: new Uint8Array(row.iv),
        ciphertext: new Uint8Array(row.ciphertext),
      };
    });
  }

  async consume(id: string, password?: string): Promise<ConsumeResult> {
    if (password === undefined) return this.consumePasswordless(id);

    const [candidate] = await getDatabase()
      .select({ passwordHash: notes.passwordHash })
      .from(notes)
      .where(
        and(
          eq(notes.id, id),
          or(isNull(notes.expiresAt), gt(notes.expiresAt, new Date())),
        ),
      )
      .limit(1);
    if (!candidate?.passwordHash) return { kind: "unavailable" };

    try {
      if (!(await verifyPassword(password, candidate.passwordHash)))
        return { kind: "unavailable" };
    } catch {
      return { kind: "unavailable" };
    }

    const digest = noteIdDigest(id, getEnv().IDEMPOTENCY_HMAC_SECRET);
    return transaction(async (client) => {
      const capacity = await client.query(
        "SELECT id FROM note_capacity WHERE id = 1 FOR UPDATE",
      );
      if (capacity.rowCount !== 1)
        throw new Error("Capacity ledger is not initialized");
      const deleted = await client.query<{
        protocol_version: number;
        id: string;
        iv: Buffer;
        ciphertext: Buffer;
        payload_bytes: number;
      }>(
        `DELETE FROM notes
         WHERE id = $1
           AND password_hash = $2
           AND (expires_at IS NULL OR expires_at > now())
         RETURNING protocol_version, id, iv, ciphertext, payload_bytes`,
        [id, candidate.passwordHash],
      );
      if (!deleted.rowCount) return { kind: "unavailable" };
      const row = deleted.rows[0];
      await client.query(
        "UPDATE note_create_idempotency SET note_deleted_at = now() WHERE note_id_digest = $1 AND note_deleted_at IS NULL",
        [Buffer.from(digest)],
      );
      await client.query(
        `UPDATE note_capacity
         SET active_note_count = active_note_count - 1,
             active_payload_bytes = active_payload_bytes - $1,
             updated_at = now()
         WHERE id = 1`,
        [row.payload_bytes],
      );
      return {
        kind: "success",
        protocolVersion: 1,
        id: row.id,
        iv: new Uint8Array(row.iv),
        ciphertext: new Uint8Array(row.ciphertext),
      };
    });
  }

  async cleanupExpired(
    limit = 100,
  ): Promise<{ deleted: number; payloadBytes: number }> {
    return transaction(async (client) => {
      const ownership = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext('shredit:cleanup-expired')) AS acquired",
      );
      if (!ownership.rows[0]?.acquired) return { deleted: 0, payloadBytes: 0 };
      const capacity = await client.query(
        "SELECT id FROM note_capacity WHERE id = 1 FOR UPDATE",
      );
      if (capacity.rowCount !== 1)
        throw new Error("Capacity ledger is not initialized");
      const deleted = await client.query<{ id: string; payload_bytes: number }>(
        `DELETE FROM notes
         WHERE id IN (
           SELECT id FROM notes
           WHERE expires_at IS NOT NULL AND expires_at <= now()
           ORDER BY expires_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, payload_bytes`,
        [Math.max(1, Math.min(1000, Math.floor(limit)))],
      );
      let payloadBytes = 0;
      for (const row of deleted.rows) {
        payloadBytes += Number(row.payload_bytes);
        await client.query(
          "UPDATE note_create_idempotency SET note_deleted_at = now() WHERE note_id_digest = $1 AND note_deleted_at IS NULL",
          [Buffer.from(noteIdDigest(row.id, getEnv().IDEMPOTENCY_HMAC_SECRET))],
        );
      }
      if (deleted.rowCount) {
        await client.query(
          `UPDATE note_capacity
           SET active_note_count = active_note_count - $1,
               active_payload_bytes = active_payload_bytes - $2,
               updated_at = now()
           WHERE id = 1`,
          [deleted.rowCount, payloadBytes],
        );
      }
      return { deleted: deleted.rowCount ?? 0, payloadBytes };
    });
  }

  async cleanupTombstones(retentionDays: number): Promise<number> {
    const result = await getPool().query(
      `DELETE FROM note_create_idempotency
       WHERE note_deleted_at IS NOT NULL
         AND note_deleted_at < now() - ($1::text || ' days')::interval`,
      [retentionDays],
    );
    return result.rowCount ?? 0;
  }

  async reconcile(): Promise<{
    activeNoteCount: number;
    activePayloadBytes: number;
  }> {
    return transaction(async (client) => {
      const capacity = await client.query(
        "SELECT id FROM note_capacity WHERE id = 1 FOR UPDATE",
      );
      if (capacity.rowCount !== 1)
        throw new Error("Capacity ledger is not initialized");
      const expired = await client.query<{ id: string }>(
        `DELETE FROM notes
         WHERE expires_at IS NOT NULL AND expires_at <= now()
         RETURNING id`,
      );
      for (const row of expired.rows) {
        await client.query(
          "UPDATE note_create_idempotency SET note_deleted_at = now() WHERE note_id_digest = $1 AND note_deleted_at IS NULL",
          [Buffer.from(noteIdDigest(row.id, getEnv().IDEMPOTENCY_HMAC_SECRET))],
        );
      }
      const aggregate = await client.query<{
        active_note_count: string;
        active_payload_bytes: string;
      }>(
        `SELECT count(*)::bigint AS active_note_count,
                coalesce(sum(payload_bytes), 0)::bigint AS active_payload_bytes
         FROM notes`,
      );
      const activeNoteCount = Number(aggregate.rows[0].active_note_count);
      const activePayloadBytes = Number(aggregate.rows[0].active_payload_bytes);
      await client.query(
        `UPDATE note_capacity SET active_note_count = $1, active_payload_bytes = $2, updated_at = now() WHERE id = 1`,
        [activeNoteCount, activePayloadBytes],
      );
      return { activeNoteCount, activePayloadBytes };
    });
  }

  async stats(): Promise<{
    activeNoteCount: number;
    activePayloadBytes: number;
  }> {
    const result = await getPool().query<{
      active_note_count: string;
      active_payload_bytes: string;
    }>(
      "SELECT active_note_count, active_payload_bytes FROM note_capacity WHERE id = 1",
    );
    if (result.rowCount !== 1)
      throw new Error("Capacity ledger is not initialized");
    return {
      activeNoteCount: Number(result.rows[0].active_note_count),
      activePayloadBytes: Number(result.rows[0].active_payload_bytes),
    };
  }

  async resetForTests(): Promise<void> {
    if (getEnv().NODE_ENV !== "test")
      throw new Error("Database reset is allowed only in tests");
    await transaction(async (client) => {
      await client.query("TRUNCATE notes, note_create_idempotency");
      await client.query(
        "UPDATE note_capacity SET active_note_count = 0, active_payload_bytes = 0, updated_at = now() WHERE id = 1",
      );
    });
  }
}

const memoryStore = new MemoryNoteStore();
const postgresStore = new PostgresNoteStore();

function backend(): NoteStoreBackend {
  return getEnv().SHREDIT_LOCAL_EPHEMERAL ? memoryStore : postgresStore;
}

export const noteStore: NoteStoreBackend = {
  checkReplay: (input) => backend().checkReplay(input),
  hasNoteIdCollision: (id, digest) => backend().hasNoteIdCollision(id, digest),
  create: (input) => backend().create(input),
  metadata: (id) => backend().metadata(id),
  consume: (id, password) => backend().consume(id, password),
  cleanupExpired: (limit) => backend().cleanupExpired(limit),
  cleanupTombstones: (retentionDays) =>
    backend().cleanupTombstones(retentionDays),
  reconcile: () => backend().reconcile(),
  stats: () => backend().stats(),
  resetForTests: () => backend().resetForTests(),
};

export type { ExpirySelection };
