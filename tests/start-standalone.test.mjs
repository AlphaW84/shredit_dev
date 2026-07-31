import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("standalone launcher", () => {
  it("pins the Dokploy runtime bind before loading the server", () => {
    const probe = `
      const Module = require("node:module");
      const originalLoad = Module._load;
      Module._load = function (request, parent, isMain) {
        if (request === "../.next/standalone/server.js") {
          process.stdout.write(JSON.stringify({
            port: process.env.PORT,
            hostname: process.env.HOSTNAME,
          }));
          return {};
        }
        return originalLoad.call(this, request, parent, isMain);
      };
      require("./scripts/start-standalone.cjs");
    `;
    const result = spawnSync(process.execPath, ["-e", probe], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      port: "3232",
      hostname: "0.0.0.0",
    });
  });
});
