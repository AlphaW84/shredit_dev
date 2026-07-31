import { describe, expect, it } from "vitest";
import { readJsonBody } from "@/lib/api/request";

async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

describe("bounded JSON request bodies", () => {
  it("cancels a chunked body as soon as it crosses the byte limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":"'));
        controller.enqueue(new Uint8Array(16).fill(65));
        controller.enqueue(new TextEncoder().encode('"}'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://shredit.dev/api/v1/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const result = await readJsonBody(request, 12);

    expect(result).toBeInstanceOf(Response);
    expect(await errorCode(result as Response)).toBe("REQUEST_TOO_LARGE");
    expect(cancelled).toBe(true);
  });

  it("accepts an exact-boundary body and rejects duplicate keys", async () => {
    const exact = '{"ok":true}';
    await expect(
      readJsonBody(
        new Request("https://shredit.dev/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: exact,
        }),
        new TextEncoder().encode(exact).byteLength,
      ),
    ).resolves.toEqual({ ok: true });

    const duplicate = await readJsonBody(
      new Request("https://shredit.dev/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"ok":true,"ok":false}',
      }),
    );
    expect(duplicate).toBeInstanceOf(Response);
    expect(await errorCode(duplicate as Response)).toBe("BAD_REQUEST");
  });

  it("rejects invalid UTF-8 rather than replacing bytes", async () => {
    const request = new Request("https://shredit.dev/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Uint8Array.from([
        0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d,
      ]),
    });

    const result = await readJsonBody(request);

    expect(result).toBeInstanceOf(Response);
    expect(await errorCode(result as Response)).toBe("BAD_REQUEST");
  });
});
