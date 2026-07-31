import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Dockerfile maintenance contract", () => {
  it("keeps the prepared package manager available to the non-root stage", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    const corepackHome = dockerfile.indexOf("ENV COREPACK_HOME=/corepack");
    const prepare = dockerfile.indexOf(
      "corepack prepare pnpm@${PNPM_VERSION} --activate",
    );
    const ownership = dockerfile.indexOf("chown -R node:node ${COREPACK_HOME}");
    const maintenanceUser = dockerfile.indexOf("USER node");

    expect(corepackHome).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(corepackHome);
    expect(ownership).toBeGreaterThan(prepare);
    expect(maintenanceUser).toBeGreaterThan(ownership);
  });
});
