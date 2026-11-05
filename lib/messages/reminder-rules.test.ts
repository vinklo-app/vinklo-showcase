import { describe, expect, it } from "vitest";
import { DEADLINE_SOON_DAYS, deliveredAt, isReminderDue, REMINDER_MIN_GAP_DAYS, reminderPeriod, selectReminders, sortReminders, type ReminderCandidate, type ReminderPeriod } from "./reminder-rules";

// Miércoles 14-oct-2026, 12:00 en Madrid (10:00 UTC).
const now = new Date("2026-10-14T10:00:00Z");
const daysAgo = (days: number, hours = 0) => new Date(now.getTime() - (days * 24 + hours) * 3_600_000).toISOString();
const open: ReminderPeriod = { status: "open", deadline: null, daysLeft: null, soon: false };
const guest = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  rsvp_status: "pendiente", phone: "612345678", invitation_sent_at: daysAgo(5), invitation_opened_at: null,
  last_reminder_at: null, reminders_opt_out: false, ...over,
});

describe("constantes", () => {
  it("3 días de margen y plazo «inminente» a 3 días", () => {
    expect(REMINDER_MIN_GAP_DAYS).toBe(3);
    expect(DEADLINE_SOON_DAYS).toBe(3);
  });
});

describe("a) abrir el enlace cuenta como entregada", () => {
  it("deliveredAt: envío confirmado o, si no, la primera apertura", () => {
    expect(deliveredAt({ invitation_sent_at: "2026-10-01T10:00:00Z", invitation_opened_at: "2026-10-02T10:00:00Z" })).toBe("2026-10-01T10:00:00Z");
    expect(deliveredAt({ invitation_sent_at: null, invitation_opened_at: "2026-10-02T10:00:00Z" })).toBe("2026-10-02T10:00:00Z");
    expect(deliveredAt({ invitation_sent_at: null, invitation_opened_at: null })).toBeNull();
  });
  it("abierta hace 4 días sin «Sí, enviada» → entra en recordatorios", () => {
    expect(isReminderDue(guest({ invitation_sent_at: null, invitation_opened_at: daysAgo(4) }), open, now)).toBe(true);
  });
  it("ni enviada ni abierta (solo preparada, o WhatsApp abierto sin confirmar) → no", () => {
    expect(isReminderDue(guest({ invitation_sent_at: null, invitation_opened_at: null }), open, now)).toBe(false);
  });
});

