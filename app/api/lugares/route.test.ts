import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), photon: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, clientIp: async () => "203.0.113.9" }));
vi.mock("@/lib/places/providers", async (importOriginal) => ({ ...(await importOriginal<object>()), photonSearch: mocks.photon, placesProvider: () => "photon" }));

import { NextRequest } from "next/server";
import { GET } from "./route";

const call = () => GET(new NextRequest("http://localhost/api/lugares?q=Finca%20La%20Alameda"));

beforeEach(() => {
  mocks.rateLimit.mockReset().mockResolvedValue(true);
  mocks.photon.mockReset().mockResolvedValue([]);
});

describe("GET /api/lugares: topes", () => {
  it("comprueba el límite por IP y después el tope global diario", async () => {
    expect((await call()).status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(1, "places", "203.0.113.9", 90, 600);
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(2, "places-global-d", "all", 3000, 86_400);
  });
  it("tope global agotado: 429 sin llamar al proveedor", async () => {
    mocks.rateLimit.mockImplementation(async (action: string) => action !== "places-global-d");
    expect((await call()).status).toBe(429);
    expect(mocks.photon).not.toHaveBeenCalled();
  });
  it("límite por IP agotado: 429 y no consume el tope global", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    expect((await call()).status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
  });
});
