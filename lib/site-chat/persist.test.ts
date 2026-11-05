import { describe, expect, it } from "vitest";
import { documentFromLegacy, resolveLayout, type SiteDocument } from "@/lib/site-document";
import { suggestNextPrompts } from "./suggestions";
import { EMPTY_THREAD, threadReducer, type SiteVersion, type SiteVersionRow, type ThreadAction, type ThreadState } from "./thread";
import { CREATOR_CHAT_STORAGE_KEY, INTERRUPTED_ERROR, STORED_VERSIONS, panelChatStorageKey, parseStoredThread, serializeThread } from "./persist";

/**
 * Historial de «Pedid cambios» (13-oct-2026): peticiones y respuestas siguen
 * en el hilo al recargar. Creador: todo en el navegador. Panel: lo aplicado
 * viene del servidor y lo que falló, del navegador, en su orden.
 */
const doc: SiteDocument = documentFromLegacy({
  partner_name_1: "Ana", partner_name_2: "Luis", wedding_date: "2027-06-12", cover_image_url: null,
  page_config: { style: "editorial", welcomeMessage: "Os esperamos", venue: "Finca El Olivar", address: "", time: "17:30" },
});
const run = (actions: ThreadAction[], from: ThreadState = EMPTY_THREAD) => actions.reduce(threadReducer, from);
const version = (id: string, at: string, extra: Partial<SiteVersion> = {}): SiteVersion => ({ id, kind: "ai", createdAt: at, prompt: `petición ${id}`, summary: `resumen ${id}`, changes: [`cambio ${id}`], document: doc, draftVersion: 1, ...extra });

describe("conversación del creador guardada en el navegador", () => {
  it("peticiones, respuestas, errores y versiones sobreviven a recargar", () => {
    const state = run([
      { type: "seed", version: { ...version("inicio", "2026-10-13T10:00:00.000Z"), kind: "initial", prompt: "" } },
      { type: "send", id: "t1", prompt: "ceremonia a las 12:00", at: "2026-10-13T10:01:00.000Z" },
      { type: "succeed", id: "t1", version: version("v1", "2026-10-13T10:01:05.000Z") },
      { type: "send", id: "t2", prompt: "sin sobre", at: "2026-10-13T10:02:00.000Z" },
      { type: "fail", id: "t2", error: "La invitación siempre se abre con el sobre: eso no se cambia.", retryable: false },
    ]);
    const reloaded = parseStoredThread(serializeThread(state, "all"), "all");
    expect(reloaded).toEqual(state);
    // Al abrir: el hilo vacío recibe lo guardado; un hilo con turnos no se pisa.
    expect(run([{ type: "hydrate", state: reloaded! }])).toEqual(state);
    const busy = run([{ type: "send", id: "x", prompt: "otra", at: "2026-10-13T11:00:00.000Z" }]);
    expect(run([{ type: "hydrate", state: reloaded! }], busy)).toBe(busy);
  });

  it("una petición en marcha al recargar queda como interrumpida, con «Probar de nuevo»", () => {
    const state = run([{ type: "send", id: "t1", prompt: "colores en verde", at: "2026-10-13T10:01:00.000Z" }]);
    const reloaded = parseStoredThread(serializeThread(state, "all"), "all");
    expect(reloaded?.turns).toEqual([{ id: "t1", kind: "ai", prompt: "colores en verde", at: "2026-10-13T10:01:00.000Z", status: "error", error: INTERRUPTED_ERROR, retryable: true }]);
  });

  it("guarda solo las últimas versiones con documento (y la inicial); el hilo entero como texto", () => {
    let state = run([{ type: "seed", version: { ...version("inicio", "2026-10-13T09:00:00.000Z"), kind: "initial", prompt: "" } }]);
    for (let i = 0; i < 15; i++) {
      const at = `2026-10-13T10:${String(i).padStart(2, "0")}:00.000Z`;
      state = run([{ type: "send", id: `t${i}`, prompt: `p${i}`, at }, { type: "succeed", id: `t${i}`, version: version(`v${i}`, at) }], state);
    }
    const reloaded = parseStoredThread(serializeThread(state, "all"), "all")!;
    expect(reloaded.turns).toHaveLength(15);
    expect(reloaded.versions.map((v) => v.id)).toEqual(["inicio", ...Array.from({ length: STORED_VERSIONS }, (_, i) => `v${i + 15 - STORED_VERSIONS}`)]);
    // Sin sitio en el navegador: el hilo como texto, sin documentos.
    expect(parseStoredThread(serializeThread(state, "all", 0), "all")!.versions.map((v) => v.id)).toEqual(["inicio"]);
  });

  it("lo guardado roto, de otra versión o manipulado no entra", () => {
    for (const raw of [null, "", "{", JSON.stringify({ v: 2, turns: [] }), JSON.stringify({ v: 1, turns: [{ id: "x", kind: "otro" }], versions: [{ id: "v", kind: "ai", document: { schemaVersion: 99 } }] })]) {
      expect(parseStoredThread(raw, "all")).toBeNull();
    }
    const long = parseStoredThread(JSON.stringify({ v: 1, turns: [{ id: "x", kind: "ai", status: "error", prompt: "a".repeat(5000), error: "e", retryable: "sí" }], versions: [] }), "all")!;
    expect(long.turns[0]).toMatchObject({ prompt: "a".repeat(600), retryable: false });
  });

  it("claves: una para el creador y una por boda en el panel", () => {
    expect(CREATOR_CHAT_STORAGE_KEY).toBe("vinklo:creator-chat:v1");
    expect(panelChatStorageKey("w-1")).not.toBe(panelChatStorageKey("w-2"));
  });
});

