import { describe, expect, it } from "vitest";
import * as notesRoute from "@/app/api/v1/notes/route";
import * as policyRoute from "@/app/api/v1/anti-abuse/policy/route";
import * as powRoute from "@/app/api/v1/anti-abuse/pow-challenge/route";
import * as metadataRoute from "@/app/api/v1/notes/[id]/meta/route";
import * as openRoute from "@/app/api/v1/notes/[id]/open/route";

type MethodHandler = () => Response | Promise<Response>;

const cases: Array<{
  name: string;
  allow: string;
  unsupported: MethodHandler[];
  options: MethodHandler;
}> = [
  {
    name: "note creation",
    allow: "POST, OPTIONS",
    unsupported: [
      notesRoute.GET,
      notesRoute.HEAD,
      notesRoute.PUT,
      notesRoute.PATCH,
      notesRoute.DELETE,
    ],
    options: notesRoute.OPTIONS,
  },
  {
    name: "anti-abuse policy",
    allow: "GET, HEAD, OPTIONS",
    unsupported: [
      policyRoute.POST,
      policyRoute.PUT,
      policyRoute.PATCH,
      policyRoute.DELETE,
    ],
    options: policyRoute.OPTIONS,
  },
  {
    name: "PoW challenge",
    allow: "POST, OPTIONS",
    unsupported: [
      powRoute.GET,
      powRoute.HEAD,
      powRoute.PUT,
      powRoute.PATCH,
      powRoute.DELETE,
    ],
    options: powRoute.OPTIONS,
  },
  {
    name: "note metadata",
    allow: "GET, HEAD, OPTIONS",
    unsupported: [
      metadataRoute.POST,
      metadataRoute.PUT,
      metadataRoute.PATCH,
      metadataRoute.DELETE,
    ],
    options: metadataRoute.OPTIONS,
  },
  {
    name: "note open",
    allow: "POST, OPTIONS",
    unsupported: [
      openRoute.GET,
      openRoute.HEAD,
      openRoute.PUT,
      openRoute.PATCH,
      openRoute.DELETE,
    ],
    options: openRoute.OPTIONS,
  },
];

describe("API method contract", () => {
  for (const routeCase of cases) {
    it(`${routeCase.name} returns JSON 405 responses with Allow`, async () => {
      for (const handler of routeCase.unsupported) {
        const response = await handler();
        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe(routeCase.allow);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(response.headers.get("Content-Type")).toContain(
          "application/json",
        );
        await expect(response.json()).resolves.toEqual({
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "The request method is not allowed.",
            retryable: false,
          },
        });
      }
    });

    it(`${routeCase.name} returns a no-store OPTIONS response`, async () => {
      const response = await routeCase.options();
      expect(response.status).toBe(204);
      expect(response.headers.get("Allow")).toBe(routeCase.allow);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).toBe("");
    });
  }
});
