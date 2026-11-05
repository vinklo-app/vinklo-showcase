import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

import { checkEnv, resetEnvForTests, serverEnv } from "./env";

const FULL = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  NEXT_PUBLIC_APP_URL: "https://vinklo.es",
  CRON_SECRET: "cron",
  GOOGLE_MAPS_API_KEY: "maps",
  SENTRY_DSN: "dsn",
  ADMIN_EMAILS: "a@b.es",
};
const ALL = [...Object.keys(FULL), "NEXT_PUBLIC_SENTRY_DSN", "RESEND_API_KEY", "RATE_LIMIT_SECRET", "VERCEL_ENV"];

function setEnv(env: Record<string, string>) {
  for (const k of ALL) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetEnvForTests();
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errorSpy.mockRestore();
});

describe("lib/env", () => {
  it("en producción avisa UNA vez de RESEND_API_KEY ausente y no lanza", () => {
    setEnv({ ...FULL, VERCEL_ENV: "production" });
    expect(checkEnv().missingExpected).toEqual(["RESEND_API_KEY"]);
    checkEnv();
    serverEnv();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("RESEND_API_KEY");
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("RATE_LIMIT_SECRET cae a CRON_SECRET; sin ninguno de los dos se avisa", () => {
    setEnv({ ...FULL, RESEND_API_KEY: "re", VERCEL_ENV: "production" });
    expect(checkEnv().missingExpected).toEqual([]);
    resetEnvForTests();
    setEnv({ ...FULL, CRON_SECRET: "", RESEND_API_KEY: "re", VERCEL_ENV: "production" });
    expect(checkEnv().missingExpected).toEqual(["CRON_SECRET", "RATE_LIMIT_SECRET"]);
  });

  it("SENTRY_DSN cae a NEXT_PUBLIC_SENTRY_DSN", () => {
    setEnv({ ...FULL, SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "pub", RESEND_API_KEY: "re", VERCEL_ENV: "production" });
    expect(checkEnv().missingExpected).toEqual([]);
    resetEnvForTests();
    setEnv({ ...FULL, SENTRY_DSN: "", RESEND_API_KEY: "re", VERCEL_ENV: "production" });
    expect(checkEnv().missingExpected).toEqual(["SENTRY_DSN"]);
  });

  it("lanza en producción si falta una variable imprescindible", () => {
    setEnv({ ...FULL, SUPABASE_SERVICE_ROLE_KEY: "", RESEND_API_KEY: "re", VERCEL_ENV: "production" });
    expect(() => serverEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("SUPABASE_SERVICE_ROLE_KEY"),
      expect.objectContaining({ level: "error" }),
    );
  });

  it("una URL inválida cuenta como ausente", () => {
    setEnv({ ...FULL, NEXT_PUBLIC_SUPABASE_URL: "no-es-url", RESEND_API_KEY: "re", VERCEL_ENV: "production" });
    expect(checkEnv().missingRequired).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(checkEnv().env.CRON_SECRET).toBe("cron");
  });

  it("fuera de producción no avisa ni lanza aunque falte todo", () => {
    setEnv({});
    expect(serverEnv().RESEND_API_KEY).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});
