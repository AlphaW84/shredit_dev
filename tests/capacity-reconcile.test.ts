import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  getDatabase: vi.fn(),
  getPool: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/lib/database/client", () => ({
  getDatabase: databaseMocks.getDatabase,
  getPool: databaseMocks.getPool,
}));

import { resetEnvForTests } from "@/lib/config/env";
import { noteStore } from "@/lib/note-store";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SHREDIT_LOCAL_EPHEMERAL", "false");
  vi.stubEnv("IDEMPOTENCY_HMAC_SECRET", "capacity-reconcile-test-secret");
  resetEnvForTests();
  databaseMocks.query.mockReset();
  databaseMocks.release.mockReset();
  databaseMocks.connect.mockReset();
  databaseMocks.getPool.mockReset();
  databaseMocks.connect.mockResolvedValue({
    query: databaseMocks.query,
    release: databaseMocks.release,
  });
  databaseMocks.getPool.mockReturnValue({ connect: databaseMocks.connect });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("capacity reconciliation", () => {
  it("deletes expired rows and tombstones them before rebuilding the ledger", async () => {
    databaseMocks.query.mockImplementation(async (statement: string) => {
      if (statement === "BEGIN" || statement === "COMMIT")
        return { rows: [], rowCount: 0 };
      if (statement.includes("SELECT id FROM note_capacity"))
        return { rows: [{ id: 1 }], rowCount: 1 };
      if (statement.includes("DELETE FROM notes"))
        return { rows: [{ id: "A".repeat(32) }], rowCount: 1 };
      if (statement.includes("UPDATE note_create_idempotency"))
        return { rows: [], rowCount: 1 };
      if (statement.includes("SELECT count(*)::bigint")) {
        return {
          rows: [{ active_note_count: "2", active_payload_bytes: "64" }],
          rowCount: 1,
        };
      }
      if (statement.includes("UPDATE note_capacity SET"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${statement}`);
    });

    await expect(noteStore.reconcile()).resolves.toEqual({
      activeNoteCount: 2,
      activePayloadBytes: 64,
    });

    const statements = databaseMocks.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    const deleteIndex = statements.findIndex((statement) =>
      statement.includes("DELETE FROM notes"),
    );
    const aggregateIndex = statements.findIndex((statement) =>
      statement.includes("SELECT count(*)::bigint"),
    );
    const updateIndex = statements.findIndex((statement) =>
      statement.includes("UPDATE note_capacity SET"),
    );
    expect(deleteIndex).toBeGreaterThan(0);
    expect(aggregateIndex).toBeGreaterThan(deleteIndex);
    expect(updateIndex).toBeGreaterThan(aggregateIndex);
    expect(statements[aggregateIndex]).not.toContain("expires_at");
    expect(databaseMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE note_create_idempotency"),
      [expect.any(Buffer)],
    );
    expect(databaseMocks.release).toHaveBeenCalledOnce();
  });
});
