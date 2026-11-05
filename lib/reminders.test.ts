import { describe, expect, it } from "vitest";

import {
  isoDaysFromNow,
  selectTranchesToRemind,
  selectWeddingsToNudge,
  type TrancheForReminder,
  type WeddingForNudge,
} from "./reminders";

function tranche(overrides: Partial<TrancheForReminder>): TrancheForReminder {
  return {
    id: "t1",
    vendor_id: "v1",
    label: "señal",
    amount_cents: 300000,
    due_date: "2026-07-15",
    status: "pending",
    ...overrides,
  };
}

describe("isoDaysFromNow", () => {
  it("adds days within a month", () => {
    expect(isoDaysFromNow("2026-07-08", 7)).toBe("2026-07-15");
  });

  it("crosses month and year boundaries", () => {
    expect(isoDaysFromNow("2026-07-28", 7)).toBe("2026-08-04");
    expect(isoDaysFromNow("2026-12-28", 7)).toBe("2027-01-04");
  });
});

describe("selectTranchesToRemind", () => {
  const today = "2026-07-08"; // objetivo: vencimiento el 2026-07-15

  it("picks only pending tranches due in exactly 7 days", () => {
    const rows = [
      tranche({ id: "due", due_date: "2026-07-15" }),
      tranche({ id: "too-soon", due_date: "2026-07-14" }),
      tranche({ id: "too-late", due_date: "2026-07-16" }),
      tranche({ id: "paid", due_date: "2026-07-15", status: "paid" }),
      tranche({ id: "no-date", due_date: null }),
    ];
    expect(selectTranchesToRemind(rows, today).map((t) => t.id)).toEqual([
      "due",
    ]);
  });

  it("returns empty when nothing matches", () => {
    expect(selectTranchesToRemind([], today)).toEqual([]);
    expect(
      selectTranchesToRemind([tranche({ due_date: "2027-01-01" })], today),
    ).toEqual([]);
  });
});

describe("selectWeddingsToNudge", () => {
  const today = "2026-07-08"; // objetivo: boda el 2026-08-07

  function wedding(overrides: Partial<WeddingForNudge>): WeddingForNudge {
    return {
      id: "w1",
      wedding_date: "2026-08-07",
      confirmedContributions: 0,
      ...overrides,
    };
  }

  it("picks weddings 30 days out with fewer than 5 confirmed contributions", () => {
    const rows = [
      wedding({ id: "few", confirmedContributions: 4 }),
      wedding({ id: "enough", confirmedContributions: 5 }),
      wedding({ id: "wrong-date", wedding_date: "2026-08-08" }),
      wedding({ id: "no-date", wedding_date: null }),
    ];
    expect(selectWeddingsToNudge(rows, today).map((w) => w.id)).toEqual([
      "few",
    ]);
  });
});
