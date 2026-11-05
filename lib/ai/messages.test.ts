import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as messages from "./messages";
import { SECTION_LABELS } from "./site-edit-patch";

const {
  AI_TARGETS, NOT_POSSIBLE_KINDS, blockedInCreatorMessage, droppedMessage, friendlyIssue, notPossibleMessage, plainSpanish,
} = messages;

/** Todas las constantes de texto exportadas. */
const constants = Object.entries(messages).filter(([, v]) => typeof v === "string").map(([, v]) => v as string);
const allNotPossible = (["all", "design"] as const).flatMap((scope) => NOT_POSSIBLE_KINDS.map((kind) => notPossibleMessage(kind, scope)));

describe("textos de la IA para la pareja", () => {
  it("ninguno habla de «escenas» ni usa emojis", () => {
    const texts = [
      ...constants,
      ...allNotPossible.map((m) => m.text),
      ...allNotPossible.flatMap((m) => (m.action ? [m.action.label] : [])),
      blockedInCreatorMessage(["preguntas", "vuestra historia"]),
      droppedMessage(["el hotel «Hotel Miramar»"]),
      ...Object.values(SECTION_LABELS),
    ];
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) {
      expect(text).not.toMatch(/escena/i);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("tratan a la pareja de vosotros (sin «usted» ni imperativos de tú)", () => {
    for (const text of [...constants, ...allNotPossible.map((m) => m.text)]) {
      expect(text).not.toMatch(/\busted\b|\bpuedes\b|\btienes\b|\bescribe\b|\bprueba\b/i);
    }
  });

  it("cada imposible del panel dice qué hacer y casi todos llevan atajo a un apartado real", () => {
    const targets = new Set<string>(Object.values(AI_TARGETS));
    for (const kind of NOT_POSSIBLE_KINDS) {
      const m = notPossibleMessage(kind, "all");
      expect(m.text.length).toBeGreaterThan(20);
      if (kind !== "guests") expect(m.action && targets.has(m.action.target)).toBe(true);
    }
  });

  it("en el creador no se ofrecen atajos a apartados que aún no existen", () => {
    for (const kind of NOT_POSSIBLE_KINDS) expect(notPossibleMessage(kind, "design").action).toBeUndefined();
  });

  it("los destinos de los atajos existen en el panel", () => {
    const root = join(__dirname, "..", "..");
    const editor = readFileSync(join(root, "components/panel/site-editor.tsx"), "utf8");
    const settings = readFileSync(join(root, "components/panel/wedding-settings.tsx"), "utf8");
    expect(editor).toContain("id={AI_TARGETS.content}");
    expect(editor).toContain("id={AI_TARGETS.photo}");
    expect(settings).toContain(`id="${AI_TARGETS.settings}"`);
  });

  it("la caja de la IA y el chat del editor tampoco hablan de escenas", () => {
    for (const file of ["components/creator/ai-edit.tsx", "components/site-chat/site-chat.tsx", "components/site-chat/use-site-chat.ts", "lib/site-chat/thread.ts", "lib/site-chat/restore.ts", "lib/site-chat/suggestions.ts"]) {
      const ui = readFileSync(join(__dirname, "..", "..", file), "utf8");
      expect(ui, file).not.toMatch(/escena/i);
    }
  });
});

describe("friendlyIssue", () => {
  it("traduce los errores de contrato con jerga y deja pasar los que ya son claros", () => {
    expect(friendlyIssue({ path: "scenes", message: "Como máximo 14 escenas." })).toEqual({ text: messages.AI_TOO_MANY_SECTIONS_ERROR, action: messages.ACTION_CONTENT });
    expect(friendlyIssue({ path: "", message: "El contenido ocupa 50000 bytes; el máximo es 49152." })).toEqual({ text: messages.AI_TOO_BIG_ERROR, action: messages.ACTION_CONTENT });
    expect(friendlyIssue({ path: "scenes.3.type", message: "Solo puede haber una escena «faq»." }).text).not.toMatch(/escena/i);
    expect(friendlyIssue({ path: "scenes.3.props.items.0.id", message: "Identificador de escena no válido." }).text).not.toMatch(/escena|identificador/i);
    expect(friendlyIssue({ path: "x", message: "La pregunta puede tener hasta 160 caracteres." })).toEqual({ text: "La pregunta puede tener hasta 160 caracteres." });
    expect(friendlyIssue(undefined).text).toBe(messages.AI_LIMITS_ERROR);
  });
});

describe("plainSpanish", () => {
  it("cambia «escena(s)» por «sección(es)»", () => {
    expect(plainSpanish("No podemos añadir escenas; solo ajustar la escena de preguntas. Escenas: tres.")).toBe("No podemos añadir secciones; solo ajustar la sección de preguntas. Secciones: tres.");
    expect(plainSpanish("Ponemos colores verdes.")).toBe("Ponemos colores verdes.");
  });
});

describe("droppedMessage y blockedInCreatorMessage", () => {
  it("dicen qué hacer", () => {
    expect(droppedMessage(["la hora", "el código de «Hotel Sol»"])).toBe("No hemos cambiado la hora y el código de «Hotel Sol»: para no inventar datos, escribid el valor exacto en la petición.");
    expect(blockedInCreatorMessage(["preguntas", "autobuses"])).toBe("Preguntas y autobuses: lo podréis añadir cuando hayáis creado la web, desde Vuestro contenido (o pedírselo a la IA allí).");
  });
});
