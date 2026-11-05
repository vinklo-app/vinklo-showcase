import { describe, expect, it } from "vitest";

import { clearPendingCode, PENDING_CODE_KEY, PENDING_CODE_TTL_MS, readPendingCode, savePendingCode } from "./pending-code";

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

describe("código pendiente (volver al paso del código tras leer el correo)", () => {
  it("recuerda el correo mientras el código sigue vigente", () => {
    const s = memory();
    savePendingCode(s, "ana@ejemplo.es", 1_000);
    expect(readPendingCode(s, 1_000 + 60_000)).toBe("ana@ejemplo.es");
    expect(readPendingCode(s, 1_000 + PENDING_CODE_TTL_MS + 1)).toBeNull();
  });

  it("se borra, y tolera datos corruptos o almacenamiento bloqueado", () => {
    const s = memory();
    savePendingCode(s, "ana@ejemplo.es", 1_000);
    clearPendingCode(s);
    expect(readPendingCode(s, 2_000)).toBeNull();
    s.setItem(PENDING_CODE_KEY, "{no json");
    expect(readPendingCode(s, 2_000)).toBeNull();
    s.setItem(PENDING_CODE_KEY, JSON.stringify({ email: "sin-arroba", sentAt: 1_000 }));
    expect(readPendingCode(s, 2_000)).toBeNull();
    const blocked = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(() => savePendingCode(blocked, "ana@ejemplo.es")).not.toThrow();
    expect(readPendingCode(blocked)).toBeNull();
    expect(() => clearPendingCode(blocked)).not.toThrow();
    expect(readPendingCode(undefined)).toBeNull();
  });
});