describe("panel: lo aplicado viene del servidor; lo que falló, del navegador", () => {
  it("una petición en marcha no se guarda (pudo guardarse ya en el servidor: no se repetiría al recargar)", () => {
    const state = run([
      { type: "send", id: "t1", prompt: "una pregunta del aparcamiento", at: "2026-10-13T10:01:00.000Z" },
      { type: "stage", id: "t1", stage: "saving" },
    ]);
    expect(parseStoredThread(serializeThread(state, "errors"), "errors")).toBeNull();
  });

  it("solo se guardan los errores, y al recargar se intercalan por hora con el historial", () => {
    const session = run([
      { type: "send", id: "t1", prompt: "verde", at: "2026-10-13T10:01:00.000Z" },
      { type: "succeed", id: "t1", version: version("row-1", "2026-10-13T10:01:05.000Z") },
      { type: "send", id: "t2", prompt: "quitad el sobre", at: "2026-10-13T10:02:00.000Z" },
      { type: "fail", id: "t2", error: "La invitación siempre se abre con el sobre: eso no se cambia.", retryable: false },
    ]);
    const stored = parseStoredThread(serializeThread(session, "errors"), "errors")!;
    expect(stored.turns.map((t) => t.id)).toEqual(["t2"]);
    expect(stored.versions).toEqual([]);

    // Recarga: primero lo del navegador, luego la versión inicial y las filas del servidor.
    const rows: SiteVersionRow[] = [
      { ...version("row-1", "2026-10-13T10:01:05.000Z"), kind: "ai" },
      { ...version("row-2", "2026-10-13T10:03:00.000Z"), kind: "ai" },
    ];
    const after = run([
      { type: "hydrate", state: stored },
      { type: "seed", version: { ...version("inicio", "2026-10-13T11:00:00.000Z"), kind: "initial", prompt: "" } },
      { type: "load", rows },
    ]);
    expect(after.turns.map((t) => (t.kind === "ai" ? `${t.status}:${t.prompt}` : t.kind))).toEqual(["done:petición row-1", "error:quitad el sobre", "done:petición row-2"]);
    expect(after.versions.map((v) => v.id)).toEqual(["inicio", "row-1", "row-2"]);
  });
});

describe("sugerencias sin «Como una Story» (13-oct-2026)", () => {
  it("nunca proponen pasar a la Story", () => {
    const web: SiteDocument = { ...doc, layout: "web" };
    expect(resolveLayout(web)).toBe("web");
    for (const scope of ["all", "design"] as const) {
      expect(suggestNextPrompts(web, { scope, max: 10 }).some((t) => /story/i.test(t))).toBe(false);
    }
  });
});
