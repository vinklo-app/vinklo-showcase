import { describe, expect, it } from "vitest";

import { PASSWORD_MAX, PASSWORD_MIN, passwordStrength } from "./password-strength";

describe("passwordStrength", () => {
  it("por debajo de 8 caracteres no vale, y lo dice", () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(PASSWORD_MAX).toBe(72);
    expect(passwordStrength("")).toEqual({ score: 0, label: "Mínimo 8 caracteres" });
    expect(passwordStrength("Ab1!xyz").score).toBe(0);
  });

  it("las habituales se quedan en «floja» aunque cumplan la longitud", () => {
    for (const pw of ["12345678", "aaaaaaaa", "password", "Contraseña1", "qwerty12", "nuestraboda"]) {
      expect(passwordStrength(pw).score, pw).toBeLessThanOrEqual(1);
    }
  });

  it("sube con la variedad y la longitud", () => {
    expect(passwordStrength("girasoles").score).toBe(1);
    expect(passwordStrength("girasoles7").score).toBe(2);
    expect(passwordStrength("Girasoles7").score).toBe(3);
    expect(passwordStrength("Girasoles7!").score).toBe(3);
    expect(passwordStrength("Girasoles7!azul").score).toBe(4);
    expect(passwordStrength("girasoles en la finca de julio").score).toBe(4);
  });
});
