import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveEditFailure, LiveEditRecover } from "@/components/site-chat/live-edit-notice";
import { clearLiveDraft, readLiveDraft, saveLiveText, SAVE_FAILED_INLINE, SAVE_FAILED_KEPT, SAVE_FAILED_LOST, type LiveOutcome } from "./live-edit-save";

/** Guardar al salir del campo sin perder el texto (revisión UX ítem 17). */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; }, clear: () => data.clear(), key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)), removeItem: (k) => void data.delete(k),
  };
}
const PATH = "cover/welcomeMessage";

describe("saveLiveText", () => {
  it("fallo de red al salir (blur): no se pierde el texto, error en línea reintentable y borrador guardado", async () => {
    const storage = memoryStorage();
    const save = vi.fn().mockRejectedValue(new Error("network"));
    const result = await saveLiveText({ path: PATH, initial: "Os esperamos", value: "Os esperamos a todos", save, storage });
    expect(result).toEqual({ status: "failed", retryable: true, error: SAVE_FAILED_INLINE, flash: SAVE_FAILED_KEPT });
    expect(SAVE_FAILED_INLINE).toBe("No se ha podido guardar. Vuestro texto sigue aquí.");
    expect(readLiveDraft(PATH, "Os esperamos", storage)).toBe("Os esperamos a todos");
  });

  it("el reintento que acierta devuelve «saved» con el mismo valor y borra el borrador", async () => {
    const storage = memoryStorage();
    const save = vi.fn<(path: string, value: string) => Promise<LiveOutcome>>()
      .mockResolvedValueOnce({ ok: false, error: "No hemos podido guardar el cambio en el borrador.", retryable: true })
      .mockResolvedValueOnce({ ok: true });
    const opts = { path: PATH, initial: "Hola", value: "Hola a todos", save, storage };
    expect((await saveLiveText(opts)).status).toBe("failed");
    expect(await saveLiveText(opts)).toEqual({ status: "saved" });
    expect(save).toHaveBeenLastCalledWith(PATH, "Hola a todos");
    expect(readLiveDraft(PATH, "Hola", storage)).toBeNull();
  });

  it("un blur con guardado correcto no deja borrador", async () => {
    const storage = memoryStorage();
    expect(await saveLiveText({ path: PATH, initial: "A", value: "B", save: async () => ({ ok: true }), storage })).toEqual({ status: "saved" });
    expect(readLiveDraft(PATH, "A", storage)).toBeNull();
  });

  it("errores de validación y conflictos se muestran en línea sin «Reintentar»", async () => {
    const storage = memoryStorage();
    const validation = await saveLiveText({ path: PATH, initial: "A", value: "", save: async () => ({ ok: false, error: "Este texto no puede quedar vacío." }), storage });
    expect(validation).toEqual({ status: "failed", retryable: false, error: "Este texto no puede quedar vacío. Vuestro texto sigue aquí.", flash: `Este texto no puede quedar vacío. ${SAVE_FAILED_LOST}` });
    // Un texto inválido no se guarda para «Recuperarlo» después.
    expect(readLiveDraft(PATH, "A", storage)).toBeNull();
    const conflict = await saveLiveText({ path: PATH, initial: "A", value: "B", save: async () => ({ ok: false, error: "Se guardó otra versión.", retryable: true, conflict: true }), storage });
    expect(conflict).toMatchObject({ status: "failed", retryable: false, flash: SAVE_FAILED_KEPT });
    expect(readLiveDraft(PATH, "A", storage)).toBe("B");
  });

  it("I-6: con el campo ya cerrado, el aviso no dice «sigue aquí»; solo promete recuperarlo si quedó guardado", async () => {
    const kept = await saveLiveText({ path: PATH, initial: "A", value: "B", save: async () => ({ ok: false, error: "", retryable: true }), storage: memoryStorage() });
    expect(kept).toMatchObject({ flash: SAVE_FAILED_KEPT });
    const lost = await saveLiveText({ path: PATH, initial: "A", value: "B", save: async () => ({ ok: false, error: "", retryable: true }), storage: null });
    expect(lost).toMatchObject({ flash: SAVE_FAILED_LOST });
    for (const result of [kept, lost]) if (result.status === "failed") expect(result.flash).not.toContain("sigue aquí");
  });
});

describe("borrador local", () => {
  it("se recupera al volver a abrir el mismo campo, y solo si el original no ha cambiado", () => {
    const storage = memoryStorage();
    storage.setItem("vinklo:live-edit:" + PATH, JSON.stringify({ initial: "A", value: "B" }));
    expect(readLiveDraft(PATH, "A", storage)).toBe("B");
    expect(readLiveDraft(PATH, "otro original", storage)).toBeNull();
    expect(readLiveDraft("otra/ruta", "A", storage)).toBeNull();
    clearLiveDraft(PATH, storage);
    expect(readLiveDraft(PATH, "A", storage)).toBeNull();
  });

  it("descartar borra el borrador; sin almacenamiento o con datos rotos no rompe", async () => {
    const storage = memoryStorage();
    await saveLiveText({ path: PATH, initial: "A", value: "B", save: async () => ({ ok: false, error: "x", retryable: true }), storage });
    clearLiveDraft(PATH, storage);
    expect(readLiveDraft(PATH, "A", storage)).toBeNull();
    storage.setItem("vinklo:live-edit:" + PATH, "{no es json");
    expect(readLiveDraft(PATH, "A", storage)).toBeNull();
    const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } } as unknown as Storage;
    expect(await saveLiveText({ path: PATH, initial: "A", value: "B", save: async () => ({ ok: false, error: "x", retryable: true }), storage: broken })).toMatchObject({ status: "failed", retryable: true });
    expect(readLiveDraft(PATH, "A", null)).toBeNull();
  });
});

describe("avisos en línea", () => {
  const noop = () => {};
  it("fallo reintentable: texto, «Reintentar» y «Descartar cambios»", () => {
    const html = renderToStaticMarkup(<LiveEditFailure error={SAVE_FAILED_INLINE} retryable onRetry={noop} onDiscard={noop} />);
    expect(html).toContain("No se ha podido guardar. Vuestro texto sigue aquí.");
    expect(html).toContain(">Reintentar<");
    expect(html).toContain(">Descartar cambios<");
  });
  it("fallo no reintentable: sin «Reintentar»", () => {
    const html = renderToStaticMarkup(<LiveEditFailure error="Este texto no puede quedar vacío. Vuestro texto sigue aquí." retryable={false} onRetry={noop} onDiscard={noop} />);
    expect(html).not.toContain("Reintentar");
    expect(html).toContain(">Descartar cambios<");
  });
  it("borrador pendiente: se ofrece recuperarlo", () => {
    const html = renderToStaticMarkup(<LiveEditRecover onRecover={noop} onIgnore={noop} />);
    expect(html).toContain("Hay un texto sin guardar de antes.");
    expect(html).toContain(">Recuperarlo<");
  });
});