describe("b) margen tras la entrega y plazo", () => {
  it("enviada hace menos de 3 días → todavía no; desde 3 días → sí", () => {
    expect(isReminderDue(guest({ invitation_sent_at: daysAgo(0, 1) }), open, now)).toBe(false);
    expect(isReminderDue(guest({ invitation_sent_at: daysAgo(2, 23) }), open, now)).toBe(false);
    expect(isReminderDue(guest({ invitation_sent_at: daysAgo(3) }), open, now)).toBe(true);
  });
  it("abierta hace 1 día sin «Sí, enviada» → todavía no (el margen cuenta desde la apertura)", () => {
    expect(isReminderDue(guest({ invitation_sent_at: null, invitation_opened_at: daysAgo(1) }), open, now)).toBe(false);
  });
  it("con el plazo a 3 días o menos, se puede recordar aunque la invitación sea de ayer", () => {
    const soon = reminderPeriod({ weddingDate: "2027-06-12", rsvpDeadline: "2026-10-17" }, now);
    expect(soon).toEqual({ status: "open", deadline: "2026-10-17", daysLeft: 3, soon: true });
    expect(isReminderDue(guest({ invitation_sent_at: daysAgo(1) }), soon, now)).toBe(true);
  });
  it("con el plazo a 4 días se mantiene el margen", () => {
    const later = reminderPeriod({ weddingDate: "2027-06-12", rsvpDeadline: "2026-10-18" }, now);
    expect(later).toMatchObject({ status: "open", daysLeft: 4, soon: false });
    expect(isReminderDue(guest({ invitation_sent_at: daysAgo(1) }), later, now)).toBe(false);
  });
  it("el plazo termina hoy: aún abierto e inminente", () => {
    expect(reminderPeriod({ weddingDate: "2027-06-12", rsvpDeadline: "2026-10-14" }, now)).toEqual({ status: "open", deadline: "2026-10-14", daysLeft: 0, soon: true });
  });
  it("plazo pasado → nadie para recordar", () => {
    const closed = reminderPeriod({ weddingDate: "2027-06-12", rsvpDeadline: "2026-10-13" }, now);
    expect(closed.status).toBe("closed");
    expect(isReminderDue(guest({ invitation_sent_at: daysAgo(20) }), closed, now)).toBe(false);
  });
  it("sin fecha límite y con la boda ya pasada → nadie", () => {
    const over = reminderPeriod({ weddingDate: "2026-10-10", rsvpDeadline: null }, now);
    expect(over).toMatchObject({ status: "closed", window: { reason: "wedding_over" } });
    expect(isReminderDue(guest(), over, now)).toBe(false);
  });
  it("sin fechas → abierto, sin plazo inminente", () => {
    expect(reminderPeriod({ weddingDate: null, rsvpDeadline: null }, now)).toEqual(open);
  });
  it("entre recordatorios, siempre 3 días (también con el plazo encima)", () => {
    const soon = reminderPeriod({ weddingDate: "2027-06-12", rsvpDeadline: "2026-10-15" }, now);
    expect(isReminderDue(guest({ invitation_sent_at: daysAgo(10), last_reminder_at: daysAgo(1) }), soon, now)).toBe(false);
    expect(isReminderDue(guest({ invitation_sent_at: daysAgo(10), last_reminder_at: daysAgo(3) }), open, now)).toBe(true);
  });
});

describe("c) quien respondió, no quiere recordatorios o no tiene WhatsApp", () => {
  it.each([
    ["ha dicho que sí", { rsvp_status: "si" as const }],
    ["ha dicho que no", { rsvp_status: "no" as const }],
    ["pidió no recibirlos", { reminders_opt_out: true }],
    ["sin teléfono", { phone: null }],
    ["teléfono que no sirve para WhatsApp", { phone: "123" }],
  ])("%s → no", (_label, over) => {
    expect(isReminderDue(guest(over), open, now)).toBe(false);
  });
});

describe("selectReminders / sortReminders", () => {
  it("filtra, quita duplicados y ordena por el contacto más antiguo (recordatorio o entrega)", () => {
    const items = [
      { id: "b", ...guest({ invitation_sent_at: daysAgo(4) }) },
      { id: "a", ...guest({ invitation_sent_at: null, invitation_opened_at: daysAgo(6) }) },
      { id: "c", ...guest({ invitation_sent_at: daysAgo(20), last_reminder_at: daysAgo(5) }) },
      { id: "d", ...guest({ rsvp_status: "si" }) },
      { id: "b", ...guest({ invitation_sent_at: daysAgo(4) }) },
    ];
    expect(selectReminders(items, open, now).map((item) => item.id)).toEqual(["a", "c", "b"]);
  });
  it("con el plazo cerrado, vacía", () => {
    const closed = reminderPeriod({ weddingDate: "2027-06-12", rsvpDeadline: "2026-10-01" }, now);
    expect(selectReminders([{ id: "a", ...guest() }], closed, now)).toEqual([]);
  });
  it("orden estable por id con la misma fecha", () => {
    const same = daysAgo(5);
    const sorted = sortReminders([{ id: "z", invitation_sent_at: same, invitation_opened_at: null, last_reminder_at: null }, { id: "m", invitation_sent_at: same, invitation_opened_at: null, last_reminder_at: null }]);
    expect(sorted.map((item) => item.id)).toEqual(["m", "z"]);
  });
});
