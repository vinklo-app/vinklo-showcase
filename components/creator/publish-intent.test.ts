import { afterEach, describe, expect, it, vi } from "vitest";

import { PUBLISH_INTENT_KEY, PUBLISH_INTENT_TTL_MS, autoPublishDecision, bindPublishIntent, clearPublishIntent, consumePublishIntent, createAutoPublishGate, hasPublishIntent, markPublishIntent, readPublishIntent, type AutoPublishInput } from "./publish-intent";
import { BUILDER_STORAGE_KEY, EMPTY_DRAFT } from "@/lib/wedding-builder";

/** localStorage de mentira (vitest corre en node). */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

const NOW = Date.parse("2026-10-16T10:00:00Z");
const ready = { authenticated: true, intent: true, sameAccount: true, pendingInvite: false, resolved: true, recovered: false, photoLost: false, incomplete: false };

describe("Marca «crear cuenta y publicar» (publish-intent)", () => {
  it("se marca, se lee y caduca a las 24 h", () => {
    const storage = memoryStorage();
    expect(hasPublishIntent(storage, NOW)).toBe(false);
    expect(markPublishIntent(storage, NOW)).toBe(true);
    expect(hasPublishIntent(storage, NOW + 60_000)).toBe(true);
    expect(hasPublishIntent(storage, NOW + PUBLISH_INTENT_TTL_MS)).toBe(true);
    expect(hasPublishIntent(storage, NOW + PUBLISH_INTENT_TTL_MS + 1)).toBe(false);
  });
  it("solo una vez: consumirla la borra; la segunda lectura (recargar, volver atrás) ya no publica", () => {
    const storage = memoryStorage();
    markPublishIntent(storage, NOW);
    expect(consumePublishIntent(storage, NOW)).toBe(true);
    expect(consumePublishIntent(storage, NOW)).toBe(false);
    expect(storage.getItem(PUBLISH_INTENT_KEY)).toBeNull();
  });
  it("valores raros, del futuro o sin almacenamiento: no hay marca y nada lanza", () => {
    const storage = memoryStorage();
    storage.setItem(PUBLISH_INTENT_KEY, "no-es-fecha");
    expect(hasPublishIntent(storage, NOW)).toBe(false);
    storage.setItem(PUBLISH_INTENT_KEY, new Date(NOW + 3_600_000).toISOString());
    expect(hasPublishIntent(storage, NOW)).toBe(false);
    expect(hasPublishIntent(null, NOW)).toBe(false);
    expect(markPublishIntent(null, NOW)).toBe(false);
    const broken = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("lleno"); }, removeItem: () => { throw new Error("bloqueado"); } };
    expect(markPublishIntent(broken, NOW)).toBe(false);
    expect(hasPublishIntent(broken, NOW)).toBe(false);
    expect(() => clearPublishIntent(broken)).not.toThrow();
  });
  it("vive en su propia clave: el borrador (lo que copia el servidor) no la lleva", () => {
    const storage = memoryStorage();
    storage.setItem(BUILDER_STORAGE_KEY, JSON.stringify(EMPTY_DRAFT));
    markPublishIntent(storage, NOW);
    expect(storage.getItem(BUILDER_STORAGE_KEY)).toBe(JSON.stringify(EMPTY_DRAFT));
    expect(PUBLISH_INTENT_KEY).not.toBe(BUILDER_STORAGE_KEY);
  });
});

