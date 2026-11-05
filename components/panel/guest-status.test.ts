import { describe, expect, it } from "vitest";
import { companionsLabel, displayStatus, formatCount, guestStatus, initials, plural } from "./guest-status";

const base = { invitation_prepared_at: null, invitation_sent_at: null } as const;

describe("guestStatus: la respuesta manda, después lo que hizo la pareja", () => {
  it("confirmada y no viene ignoran el estado de la invitación", () => {
    expect(guestStatus({ rsvp_status: "si", ...base })).toBe("confirmed");
    expect(guestStatus({ rsvp_status: "no", invitation_prepared_at: "2026-10-01", invitation_sent_at: "2026-10-02" })).toBe("declined");
  });
  it("sin respuesta: enviada > preparada > pendiente", () => {
    expect(guestStatus({ rsvp_status: "pendiente", invitation_prepared_at: "2026-10-01", invitation_sent_at: "2026-10-02" })).toBe("sent");
    expect(guestStatus({ rsvp_status: "pendiente", invitation_prepared_at: "2026-10-01", invitation_sent_at: null })).toBe("prepared");
    expect(guestStatus({ rsvp_status: "pendiente", ...base })).toBe("pending");
  });
});

describe("initials", () => {
  it("toma la primera letra de las dos primeras palabras", () => {
    expect(initials("María José Álvarez")).toBe("MJ");
    expect(initials("ángel")).toBe("Á");
    expect(initials("   ")).toBe("·");
  });
});

describe("companionsLabel", () => {
  it("solo cuenta acompañantes de quien confirma", () => {
    expect(companionsLabel({ rsvp_status: "si", rsvp_companions: 2 })).toBe("+2 acompañantes");
    expect(companionsLabel({ rsvp_status: "si", rsvp_companions: 1 })).toBe("+1 acompañante");
    expect(companionsLabel({ rsvp_status: "pendiente", rsvp_companions: 3 })).toBe("");
  });
});

describe("peor caso (break-ui)", () => {
  it("iniciales con emoji compuestos no parten el grafema", () => {
    expect(initials("👩‍❤️‍👨 Pareja")).toBe("👩‍❤️‍👨P");
    expect(initials("🎉")).toBe("🎉");
    expect(initials("   ")).toBe("·");
  });
  it("formatCount usa punto de miles", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1.000");
    expect(formatCount(1234567)).toBe("1.234.567");
    expect(formatCount(Number.NaN)).toBe("0");
  });
  it("plural: singular solo con 1", () => {
    expect(plural(1, "persona", "personas")).toBe("1 persona");
    expect(plural(0, "persona", "personas")).toBe("0 personas");
    expect(plural(1000, "persona", "personas")).toBe("1.000 personas");
  });
});

describe("displayStatus: «Abierta» refina cualquier estado sin respuesta", () => {
  it("enviada + abierta = Abierta; sin apertura sigue Enviada", () => {
    expect(displayStatus("sent", "2026-10-03T10:00:00Z")).toBe("opened");
    expect(displayStatus("sent", null)).toBe("sent");
  });
  it("preparada sin «Sí, enviada» pero con su enlace abierto = Abierta (la apertura prueba la entrega)", () => {
    expect(displayStatus("prepared", "2026-10-03T10:00:00Z")).toBe("opened");
    expect(displayStatus("pending", "2026-10-03T10:00:00Z")).toBe("opened");
    expect(displayStatus("prepared", null)).toBe("prepared");
    expect(displayStatus("pending", undefined)).toBe("pending");
  });
  it("la respuesta manda aunque la haya abierto", () => {
    expect(displayStatus("confirmed", "2026-10-03T10:00:00Z")).toBe("confirmed");
    expect(displayStatus("declined", "2026-10-03T10:00:00Z")).toBe("declined");
  });
});
