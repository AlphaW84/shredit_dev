import { beforeEach, describe, expect, it, vi } from "vitest";

const readinessMocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  databaseReady: vi.fn(),
  valkeyPing: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getEnv: readinessMocks.getEnv,
}));

vi.mock("@/lib/database/client", () => ({
  databaseReady: readinessMocks.databaseReady,
}));

vi.mock("@/lib/rate-limit/valkey", () => ({
  valkeyPing: readinessMocks.valkeyPing,
}));

import { GET } from "@/app/health/ready/route";

beforeEach(() => {
  vi.clearAllMocks();
  readinessMocks.getEnv.mockReturnValue({
    DATABASE_URL: "postgresql://configured",
    SHREDIT_LOCAL_EPHEMERAL: false,
  });
  readinessMocks.databaseReady.mockResolvedValue(true);
  readinessMocks.valkeyPing.mockResolvedValue(true);
});

describe("readiness route", () => {
  it("returns 503 when the capacity singleton is not ready", async () => {
    readinessMocks.databaseReady.mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "not_ready" });
    expect(readinessMocks.valkeyPing).not.toHaveBeenCalled();
  });

  it("reports a Valkey outage as degraded after PostgreSQL is ready", async () => {
    readinessMocks.valkeyPing.mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      valkey: "degraded",
    });
  });

  it("keeps the loopback-only ephemeral runtime self-contained", async () => {
    readinessMocks.getEnv.mockReturnValue({
      DATABASE_URL: undefined,
      SHREDIT_LOCAL_EPHEMERAL: true,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      valkey: "ok",
      localEphemeral: true,
    });
    expect(readinessMocks.databaseReady).not.toHaveBeenCalled();
    expect(readinessMocks.valkeyPing).not.toHaveBeenCalled();
  });
});
