import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: databaseMocks.drizzle,
}));

import { databaseReady } from "@/lib/database/client";
import { resetEnvForTests } from "@/lib/config/env";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://test:test@127.0.0.1:5432/shredit_test",
  );
  resetEnvForTests();
  databaseMocks.execute.mockReset();
  databaseMocks.drizzle.mockReturnValue({ execute: databaseMocks.execute });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("database readiness", () => {
  it("returns false when the note_capacity singleton row is absent", async () => {
    databaseMocks.execute.mockResolvedValue({ rows: [{ ready: false }] });

    await expect(databaseReady()).resolves.toBe(false);
  });

  it("returns true only when the schema-version and invariant query returns true", async () => {
    databaseMocks.execute.mockResolvedValue({ rows: [{ ready: true }] });

    await expect(databaseReady()).resolves.toBe(true);
  });

  it("returns false when the readiness query fails", async () => {
    databaseMocks.execute.mockRejectedValue(new Error("database unavailable"));

    await expect(databaseReady()).resolves.toBe(false);
  });
});
