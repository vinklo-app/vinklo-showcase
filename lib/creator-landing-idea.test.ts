import { describe, expect, it } from "vitest";
import { landingIdeaParam, planLandingIdea, replaceIdea } from "./creator-compose";
import { IDEA_MIN_LENGTH } from "./ai/idea-merge";
import { BUILDER_IDEA_MAX, EMPTY_DRAFT, type BuilderDraft } from "./wedding-builder";

/**
 * Frase de la landing («contadnos vuestra boda en una frase y os la
 * preparamos») → /crear?idea= → creador. Antes se guardaba y nunca se leía.
 */
const draft = (values: Partial<BuilderDraft> = {}): BuilderDraft => ({ ...EMPTY_DRAFT, ...values });
const sentence = "Somos Elena y Marcos, nos casamos el 19 de junio de 2027 bajo los olivos";

describe("landingIdeaParam", () => {
  it("limpia, recorta al límite del borrador y descarta lo vacío", () => {
    expect(landingIdeaParam(`  ${sentence}  `)).toBe(sentence);
    expect(landingIdeaParam("x".repeat(BUILDER_IDEA_MAX + 50))).toHaveLength(BUILDER_IDEA_MAX);
    expect(landingIdeaParam("   ")).toBeUndefined();
    expect(landingIdeaParam(null)).toBeUndefined();
    expect(landingIdeaParam(undefined)).toBeUndefined();
  });
  it("lee la frase tal como la codifica el formulario GET de la landing", () => {
    const query = new URLSearchParams(new URL(`https://vinklo.test/crear?${new URLSearchParams({ idea: sentence })}`).search);
    expect(landingIdeaParam(query.get("idea"))).toBe(sentence);
  });
});

describe("planLandingIdea", () => {
  it("sin borrador: guarda la frase, sugiere estilo y pide leerla con IA", () => {
    const plan = planLandingIdea(null, sentence);
    expect(plan.draft.idea).toBe(sentence);
    expect(plan.draft.style).toBe("natural");
    expect(plan.read).toBe(sentence);
    expect(plan.conflict).toBeNull();
    expect(plan.short).toBeNull();
  });

  it("borrador sin idea: añade la frase sin tocar lo escrito y la lee", () => {
    const saved = draft({ partnerName1: "Elena", venue: "Finca Los Olivos" });
    const plan = planLandingIdea(saved, sentence);
    expect(plan.draft).toMatchObject({ idea: sentence, partnerName1: "Elena", venue: "Finca Los Olivos" });
    expect(plan.read).toBe(sentence);
  });

  it("recarga con la misma idea ya guardada: no se vuelve a leer ni se pregunta", () => {
    const saved = draft({ idea: sentence, partnerName1: "Elena", partnerName2: "Marcos" });
    const plan = planLandingIdea(saved, `  ${sentence} `);
    expect(plan.draft).toBe(saved);
    expect(plan.read).toBeNull();
    expect(plan.conflict).toBeNull();
  });

  it("otra idea ya guardada: se conserva y se pregunta (nunca se descarta en silencio)", () => {
    const saved = draft({ idea: "Una boda en la playa", partnerName1: "Ana" });
    const plan = planLandingIdea(saved, sentence);
    expect(plan.draft).toBe(saved);
    expect(plan.read).toBeNull();
    expect(plan.conflict).toBe(sentence);
  });

  it("frase demasiado corta: se guarda y queda para completarla, sin gastar una lectura", () => {
    expect("En mayo".length).toBeLessThan(IDEA_MIN_LENGTH);
    const plan = planLandingIdea(null, "En mayo");
    expect(plan.draft.idea).toBe("En mayo");
    expect(plan.read).toBeNull();
    expect(plan.short).toBe("En mayo");
  });

  it("sin frase: el borrador guardado tal cual", () => {
    const saved = draft({ partnerName1: "Ana" });
    expect(planLandingIdea(saved, "  ")).toEqual({ draft: saved, read: null, conflict: null, short: null });
    expect(planLandingIdea(null, undefined).draft).toBe(EMPTY_DRAFT);
  });
});

describe("replaceIdea («Usar la nueva»)", () => {
  it("la nueva sustituye a la vieja y conserva lo escrito", () => {
    const suggested = draft({ idea: "Una boda en la ciudad", style: "editorial", partnerName1: "Ana" });
    expect(replaceIdea(suggested, sentence)).toMatchObject({ idea: sentence, style: "natural", partnerName1: "Ana" });
    expect(replaceIdea(suggested, "   ")).toBe(suggested);
  });
  it("respeta un estilo elegido a mano y el de una plantilla", () => {
    expect(replaceIdea(draft({ idea: "Una boda en la ciudad", style: "clasico" }), sentence).style).toBe("clasico");
    expect(replaceIdea(draft({ idea: "Una boda en la ciudad", style: "editorial", template: "olivo" }), sentence).style).toBe("editorial");
  });
});
