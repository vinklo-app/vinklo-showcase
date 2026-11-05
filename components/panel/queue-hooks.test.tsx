import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useIssuedLinks } from "./queue-hooks";

describe("un enlace por persona mientras no se confirme (revisión T2 #2)", () => {
  it("mirar el mensaje y cancelar no crea otro enlace; tras confirmar, sí", async () => {
    const calls: string[] = [];
    const createLink = async (id: string) => { calls.push(id); return { ok: true as const, path: `/b/x?invitacion=${id}-${calls.length}` }; };
    let links: ReturnType<typeof useIssuedLinks> | null = null;
    function Probe() { links = useIssuedLinks(createLink); return null; }
    renderToStaticMarkup(<Probe />);
    const api = links!;
    const first = await api.get("a");
    const again = await api.get("a");
    expect(again).toEqual(first);
    expect(calls).toEqual(["a"]);
    await api.get("b");
    expect(calls).toEqual(["a", "b"]);
    api.forget("a");
    const fresh = await api.get("a");
    expect(fresh).not.toEqual(first);
    expect(calls).toEqual(["a", "b", "a"]);
  });
  it("si crear el enlace falla, el siguiente intento lo vuelve a pedir", async () => {
    let n = 0;
    const createLink = async () => (++n === 1 ? { ok: false as const, error: "x" } : { ok: true as const, path: "/b/x" });
    let links: ReturnType<typeof useIssuedLinks> | null = null;
    function Probe() { links = useIssuedLinks(createLink); return null; }
    renderToStaticMarkup(<Probe />);
    expect((await links!.get("a")).ok).toBe(false);
    expect((await links!.get("a")).ok).toBe(true);
    expect(n).toBe(2);
  });
});
