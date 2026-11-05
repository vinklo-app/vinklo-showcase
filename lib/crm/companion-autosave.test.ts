import { describe, expect, it, vi } from "vitest";
import { companionDraftKey, reconcileCompanionSave, singleFlightSave, type CompanionDraft } from "./companion-autosave";

const row: CompanionDraft = { key: "new", name: "Pedro", kid: false, byGuest: false, away: false };
describe("guardar acompañantes sin perder el último cambio", () => {
  it("cerrar antes del debounce puede forzar la escritura y esperar al servidor", async () => {
    let finish!: (ok: boolean) => void;
    const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const flush = singleFlightSave(save);
    const first = flush(); const close = flush();
    expect(close).toBe(first);
    await Promise.resolve(); expect(save).toHaveBeenCalledTimes(1);
    finish(true); expect(await close).toBe(true);
  });
  it("la respuesta antigua asigna el id nuevo sin pisar Pedrito ni resucitar filas borradas", () => {
    const stored = [{ id: "server-id", name: "Pedro", isKid: false, byGuest: false, tableId: null }];
    const newer = reconcileCompanionSave([row], [{ ...row, name: "Pedrito" }], stored);
    expect(newer).toEqual([{ ...row, id: "server-id", name: "Pedrito" }]);
    expect(reconcileCompanionSave([row], [], stored)).toEqual([]);
    expect(companionDraftKey(newer)).not.toBe(companionDraftKey([{ ...row, id: "server-id" }]));
  });
  it("un fallo mantiene el borrador disponible para reintentar", async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const flush = singleFlightSave(save);
    expect(await flush()).toBe(false); expect(await flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
