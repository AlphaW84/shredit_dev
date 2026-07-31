import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createSymlinkWithFallback,
  installWindowsSymlinkFallback,
} = require("../scripts/windows-symlink-fallback.cjs");

function permissionError() {
  return Object.assign(new Error("symlink permission denied"), {
    code: "EPERM",
  });
}

describe("Windows standalone symlink fallback", () => {
  it("maps a denied directory link into the standalone artifact", async () => {
    const projectRoot = process.cwd();
    const target = path.resolve("node_modules", ".pnpm", "package");
    const standalone = path.resolve(".next", "standalone");
    const destination = path.join(standalone, "node_modules", "package");
    const mappedTarget = path.join(
      standalone,
      path.relative(projectRoot, target),
    );
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const symlink = vi
      .fn()
      .mockRejectedValueOnce(permissionError())
      .mockResolvedValueOnce(undefined);

    await createSymlinkWithFallback(target, destination, undefined, {
      mkdir,
      platform: "win32",
      projectRoot,
      symlink,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    });

    expect(symlink).toHaveBeenNthCalledWith(1, target, destination, undefined);
    expect(mkdir).toHaveBeenCalledWith(mappedTarget, { recursive: true });
    expect(symlink).toHaveBeenNthCalledWith(
      2,
      mappedTarget,
      destination,
      "junction",
    );
  });

  it("does not replace a denied file symlink with a copy", async () => {
    const originalError = permissionError();
    const mkdir = vi.fn();

    await expect(
      createSymlinkWithFallback(
        path.resolve("node_modules", "package", "index.js"),
        path.resolve(
          ".next",
          "standalone",
          "node_modules",
          "package",
          "index.js",
        ),
        undefined,
        {
          mkdir,
          platform: "win32",
          projectRoot: process.cwd(),
          symlink: vi.fn().mockRejectedValue(originalError),
          stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
        },
      ),
    ).rejects.toBe(originalError);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("does not reinterpret an explicitly typed symlink", async () => {
    const originalError = permissionError();
    const mkdir = vi.fn();
    const stat = vi.fn();

    await expect(
      createSymlinkWithFallback(
        path.resolve("node_modules", "package"),
        path.resolve(".next", "standalone", "node_modules", "package"),
        "dir",
        {
          mkdir,
          platform: "win32",
          projectRoot: process.cwd(),
          stat,
          symlink: vi.fn().mockRejectedValue(originalError),
        },
      ),
    ).rejects.toBe(originalError);
    expect(stat).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("rejects fallback destinations outside standalone output", async () => {
    const originalError = permissionError();
    const stat = vi.fn();

    await expect(
      createSymlinkWithFallback(
        path.resolve("node_modules", "package"),
        path.resolve("outside", "package"),
        undefined,
        {
          platform: "win32",
          projectRoot: process.cwd(),
          symlink: vi.fn().mockRejectedValue(originalError),
          stat,
        },
      ),
    ).rejects.toBe(originalError);
    expect(stat).not.toHaveBeenCalled();
  });

  it("rejects fallback targets outside the project", async () => {
    const originalError = permissionError();
    const stat = vi.fn();

    await expect(
      createSymlinkWithFallback(
        path.resolve(process.cwd(), "..", "external-package"),
        path.resolve(".next", "standalone", "node_modules", "package"),
        undefined,
        {
          platform: "win32",
          projectRoot: process.cwd(),
          symlink: vi.fn().mockRejectedValue(originalError),
          stat,
        },
      ),
    ).rejects.toBe(originalError);
    expect(stat).not.toHaveBeenCalled();
  });

  it("does not hide non-permission failures", async () => {
    const originalError = Object.assign(new Error("missing target"), {
      code: "ENOENT",
    });

    await expect(
      createSymlinkWithFallback("target", "destination", undefined, {
        platform: "win32",
        symlink: vi.fn().mockRejectedValue(originalError),
      }),
    ).rejects.toBe(originalError);
  });

  it("leaves the filesystem module untouched off Windows", () => {
    const symlink = vi.fn();
    const fsModule = {
      promises: {
        mkdir: vi.fn(),
        stat: vi.fn(),
        symlink,
      },
    };

    expect(
      installWindowsSymlinkFallback(fsModule, {
        platform: "linux",
        projectRoot: process.cwd(),
      }),
    ).toBe(false);
    expect(fsModule.promises.symlink).toBe(symlink);
  });
});
