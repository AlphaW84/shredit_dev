import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("Shredit brand assets", () => {
  it("uses the compact orange shred mark without the source canvas gap", () => {
    const svg = readFileSync(
      new URL("../public/shredit-mark.svg", import.meta.url),
      "utf8",
    );

    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('fill="#ed7b32"');
    expect(svg).not.toContain('viewBox="0 0 64 80"');
  });

  it("declares vector and install-size icons in the web manifest", () => {
    expect(manifest().icons).toEqual([
      {
        src: "/shredit-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/shredit-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/shredit-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ]);
  });

  it("ships a multi-size legacy favicon", () => {
    const favicon = readFileSync(
      new URL("../public/favicon.ico", import.meta.url),
    );

    expect([...favicon.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0]);
  });
});
