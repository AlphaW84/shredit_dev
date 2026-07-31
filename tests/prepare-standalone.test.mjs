import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareStandalone } from "../scripts/prepare-standalone.mjs";

const roots = [];

async function temporaryProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "shredit-standalone-"));
  roots.push(root);
  await mkdir(path.join(root, ".next", "standalone"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("standalone asset preparation", () => {
  it("copies current static and public assets and removes stale output", async () => {
    const root = await temporaryProject();
    await mkdir(path.join(root, ".next", "static", "chunks"), {
      recursive: true,
    });
    await mkdir(path.join(root, "public"), { recursive: true });
    await mkdir(path.join(root, ".next", "standalone", ".next", "static"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".next", "static", "chunks", "app.js"),
      "current",
    );
    await writeFile(path.join(root, "public", "robots.txt"), "noindex");
    await writeFile(
      path.join(root, ".next", "standalone", ".next", "static", "stale.js"),
      "stale",
    );

    await expect(prepareStandalone(root)).resolves.toMatchObject({
      copiedPublic: true,
    });
    await expect(
      readFile(
        path.join(
          root,
          ".next",
          "standalone",
          ".next",
          "static",
          "chunks",
          "app.js",
        ),
        "utf8",
      ),
    ).resolves.toBe("current");
    await expect(
      readFile(
        path.join(root, ".next", "standalone", "public", "robots.txt"),
        "utf8",
      ),
    ).resolves.toBe("noindex");
    await expect(
      access(
        path.join(root, ".next", "standalone", ".next", "static", "stale.js"),
      ),
    ).rejects.toThrow();
  });

  it("removes stale public output when the project has no public directory", async () => {
    const root = await temporaryProject();
    await mkdir(path.join(root, ".next", "static"), { recursive: true });
    await mkdir(path.join(root, ".next", "standalone", "public"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".next", "standalone", "public", "stale.txt"),
      "stale",
    );

    await expect(prepareStandalone(root)).resolves.toMatchObject({
      copiedPublic: false,
    });
    await expect(
      access(path.join(root, ".next", "standalone", "public")),
    ).rejects.toThrow();
  });

  it("fails when required Next.js static output is absent", async () => {
    const root = await temporaryProject();
    await expect(prepareStandalone(root)).rejects.toThrow(/static/u);
  });

  it("rejects a standalone link whose target escapes the artifact", async () => {
    const root = await temporaryProject();
    const externalTarget = path.join(root, "node_modules", "package");
    const link = path.join(root, ".next", "standalone", "package");
    await mkdir(path.join(root, ".next", "static"), { recursive: true });
    await mkdir(externalTarget, { recursive: true });
    await symlink(
      externalTarget,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(prepareStandalone(root)).rejects.toThrow(/escapes/u);
    await expect(realpath(link)).resolves.toBe(externalTarget);
  });
});
