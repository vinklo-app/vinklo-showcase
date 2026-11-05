import { describe, expect, it } from "vitest";

import { AUTO_FRAME_CAP_MS, autoAdvanceRunning, canAutoAdvance, dragFrame, stepAutoAdvance, type AutoAdvanceGate } from "./story-player";

describe("dragFrame (arrastre de la Story)", () => {
  it("con movimiento normal, la escena sigue al dedo y la vecina asoma desde su lado", () => {
    const f = dragFrame(-100, 400, false);
    expect(f.current.transform).toBe("translateX(-100px)");
    expect(f.neighbour.transform).toBe(`translateX(${400 * 0.18 * 0.75}px)`);
  });

  it("con movimiento reducido no desplaza ninguna escena, solo funde", () => {
    for (const x of [-250, -40, 60, 300]) {
      const f = dragFrame(x, 400, true);
      expect(f.current.transform).toBe("none");
      expect(f.neighbour.transform).toBe("none");
    }
    const f = dragFrame(-200, 400, true);
    expect(f.current.opacity).toBe("0.75");
    expect(f.neighbour.opacity).toBe("0.8");
  });
});

describe("autoavance de la Story: reloj", () => {
  it("acumula el tiempo de los frames y pasa de escena al llegar a la duración", () => {
    let elapsed = 0;
    let advanced = false;
    let frames = 0;
    // 6 s a 60 fps: ~360 frames de 16,67 ms.
    while (!advanced && frames < 1000) {
      const step = stepAutoAdvance(elapsed, 1000 / 60, 6000);
      elapsed = step.elapsed;
      advanced = step.advance;
      frames++;
    }
    expect(advanced).toBe(true);
    expect(frames).toBeGreaterThanOrEqual(360);
    expect(frames).toBeLessThanOrEqual(361);
  });

  it("el progreso va de 0 a 1 y no se pasa", () => {
    expect(stepAutoAdvance(0, 0, 6000)).toEqual({ elapsed: 0, progress: 0, advance: false });
    expect(stepAutoAdvance(2950, 50, 6000).progress).toBeCloseTo(0.5);
    const last = stepAutoAdvance(5990, 50, 6000);
    expect(last).toEqual({ elapsed: 6000, progress: 1, advance: true });
  });

  it("un frame largo (pestaña dormida, tirón) cuenta como mucho el tope: no se salta escena", () => {
    const step = stepAutoAdvance(1000, 60_000, 6000);
    expect(step.elapsed).toBe(1000 + AUTO_FRAME_CAP_MS);
    expect(step.advance).toBe(false);
  });

  it("un dt negativo (reloj raro) no resta tiempo", () => {
    expect(stepAutoAdvance(1000, -500, 6000).elapsed).toBe(1000);
  });

  it("respeta la duración por documento", () => {
    expect(stepAutoAdvance(2950, 60, 3000).advance).toBe(true);
    expect(stepAutoAdvance(2950, 60, 10_000).advance).toBe(false);
  });
});

describe("autoavance de la Story: cuándo corre", () => {
  const base: AutoAdvanceGate = {
    enabled: true, view: "story", hydrated: true, opened: true, hidden: false,
    held: false, hovered: false, focused: false, scrolling: false, paused: false, advanceable: true,
  };

  it("corre con todo a favor", () => {
    expect(autoAdvanceRunning(base)).toBe(true);
  });

  it.each([
    ["sin autoavance (preview del creador o del editor)", { enabled: false }],
    ["en «Ver todos los detalles»", { view: "all" as const }],
    ["antes de hidratar", { hydrated: false }],
    ["con el sobre cerrado o abriéndose", { opened: false }],
    ["con la pestaña oculta", { hidden: true }],
    ["mientras se mantiene pulsado", { held: true }],
    ["con el ratón sobre los controles", { hovered: true }],
    ["con el foco en un control de la escena", { focused: true }],
    ["mientras se desplaza dentro de una escena larga", { scrolling: true }],
    ["en pausa (botón o movimiento reducido)", { paused: true }],
    ["en una escena que no puede avanzar sola", { advanceable: false }],
  ])("se para %s", (_label, patch) => {
    expect(autoAdvanceRunning({ ...base, ...patch })).toBe(false);
  });

  it("al quitar la pausa vuelve a correr (la pausa congela, no cambia nada más)", () => {
    expect(autoAdvanceRunning({ ...base, paused: true })).toBe(false);
    expect(autoAdvanceRunning({ ...base, paused: false })).toBe(true);
  });
});

describe("autoavance de la Story: qué escenas avanzan solas", () => {
  it("se para en la última escena", () => {
    expect(canAutoAdvance(4, 5, "faq", false)).toBe(false);
    expect(canAutoAdvance(3, 5, "faq", false)).toBe(true);
  });

  it("nunca abandona el RSVP ni una escena con formulario", () => {
    expect(canAutoAdvance(2, 6, "rsvp", false)).toBe(false);
    expect(canAutoAdvance(2, 6, "extra", true)).toBe(false);
  });

  it("una Story de una sola escena no avanza", () => {
    expect(canAutoAdvance(0, 1, "cover", false)).toBe(false);
  });
});
