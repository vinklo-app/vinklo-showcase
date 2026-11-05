import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ captureMessage: vi.fn(), send: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.captureMessage }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { resetEnvForTests } from "@/lib/env";
import { sendEmail } from "./send";

const input = { to: "a@b.es", subject: "Hola", html: "<p>x</p>" };

beforeEach(() => {
  resetEnvForTests();
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendEmail sin RESEND_API_KEY", () => {
  it("en producción se salta el envío pero lo reporta (Sentry) una sola vez", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendEmail(input)).toEqual({ skipped: true });
    expect(await sendEmail(input)).toEqual({ skipped: true });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(mocks.captureMessage.mock.calls[0][0]).toContain("RESEND_API_KEY");
  });

  it("fuera de producción se salta sin reportar", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendEmail(input)).toEqual({ skipped: true });
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });

  it("con clave envía", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_x");
    mocks.send.mockResolvedValue({ data: { id: "m1" }, error: null });
    expect(await sendEmail(input)).toEqual({ skipped: false, id: "m1" });
  });
});
