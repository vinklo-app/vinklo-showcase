import { afterEach, describe, expect, it, vi } from "vitest";

// Sin jsdom en el proyecto: se captura lo que el hook pasa a useSyncExternalStore.
const captured = vi.hoisted(() => ({ args: null as null | [(n: () => void) => () => void, () => boolean, () => boolean] }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useSyncExternalStore: (...args: [(n: () => void) => () => void, () => boolean, () => boolean]) => { captured.args = args; return args[1](); },
}));
import { prefersReducedMotion, useMediaQuery } from "./use-media-query";

type Listener = () => void;
function mockWindow(initial: Record<string, boolean>) {
  const state = { ...initial };
  const listeners = new Map<string, Set<Listener>>();
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      get matches() { return state[query] ?? false; },
      addEventListener: (_: string, cb: Listener) => { (listeners.get(query) ?? listeners.set(query, new Set()).get(query)!).add(cb); },
      removeEventListener: (_: string, cb: Listener) => { listeners.get(query)?.delete(cb); },
    }),
  });
  return {
    set(query: string, value: boolean) { state[query] = value; listeners.get(query)?.forEach((cb) => cb()); },
    count: (query: string) => listeners.get(query)?.size ?? 0,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useMediaQuery", () => {
  it("lee el valor actual, avisa de los cambios y se da de baja", () => {
    const q = "(max-width: 999.98px)";
    const mm = mockWindow({ [q]: true });
    expect(useMediaQuery(q)).toBe(true);
    const [subscribe, getSnapshot] = captured.args!;
    const notify = vi.fn();
    const unsubscribe = subscribe(notify);
    expect(mm.count(q)).toBe(1);
    mm.set(q, false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toBe(false);
    unsubscribe();
    expect(mm.count(q)).toBe(0);
  });
  it("en servidor (y al hidratar) el snapshot es false", () => {
    mockWindow({ "(min-width: 1024px)": true });
    useMediaQuery("(min-width: 1024px)");
    expect(captured.args![2]()).toBe(false);
  });
});

describe("prefersReducedMotion", () => {
  it("refleja la preferencia", () => {
    mockWindow({ "(prefers-reduced-motion: reduce)": true });
    expect(prefersReducedMotion()).toBe(true);
    mockWindow({});
    expect(prefersReducedMotion()).toBe(false);
  });
  it("sin ventana (servidor) es false", () => {
    vi.stubGlobal("window", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
