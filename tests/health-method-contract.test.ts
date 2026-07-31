import { describe, expect, it } from "vitest";
import * as liveRoute from "@/app/health/live/route";
import * as readyRoute from "@/app/health/ready/route";

type MethodHandler = () => Response | Promise<Response>;

const cases: Array<{
  name: string;
  unsupported: MethodHandler[];
  options: MethodHandler;
}> = [
  {
    name: "liveness",
    unsupported: [
      liveRoute.POST,
      liveRoute.PUT,
      liveRoute.PATCH,
      liveRoute.DELETE,
    ],
    options: liveRoute.OPTIONS,
  },
  {
    name: "readiness",
    unsupported: [
      readyRoute.POST,
      readyRoute.PUT,
      readyRoute.PATCH,
      readyRoute.DELETE,
    ],
    options: readyRoute.OPTIONS,
  },
];

describe("health method contract", () => {
  for (const routeCase of cases) {
    it(`${routeCase.name} returns JSON 405 responses with Allow`, async () => {
      for (const handler of routeCase.unsupported) {
        const response = await handler();
        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
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
      expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).toBe("");
    });
  }
});
