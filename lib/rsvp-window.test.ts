import { describe, expect, it } from "vitest";
import { formatRsvpDate, madridToday, rsvpWindow } from "./rsvp-window";

// 2027-05-01 23:30 en Madrid (CEST, UTC+2) = 21:30 UTC.
const LATE_MAY_1 = new Date("2027-05-01T21:30:00Z");
// 2027-05-02 00:30 en Madrid = 22:30 UTC del día 1.
const EARLY_MAY_2 = new Date("2027-05-01T22:30:00Z");

describe("rsvpWindow", () => {
  it("hoy se calcula en Madrid, no en UTC", () => {
    expect(madridToday(LATE_MAY_1)).toBe("2027-05-01");
    expect(madridToday(EARLY_MAY_2)).toBe("2027-05-02");
  });
  it("sin fechas: abierta sin plazo", () => {
    expect(rsvpWindow({ weddingDate: null, rsvpDeadline: null }, LATE_MAY_1)).toEqual({ status: "open", deadline: null });
  });
  it("el día límite está incluido hasta medianoche de Madrid", () => {
    const dates = { weddingDate: "2027-06-12", rsvpDeadline: "2027-05-01" };
    expect(rsvpWindow(dates, LATE_MAY_1)).toEqual({ status: "open", deadline: "2027-05-01" });
    expect(rsvpWindow(dates, EARLY_MAY_2)).toEqual({ status: "closed", reason: "deadline", deadline: "2027-05-01" });
  });
  it("el plazo manda aunque no haya fecha de boda", () => {
    expect(rsvpWindow({ weddingDate: null, rsvpDeadline: "2027-04-30" }, LATE_MAY_1).status).toBe("closed");
  });
  it("sin plazo: abierta hasta el final del día siguiente a la boda (misma regla que la RPC)", () => {
    expect(rsvpWindow({ weddingDate: "2027-04-30", rsvpDeadline: null }, LATE_MAY_1)).toEqual({ status: "open", deadline: null });
    expect(rsvpWindow({ weddingDate: "2027-04-30", rsvpDeadline: null }, EARLY_MAY_2)).toEqual({ status: "closed", reason: "wedding_over", weddingDate: "2027-04-30" });
  });
  it("una fecha inválida se ignora (falla abierta; la RPC sigue mandando)", () => {
    expect(rsvpWindow({ weddingDate: "2027-02-31", rsvpDeadline: "basura" }, LATE_MAY_1)).toEqual({ status: "open", deadline: null });
  });
});

describe("formatRsvpDate", () => {
  it("«1 de mayo» en el año en curso y con año si es otro", () => {
    expect(formatRsvpDate("2027-05-01", LATE_MAY_1)).toBe("1 de mayo");
    expect(formatRsvpDate("2028-01-15", LATE_MAY_1)).toBe("15 de enero de 2028");
  });
});
