import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const argon2Mock = vi.hoisted(() => ({
  active: 0,
  maximumActive: 0,
  releases: [] as Array<() => void>,
  run: vi.fn(
    () =>
      new Promise<string>((resolve) => {
        argon2Mock.active += 1;
        argon2Mock.maximumActive = Math.max(
          argon2Mock.maximumActive,
          argon2Mock.active,
        );
        argon2Mock.releases.push(() => {
          argon2Mock.active -= 1;
          resolve("encoded-hash");
        });
      }),
  ),
}));

vi.mock("@node-rs/argon2", () => ({
  hash: argon2Mock.run,
  verify: vi.fn(async () => true),
}));

import { hashPassword } from "@/lib/crypto/password";
import { resetEnvForTests } from "@/lib/config/env";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ARGON2_MAX_CONCURRENCY", "2");
  vi.stubEnv("ARGON2_VERIFY_TIMEOUT_MS", "5000");
  vi.stubEnv("ARGON2_MEMORY_KIB", "8192");
  vi.stubEnv("ARGON2_TIME_COST", "1");
  vi.stubEnv("ARGON2_PARALLELISM", "1");
  vi.stubEnv("ARGON2_HASH_LENGTH", "32");
  resetEnvForTests();
  argon2Mock.active = 0;
  argon2Mock.maximumActive = 0;
  argon2Mock.releases.length = 0;
  argon2Mock.run.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("Argon2 work pool", () => {
  it("bounds concurrent password hashes across public create requests", async () => {
    const operations = Array.from({ length: 4 }, () =>
      hashPassword("password123"),
    );

    await vi.waitFor(() => expect(argon2Mock.active).toBe(2));
    expect(argon2Mock.maximumActive).toBe(2);
    expect(argon2Mock.releases).toHaveLength(2);

    argon2Mock.releases.splice(0, 2).forEach((release) => release());
    await vi.waitFor(() => expect(argon2Mock.releases).toHaveLength(2));
    expect(argon2Mock.maximumActive).toBe(2);

    argon2Mock.releases.splice(0, 2).forEach((release) => release());
    await expect(Promise.all(operations)).resolves.toEqual(
      Array(4).fill("encoded-hash"),
    );
    expect(argon2Mock.maximumActive).toBe(2);
  });
});