describe("autoPublishDecision", () => {
  it("con cuenta, intención y el borrador completo ya recuperado: publica sola", () => {
    expect(autoPublishDecision(ready)).toBe("publish");
  });
  it("sin sesión o sin intención: como siempre", () => {
    expect(autoPublishDecision({ ...ready, authenticated: false })).toBe("none");
    expect(autoPublishDecision({ ...ready, intent: false })).toBe("none");
  });
  it("espera a que estén el borrador, la foto y las fotos de la galería (si no, publicaría sin ellas)", () => {
    expect(autoPublishDecision({ ...ready, resolved: false })).toBe("wait");
  });
  it("faltan datos imprescindibles: no publica; se abre lo que falta", () => {
    expect(autoPublishDecision({ ...ready, incomplete: true })).toBe("missing");
  });
  it("la foto elegida no está en este navegador: no publica sin ella; lo ven y publican con un toque", () => {
    expect(autoPublishDecision({ ...ready, photoLost: true })).toBe("review");
  });
  it("marca de otro correo (o sin correo): nunca se publica sola, ni espera a nada", () => {
    expect(autoPublishDecision({ ...ready, sameAccount: false })).toBe("review");
    expect(autoPublishDecision({ ...ready, sameAccount: false, resolved: false })).toBe("review");
  });
  it("invitación de pareja pendiente: no crea una segunda boda sola (se ve el aviso)", () => {
    expect(autoPublishDecision({ ...ready, pendingInvite: true })).toBe("review");
    expect(autoPublishDecision({ ...ready, pendingInvite: true, resolved: false })).toBe("review");
  });
  it("otro navegador (borrador recuperado del servidor): nunca se publica solo", () => {
    // En otro navegador no hay marca (vive en el localStorage del primero)…
    expect(autoPublishDecision({ ...ready, intent: false, recovered: true })).toBe("none");
    // …y aunque la hubiera, una copia del servidor no se adopta en silencio.
    expect(autoPublishDecision({ ...ready, recovered: true })).toBe("review");
  });
});

describe("Otro navegador vía la copia del servidor (keepBuilderDraft)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock("@/lib/actions/builder-stash"); });
  it("la copia que se guarda con el correo es solo el borrador: la marca no viaja", async () => {
    const stash = vi.fn<(input: { email: string; draft: unknown }) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    vi.doMock("@/lib/actions/builder-stash", () => ({ stashBuilderDraft: stash }));
    const storage = memoryStorage();
    storage.setItem(BUILDER_STORAGE_KEY, JSON.stringify({ ...EMPTY_DRAFT, partnerName1: "Ana", partnerName2: "Pablo", weddingDate: "2027-06-12", step: 3 }));
    markPublishIntent(storage, NOW);
    vi.stubGlobal("localStorage", storage);
    const { keepBuilderDraft } = await import("@/app/login/keep-draft");
    expect(await keepBuilderDraft("ana@example.com")).toBe(true);
    const sent = JSON.stringify(stash.mock.calls[0]![0]);
    expect(sent).toContain("Ana");
    expect(sent).not.toContain(PUBLISH_INTENT_KEY);
    expect(sent).not.toContain("publish");
  });
});

describe("Marca atada al correo (I-2: ordenador compartido)", () => {
  it("el creador deja la marca sin correo; /login?registro=1 la ata al email escrito (normalizado)", () => {
    const storage = memoryStorage();
    markPublishIntent(storage, NOW);
    expect(readPublishIntent(storage, NOW)).toEqual({ at: NOW, email: null });
    expect(hasPublishIntent(storage, NOW, "ana@example.com")).toBe(false);
    expect(bindPublishIntent(storage, "  Ana@Example.com ", NOW + 1000)).toBe(true);
    expect(readPublishIntent(storage, NOW + 1000)).toEqual({ at: NOW, email: "ana@example.com" });
    expect(hasPublishIntent(storage, NOW + 1000, "ANA@example.com")).toBe(true);
    expect(hasPublishIntent(storage, NOW + 1000, "bea@example.com")).toBe(false);
    expect(hasPublishIntent(storage, NOW + 1000, null)).toBe(false);
  });
  it("sin marca no se ata nada; la caducidad cuenta desde que se pulsó, no desde que se ató", () => {
    const storage = memoryStorage();
    expect(bindPublishIntent(storage, "ana@example.com", NOW)).toBe(false);
    expect(storage.getItem(PUBLISH_INTENT_KEY)).toBeNull();
    markPublishIntent(storage, NOW);
    bindPublishIntent(storage, "ana@example.com", NOW + PUBLISH_INTENT_TTL_MS - 1);
    expect(hasPublishIntent(storage, NOW + PUBLISH_INTENT_TTL_MS + 1, "ana@example.com")).toBe(false);
  });
  it("una marca del formato anterior (solo la hora) no vale: no se publica nada", () => {
    const storage = memoryStorage();
    storage.setItem(PUBLISH_INTENT_KEY, new Date(NOW).toISOString());
    expect(readPublishIntent(storage, NOW)).toBeNull();
    expect(bindPublishIntent(storage, "ana@example.com", NOW)).toBe(false);
  });
});

