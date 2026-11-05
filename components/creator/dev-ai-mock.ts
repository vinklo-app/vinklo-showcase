/**
 * SOLO DESARROLLO. Propuesta simulada de «Pedid cambios» para revisar la
 * interfaz sin AI Gateway (capturas, diseño). Se activa con `?ia=demo` y
 * únicamente cuando `NODE_ENV === "development"`; el creador la carga con
 * `import()` detrás de esa condición, así que en producción no se incluye ni
 * puede fingir un éxito. Usa el mismo `applySitePatch` que el servidor, de
 * modo que el documento resultante es uno que el servidor también aceptaría.
 * Con `focus` («Seleccionar» sobre la bienvenida), cambia la bienvenida.
 * «ceremonia a las 12:00…» añade momentos al programa y «aparcamiento», una
 * pregunta: así se ve que el contenido llega a la vista previa.
 */
import { applySitePatch, EMPTY_SITE_PATCH, type SitePatch } from "@/lib/ai/site-edit-patch";
import type { SiteDocument, SitePaletteId } from "@/lib/site-document";

type MockResult =
  | { ok: true; document: SiteDocument; summary: string; changes: string[]; dropped: string[] }
  | { ok: false; error: string };

const PALETTE_WORDS: ReadonlyArray<[RegExp, SitePaletteId]> = [
  [/verde|natural|campo/, "natural"],
  [/rosa/, "rosa"],
  [/azul|mar/, "mar"],
  [/lavanda|lila|morado/, "lavanda"],
  [/oro|dorado/, "oro"],
  [/terracota|arcilla/, "terracota"],
];

/** «ceremonia a las 12:00, baile a las 23:00» → momentos del programa (solo con hora escrita). */
function agendaFrom(instruction: string): SitePatch["agendaItems"] {
  const items = instruction.split(/[,;]|\s+y\s+/).flatMap((part) => {
    const time = /(\d{1,2}:\d{2})/.exec(part)?.[1];
    if (!time) return [];
    const title = part.replace(time, "").replace(/\b(a las|a la|añadid|poned|el programa|la agenda|programa|agenda|:)\b/gi, "").replace(/\s+/g, " ").trim();
    return title ? [{ id: null, timeLabel: time.padStart(5, "0"), title: title[0]!.toUpperCase() + title.slice(1), place: "" }] : [];
  });
  return items.length > 0 ? items : null;
}

export async function mockProposeSiteEdit(instruction: string, document: SiteDocument, focus?: string): Promise<MockResult> {
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const text = instruction.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/error|falla/.test(text)) return { ok: false, error: "La edición con IA no está disponible ahora mismo." };
  const palette = PALETTE_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  const welcome = /bienvenida|cercan|mensaje/.test(text) || Boolean(focus && /Bienvenida/.test(focus)) ? "Qué ganas de compartir este día contigo. Aquí tienes todo lo que necesitas para acompañarnos." : null;
  // Programa: los momentos que ya hay más los pedidos (como haría el modelo: lista completa).
  const asked = agendaFrom(instruction);
  const current = document.scenes.find((s) => s.type === "agenda");
  const agendaItems = asked && current?.type === "agenda"
    ? [...current.props.items.map((i) => ({ id: i.id, timeLabel: i.timeLabel, title: i.title, place: i.place })), ...asked.filter((a) => !current.props.items.some((i) => i.title.toLowerCase() === a.title.toLowerCase()))]
    : asked;
  const faqScene = document.scenes.find((s) => s.type === "faq");
  const faq = /aparcamiento/.test(text) && faqScene?.type === "faq"
    ? { title: null, contact: null, items: [...faqScene.props.items.filter((q) => q.id !== "q-parking").map((q) => ({ id: q.id, question: q.question, answer: q.answer })), { id: null, question: "¿Dónde se puede aparcar?", answer: "" }] }
    : null;
  const patch: SitePatch = {
    ...EMPTY_SITE_PATCH, palette, coverWelcomeMessage: welcome, coverShowCountdown: /sin cuenta atras/.test(text) ? false : null,
    agendaItems, faq, opening: /sin sobre/.test(text) ? "ninguno" : null, layout: /story/.test(text) ? "historia" : null,
    summary: "Propuesta de prueba (solo desarrollo).",
  };
  const applied = applySitePatch(document, patch, instruction, { scope: "creator" });
  if (!applied.ok) return { ok: false, error: applied.refused.length > 0 ? "La invitación siempre se abre con el sobre y «Como una Story» no se activa desde el chat. (Simulación de desarrollo.)" : "No hemos encontrado nada que cambiar con esa petición. Probad a decir qué color o qué texto queréis." };
  return { ok: true, document: applied.document, summary: `Os proponemos cambiar ${applied.changes.join(" y ")}. (Simulación de desarrollo.)`, changes: applied.changes, dropped: applied.dropped };
}
