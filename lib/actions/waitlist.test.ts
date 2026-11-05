import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ insert: vi.fn(), rateLimit: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: async () => "test-ip", rateLimit: mocks.rateLimit }));

import { joinWaitlist } from "./waitlist";

const valid = { email: " Pareja@Example.com ", kind: "pareja" as const, consent: true as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue(true);
  mocks.insert.mockResolvedValue({ error: null });
  mocks.admin.mockReturnValue({ from: () => ({ insert: mocks.insert }) });
});

describe("joinWaitlist", () => {
  it("normalizes email and records the consent copy version using the existing schema", async () => {
    expect((await joinWaitlist(valid)).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledWith({ email: "pareja@example.com", kind: "pareja", wedding_date: null, source: "landing-waitlist-v2", interested_in_gifts: false });
  });
  it("records interest in gifts when the couple ticks the box", async () => {
    expect((await joinWaitlist({ ...valid, interestedInGifts: true })).ok).toBe(true);
    expect(mocks.insert.mock.calls[0][0].interested_in_gifts).toBe(true);
  });
  it("rejects a non-boolean gifts flag before accessing storage", async () => {
    expect((await joinWaitlist({ ...valid, interestedInGifts: "sí" as unknown as boolean })).ok).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("keeps the signup when the gifts column is not migrated yet", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } }).mockResolvedValueOnce({ error: null });
    expect((await joinWaitlist({ ...valid, interestedInGifts: true })).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.insert.mock.calls[1][0]).not.toHaveProperty("interested_in_gifts");
    log.mockRestore();
  });
  it("rejects requests without explicit consent before accessing storage", async () => {
    expect((await joinWaitlist({ ...valid, consent: false as unknown as true })).ok).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("rejects impossible calendar dates", async () => {
    expect((await joinWaitlist({ ...valid, weddingDate: "2027-02-30" })).ok).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("ignores wedding dates from non-couple submissions", async () => {
    await joinWaitlist({ ...valid, kind: "planner", weddingDate: "2027-06-12" });
    expect(mocks.insert.mock.calls[0][0].wedding_date).toBeNull();
  });
  it("does not reveal whether an email already exists", async () => {
    const fresh = await joinWaitlist(valid);
    mocks.insert.mockResolvedValue({ error: { code: "23505" } });
    expect(await joinWaitlist(valid)).toEqual(fresh);
  });
  it("does not insert when rate limited", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    expect((await joinWaitlist(valid)).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("returns a recoverable error when configuration or networking fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.admin.mockImplementation(() => { throw new Error("unavailable"); });
    expect((await joinWaitlist(valid)).ok).toBe(false);
    log.mockRestore();
  });
  it("never reports success for database failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.insert.mockResolvedValue({ error: { code: "42P01", details: "private email" } });
    expect((await joinWaitlist(valid)).ok).toBe(false);
    expect(log).toHaveBeenCalledWith("[waitlist] insert failed", "42P01");
    log.mockRestore();
  });
});
