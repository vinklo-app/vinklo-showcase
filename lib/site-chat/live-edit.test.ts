import { describe, expect, it } from "vitest";
import { documentFromLegacy, type Scene, type SiteDocument } from "@/lib/site-document";
import { EMPTY_DRAFT, composeBuilderDocument } from "@/lib/wedding-builder";
import { describeEditTarget } from "./edit-focus";
import { creatorLiveRoute, liveEditLabel, panelLiveRoute } from "./live-edit";

/** Editar desde la vista previa en el ordenador (punto 6): qué hace cada clic. */
const legacy = documentFromLegacy({
  partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null,
  page_config: { style: "editorial", welcomeMessage: "Os esperamos", venue: "Finca El Olivar", address: "", time: "17:30" },
});
const withScene = (doc: SiteDocument, scene: Scene): SiteDocument => ({ ...doc, scenes: [...doc.scenes, scene] });
const panelDoc = withScene(legacy, { id: "preguntas", type: "faq", enabled: true, props: { title: "Preguntas", contact: "", items: [{ id: "q-1", question: "¿Hay aparcamiento?", answer: "Sí." }] } });

const draft = {
  ...EMPTY_DRAFT, partnerName1: "Marta", partnerName2: "Jaime", weddingDate: "2027-09-12", venue: "Finca Toledo",
  day: { ceremony: { time: "12:00", place: "Iglesia", address: "" }, cocktail: { time: "", place: "", address: "" }, banquet: { time: "", place: "", address: "" } },
  dayMoments: [{ id: "m-1", title: "Fiesta", timeLabel: "23:00", place: "", address: "", notes: "" }],
};
const creatorDoc = composeBuilderDocument(draft);
const coverId = creatorDoc.scenes.find((s) => s.type === "cover")!.id;
const venueId = creatorDoc.scenes.find((s) => s.type === "venue")!.id;
const agendaId = creatorDoc.scenes.find((s) => s.type === "agenda")!.id;
const ids = { cover: coverId, venue: venueId, chat: true };

describe("creador: clic en la vista previa", () => {
  it("los textos que guarda el borrador se editan ahí mismo, con el tope del campo", () => {
    const welcome = creatorLiveRoute(creatorDoc, `${coverId}/welcomeMessage`, ids);
    expect(welcome).toMatchObject({ kind: "text", field: { max: 400, multiline: true } });
    expect(creatorLiveRoute(creatorDoc, `${agendaId}/title`, ids)).toMatchObject({ kind: "text", field: { max: 80, multiline: false } });
  });

  it("nombres, fecha, lugar y foto abren su editor (con el campo exacto cuando lo hay)", () => {
    expect(creatorLiveRoute(creatorDoc, `${coverId}/names`, ids)).toMatchObject({ kind: "field", field: "names" });
    expect(creatorLiveRoute(creatorDoc, `${coverId}/weddingDate`, ids)).toMatchObject({ kind: "field", field: "date", label: "la fecha" });
    expect(creatorLiveRoute(creatorDoc, `${coverId}/image`, ids)).toMatchObject({ kind: "field", field: "photo" });
  });

  it("el lugar es texto editable; la dirección también (mismas reglas que el chat)", () => {
    expect(creatorLiveRoute(creatorDoc, `${venueId}/venue`, ids)).toMatchObject({ kind: "text" });
  });

  it("una fila del programa abre «Vuestro día» con su campo enfocado", () => {
    expect(creatorLiveRoute(creatorDoc, `${agendaId}/items/m-ceremonia/title`, ids)).toEqual({ kind: "field", field: "day", label: expect.any(String), inputId: "wb-day-ceremony-place" });
    expect(creatorLiveRoute(creatorDoc, `${agendaId}/items/m-1/title`, ids)).toMatchObject({ kind: "field", field: "day", inputId: "wb-day-m-1-title" });
  });

  it("lo que no tiene editor propio se selecciona para «Pedid cambios», solo cuando el compositor ya los pide", () => {
    const rsvp = creatorDoc.scenes.find((s) => s.type === "rsvp")!;
    const path = `${rsvp.id}/body`;
    expect(describeEditTarget(creatorDoc, path)).not.toBeNull();
    expect(creatorLiveRoute(creatorDoc, path, ids)).toMatchObject({ kind: "select" });
    expect(creatorLiveRoute(creatorDoc, path, { ...ids, chat: false })).toBeNull();
    expect(creatorLiveRoute(creatorDoc, "no-existe/title", ids)).toBeNull();
    expect(creatorLiveRoute(creatorDoc, "../x", ids)).toBeNull();
  });
});

describe("panel: clic en la vista previa", () => {
  it("todo texto con campo se edita ahí mismo", () => {
    expect(panelLiveRoute(panelDoc, "preguntas/items/q-1/question")).toMatchObject({ kind: "text", field: { max: 160, required: true } });
    expect(panelLiveRoute(panelDoc, "portada/welcomeMessage")).toMatchObject({ kind: "text" });
  });

  it("nombres, fecha y foto llevan a su control", () => {
    expect(panelLiveRoute(panelDoc, "portada/names")).toMatchObject({ kind: "focus", selector: "#ajustes-nombre-1" });
    expect(panelLiveRoute(panelDoc, "portada/weddingDate")).toMatchObject({ kind: "focus", selector: "#ajustes-fecha" });
    expect(panelLiveRoute(panelDoc, "portada/image")).toMatchObject({ kind: "focus", selector: "#la-foto button" });
  });

  it("una ruta que ya no existe no se marca", () => {
    expect(panelLiveRoute(panelDoc, "preguntas/items/q-9/question")).toBeNull();
  });
});

describe("«Seleccionar» sigue tratando la fecha como la portada", () => {
  it("la fecha se selecciona como sección", () => {
    expect(describeEditTarget(legacy, "portada/weddingDate")).toMatchObject({ path: "portada", label: "Portada" });
  });
});

describe("nombres accesibles", () => {
  it("dicen qué pasa al activarlos", () => {
    expect(liveEditLabel({ kind: "text", label: "Portada · Bienvenida", field: { value: "", max: 400, multiline: true, required: false } })).toBe("Editar aquí: Portada · Bienvenida");
    expect(liveEditLabel({ kind: "field", label: "la fecha", field: "date" })).toBe("Cambiar la fecha");
    expect(liveEditLabel({ kind: "select", label: "Confirmación · Texto" })).toBe("Pedir cambios en Confirmación · Texto");
  });
});
