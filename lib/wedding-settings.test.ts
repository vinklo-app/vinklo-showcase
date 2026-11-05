import { describe, expect, it } from "vitest";
import { isValidWeddingDate, weddingSettingsSchema, pageConfigSchema } from "./wedding-settings";

describe("wedding settings", () => {
  it("rejects normalized impossible calendar dates and accepts leap days", () => {
    expect(isValidWeddingDate("2027-02-29")).toBe(false);
    expect(isValidWeddingDate("2028-02-29")).toBe(true);
    expect(isValidWeddingDate("2027-04-31")).toBe(false);
    expect(isValidWeddingDate("2027-13-01")).toBe(false);
  });
  it("normalizes names and ignores privilege fields", () => {
    expect(weddingSettingsSchema.parse({ partnerName1: " Ana ", partnerName2: " Luis ", weddingDate: "2027-06-12", guestCountEst: 120, plan: "premium", couple_id: "other" })).toEqual({ partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", guestCountEst: 120 });
  });
  it("rejects fractional, empty or excessive guest estimates", () => {
    for (const guestCountEst of [0, 1.5, 2001, NaN]) {
      expect(weddingSettingsSchema.safeParse({ partnerName1: "Ana", partnerName2: "Luis", weddingDate: "2027-06-12", guestCountEst }).success).toBe(false);
    }
  });
  it("accepts partial page drafts and normalizes their defaults", () => {
    expect(pageConfigSchema.parse({ style: "natural", venue: " La finca " })).toEqual({ style: "natural", venue: "La finca", welcomeMessage: "", address: "", time: "" });
  });
  it("rejects invalid styles, times and oversized page content", () => {
    for (const input of [{ style: "unknown" }, { time: "24:30" }, { time: "9:15" }, { time: "12:60" }, { welcomeMessage: "a".repeat(401) }, { address: "a".repeat(241) }, { venue: "a".repeat(161) }]) {
      expect(pageConfigSchema.safeParse(input).success).toBe(false);
    }
    expect(pageConfigSchema.safeParse({ time: "23:59" }).success).toBe(true);
  });
});
