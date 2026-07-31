import { createRequire } from "node:module";
import { createServer, request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { INTERNAL_PEER_HEADER, injectPeerAddress } =
  require("../scripts/inject-peer-address.cjs") as {
    INTERNAL_PEER_HEADER: string;
    injectPeerAddress: (request: unknown) => void;
  };

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("runtime peer-address preload", () => {
  it("overwrites a spoofed private header and its raw-header copy", () => {
    const fakeRequest = {
      headers: { [INTERNAL_PEER_HEADER]: "203.0.113.99" },
      rawHeaders: [
        "Host",
        "shredit.dev",
        "X-Shredit-Runtime-Peer",
        "203.0.113.99",
      ],
      socket: { remoteAddress: "10.0.0.7" },
    };

    injectPeerAddress(fakeRequest);

    expect(fakeRequest.headers[INTERNAL_PEER_HEADER]).toBe("10.0.0.7");
    expect(fakeRequest.rawHeaders).toEqual([
      "Host",
      "shredit.dev",
      INTERNAL_PEER_HEADER,
      "10.0.0.7",
    ]);
  });

  it("injects the real TCP peer before an HTTP request listener runs", async () => {
    const server = createServer((incoming, response) => {
      response.end(String(incoming.headers[INTERNAL_PEER_HEADER]));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected an internet socket");

    const observed = await new Promise<string>((resolve, reject) => {
      const outgoing = request(
        {
          host: "127.0.0.1",
          port: address.port,
          headers: { [INTERNAL_PEER_HEADER]: "203.0.113.99" },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => resolve(body));
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    });

    expect(observed).toBe("127.0.0.1");
  });
});
