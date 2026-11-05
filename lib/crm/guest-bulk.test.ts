import { describe, expect, it } from "vitest";
import { deleteConfirmText, deleteDoneText, deletePendingText, giftDeletionImpact, selectedGuests, sendableGuests, statusChangeHelp, statusDoneText, type BulkGuest } from "./guest-bulk";

const guest = (id: string, extra: Partial<BulkGuest> = {}): BulkGuest => ({ id, name: `Invitado ${id}`, rsvp_status: "pendiente", invitation_prepared_at: null, invitation_sent_at: null, group_name: null, tags: [], ...extra });
const gift = (...givers: string[]) => ({ givers: givers.map((guestId) => ({ guestId })) });

describe("giftDeletionImpact", () => {
  it("se borra el regalo cuyos regalantes son todos elegidos; se queda el compartido con alguien que no", () => {
    const ids = new Set(["a", "b"]);
    expect(giftDeletionImpact([gift("a"), gift("a", "b"), gift("a", "c"), gift("c")], ids)).toEqual({ giftsDeleted: 2, giftsKept: 1 });
  });
  it("ignora regalos sin elegidos y regalos ya sin regalantes (retención)", () => {
    expect(giftDeletionImpact([gift("z"), gift()], new Set(["a"]))).toEqual({ giftsDeleted: 0, giftsKept: 0 });
  });
});

describe("textos de borrar en bloque", () => {
  it("dice lo que se va con ellos y los regalos, en singular y plural", () => {
    expect(deleteConfirmText(1, { giftsDeleted: 0, giftsKept: 0 })).toEqual(["Se borra de vuestra lista con su respuesta, sus acompañantes con nombre y su sitio en las mesas. Su enlace personal dejará de funcionar."]);
    const many = deleteConfirmText(3, { giftsDeleted: 2, giftsKept: 1 });
    expect(many[0]).toContain("Sus enlaces personales dejarán de funcionar.");
    expect(many).toContain("También se borrarán los 2 regalos que les habéis anotado.");
    expect(many).toContain("El regalo que hicieron con otras personas se queda con ellas.");
    expect(deleteConfirmText(2, { giftsDeleted: 1, giftsKept: 2 })).toEqual(expect.arrayContaining(["También se borrará el regalo que les habéis anotado.", "Los 2 regalos que hicieron con otras personas se quedan con ellas."]));
  });
  it("sin poder comprobar los regalos no promete que no se borre ninguno", () => {
    expect(deleteConfirmText(2, null).join(" ")).toContain("No hemos podido comprobar sus regalos");
  });
  it("aviso pendiente y final con recuento de ausentes", () => {
    expect(deletePendingText(1)).toBe("Borrando a 1 invitado…");
    expect(deletePendingText(1200)).toBe("Borrando a 1.200 invitados…");
    expect(deleteDoneText(3, 0)).toBe("3 invitados borrados");
    expect(deleteDoneText(1, 2)).toBe("1 invitado borrado · 2 ya no estaban en la lista");
  });
});

describe("textos de marcar asistencia", () => {
  it("explica qué pasa con los acompañantes", () => {
    expect(statusChangeHelp("si")).toContain("conserva sus acompañantes");
    expect(statusChangeHelp("no")).toBe("Sus acompañantes dejan de contar.");
    expect(statusChangeHelp("pendiente")).toBe("Sus acompañantes dejan de contar.");
  });
  it("usa las mismas etiquetas que la ficha", () => {
    expect(statusDoneText("si", 12, 0)).toBe("12 invitados marcados como «Asiste»");
    expect(statusDoneText("no", 1, 1)).toBe("1 invitado marcado como «No asiste» · 1 ya no estaba en la lista");
    expect(statusDoneText("pendiente", 2, 0)).toBe("2 invitados marcados como «Sin respuesta»");
  });
});

describe("selección", () => {
  it("primero la página en su orden y después el resto del filtro, sin repetir", () => {
    const page = [guest("1"), guest("2"), guest("3")];
    const rest = new Map([["2", guest("2")], ["9", guest("9")], ["8", guest("8")]]);
    expect(selectedGuests(new Set(["3", "1", "9", "2"]), page, rest).map((item) => item.id)).toEqual(["1", "2", "3", "9"]);
    expect(selectedGuests(new Set(["3", "9"]), page, null).map((item) => item.id)).toEqual(["3"]);
  });
  it("«Marcar enviada» solo para quien tiene enlace y aún no tiene el envío confirmado", () => {
    const list = [guest("a"), guest("b", { invitation_prepared_at: "x" }), guest("c", { invitation_prepared_at: "x", invitation_sent_at: "y" })];
    expect(sendableGuests(list).map((item) => item.id)).toEqual(["b"]);
  });
});