describe("createAutoPublishGate (el efecto del asistente, sin React)", () => {
  const base: AutoPublishInput = { authenticated: true, email: "ana@example.com", pendingInvite: false, resolved: true, recovered: false, photoLost: false, incomplete: false };
  function setup(email: string | null = "ana@example.com") {
    const storage = memoryStorage();
    markPublishIntent(storage, NOW);
    if (email) bindPublishIntent(storage, email, NOW);
    return { storage, gate: createAutoPublishGate(() => storage, () => NOW + 5000) };
  }

  it("misma cuenta y todo listo: publica una vez, borra la marca y no vuelve a decidir", () => {
    const { storage, gate } = setup();
    expect(gate.step(base)).toBe("publish");
    expect(storage.getItem(PUBLISH_INTENT_KEY)).toBeNull();
    expect(gate.step(base)).toBeNull();
  });
  it("I-1: un toque mientras espera la foto reclama la creación; el efecto ya no crea otra", () => {
    const { storage, gate } = setup();
    expect(gate.step({ ...base, resolved: false })).toBe("wait");
    expect(gate.claim()).toBe(true); // el toque
    expect(storage.getItem(PUBLISH_INTENT_KEY)).toBeNull();
    expect(gate.step(base)).toBeNull(); // la foto llega: nada
    expect(gate.claim()).toBe(false); // y un segundo create() tampoco arranca
  });
  it("I-1: con la automática en marcha, el botón no lanza una segunda creación; si falla, se puede reintentar", () => {
    const { gate } = setup();
    expect(gate.step(base)).toBe("publish");
    expect(gate.claim()).toBe(true); // create() de la automática
    expect(gate.claim()).toBe(false); // el botón a la vez
    gate.release(); // falló
    expect(gate.claim()).toBe(true); // reintento a mano
    expect(gate.step(base)).toBeNull();
  });
  it("I-2: la sesión es de otro correo: no publica y borra la marca", () => {
    const { storage, gate } = setup("ana@example.com");
    expect(gate.step({ ...base, email: "bea@example.com" })).toBe("review");
    expect(storage.getItem(PUBLISH_INTENT_KEY)).toBeNull();
  });
  it("I-2: marca sin correo (no pasó por /login?registro=1, p. ej. Google): no publica", () => {
    const { gate } = setup(null);
    expect(gate.step(base)).toBe("review");
  });
  it("I-3: invitación de pareja pendiente: no publica y borra la marca", () => {
    const { storage, gate } = setup();
    expect(gate.step({ ...base, pendingInvite: true })).toBe("review");
    expect(storage.getItem(PUBLISH_INTENT_KEY)).toBeNull();
  });
  it("sin marca: nada; sin sesión (/crear): borra la marca que hubiera", () => {
    const storage = memoryStorage();
    expect(createAutoPublishGate(() => storage).step(base)).toBe("none");
    markPublishIntent(storage, NOW);
    expect(createAutoPublishGate(() => storage).step({ ...base, authenticated: false })).toBe("none");
    expect(storage.getItem(PUBLISH_INTENT_KEY)).toBeNull();
  });
});
