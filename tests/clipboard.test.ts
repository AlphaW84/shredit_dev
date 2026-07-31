import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "@/components/shredit-ui";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clipboard fallback", () => {
  it("always removes the plaintext proxy textarea when legacy copy throws", async () => {
    const textarea = {
      className: "",
      remove: vi.fn(),
      select: vi.fn(),
      setAttribute: vi.fn(),
      value: "",
    };
    const appendChild = vi.fn();
    const execCommand = vi.fn(() => {
      throw new Error("clipboard denied");
    });

    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      body: { appendChild },
      createElement: vi.fn(() => textarea),
      execCommand,
    });

    await expect(copyTextToClipboard("sensitive value")).rejects.toThrow(
      "clipboard denied",
    );
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(textarea.remove).toHaveBeenCalledOnce();
  });
});
