import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
const hdrs = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => hdrs.current }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
import { clientIp, keyedHash, normalizeIp, rateLimit } from "./rate-limit";
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); hdrs.current = new Headers(); });
describe("limitador de escrituras anónimas", () => {
  it("solo permite autorización positiva y no almacena la IP en claro", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(await rateLimit("rsvp", "192.0.2.1:boda", 10, 3600)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("rl_check", {
      p_key: `rsvp:${keyedHash("192.0.2.1:boda")}`, p_max: 10, p_window_secs: 3600,
    });
  });
  it("hashea con HMAC y secreto: distinto de un SHA-256 plano", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "s3cr3t");
    const plain = createHash("sha256").update("192.0.2.1").digest("hex");
    expect(keyedHash("192.0.2.1")).not.toBe(plain);
    expect(keyedHash("192.0.2.1")).toBe(createHmac("sha256", "s3cr3t").update("192.0.2.1").digest("hex"));
    vi.unstubAllEnvs();
    vi.stubEnv("CRON_SECRET", "cron");
    delete process.env.RATE_LIMIT_SECRET;
    expect(keyedHash("x")).toBe(createHmac("sha256", "cron").update("x").digest("hex"));
  });
  it.each([false, null, undefined, "true", 1])("rechaza respuesta ambigua %s", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await rateLimit("waitlist", "ip", 3, 3600)).toBe(false);
  });
  it("deniega ante fallo SQL sin registrar detalles privados", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: true, error: { code: "42501", message: "private token" } });
    expect(await rateLimit("rsvp", "ip", 10, 3600)).toBe(false);
    expect(log).toHaveBeenCalledWith("[rate-limit] unavailable", "42501");
    log.mockRestore();
  });
  it("deniega ante caída de red", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.rpc.mockRejectedValue(new Error("private details"));
    expect(await rateLimit("rsvp", "ip", 10, 3600)).toBe(false);
    log.mockRestore();
  });
});

describe("normalizeIp", () => {
  it("deja IPv4 intacta y reduce IPv6 a su /64", () => {
    expect(normalizeIp("192.0.2.1")).toBe("192.0.2.1");
    expect(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:db8:1:2:1111:2222:3333:4444")).toBe(normalizeIp("2001:db8:1:2:ffff::1"));
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("2001:0DB8:0000:0001::5")).toBe("2001:db8:0:1::/64");
    expect(normalizeIp("::1")).toBe("0:0:0:0::/64");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(normalizeIp("::ffff:192.0.2.9")).toBe("192.0.2.9");
    expect(normalizeIp("64:ff9b::192.0.2.33")).toBe("64:ff9b:0:0::/64");
  });
});

describe("clientIp", () => {
  it("prefiere x-vercel-forwarded-for, luego x-real-ip y por último el primero de x-forwarded-for", async () => {
    hdrs.current = new Headers({ "x-vercel-forwarded-for": "203.0.113.5", "x-real-ip": "198.51.100.1", "x-forwarded-for": "6.6.6.6, 7.7.7.7" });
    expect(await clientIp()).toBe("203.0.113.5");
    hdrs.current = new Headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "6.6.6.6, 7.7.7.7" });
    expect(await clientIp()).toBe("198.51.100.1");
    hdrs.current = new Headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" });
    expect(await clientIp()).toBe("6.6.6.6");
    hdrs.current = new Headers();
    expect(await clientIp()).toBe("unknown");
  });
  it("normaliza IPv6 a /64", async () => {
    hdrs.current = new Headers({ "x-vercel-forwarded-for": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" });
    expect(await clientIp()).toBe("2001:db8:1:2::/64");
  });
});
