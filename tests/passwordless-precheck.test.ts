import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  from: vi.fn(),
  getDatabase: vi.fn(),
  getPool: vi.fn(),
  limit: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
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
  vi.stubEnv("IDEMPOTENCY_HMAC_SECRET", "passwordless-precheck-test-secret");
  resetEnvForTests();

  for (const mock of Object.values(databaseMocks)) mock.mockReset();
  databaseMocks.select.mockReturnValue({ from: databaseMocks.from });
  databaseMocks.from.mockReturnValue({ where: databaseMocks.where });
  databaseMocks.where.mockReturnValue({ limit: databaseMocks.limit });
  databaseMocks.limit.mockResolvedValue([]);
  databaseMocks.getDatabase.mockReturnValue({ select: databaseMocks.select });
  databaseMocks.getPool.mockReturnValue({ connect: databaseMocks.connect });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("passwordless PostgreSQL open precheck", () => {
  it("rejects an unknown canonical note ID before taking the shared capacity lock", async () => {
    await expect(noteStore.consume("A".repeat(32))).resolves.toEqual({
      kind: "unavailable",
    });
    expect(databaseMocks.limit).toHaveBeenCalledWith(1);
    expect(databaseMocks.connect).not.toHaveBeenCalled();
  });
});
