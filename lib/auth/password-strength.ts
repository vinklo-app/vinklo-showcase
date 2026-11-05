/**
 * Reglas de contraseña de vinklo y una pista de fortaleza (solo orientativa).
 *
 * La regla dura es la longitud: mínimo 8 (lo exige también el servidor) y
 * máximo 72, porque Supabase guarda la contraseña con bcrypt y rechaza más.
 * La fortaleza no bloquea nada: solo ayuda a elegir una mejor mientras se
 * escribe. Sin dependencias: se usa en el navegador y en el servidor.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export type PasswordStrength = {
  /** 0 = no vale (corta), 1 floja, 2 aceptable, 3 buena, 4 muy buena. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
};

/** Las que primero se prueban en un ataque: nunca pasan de «floja». */
const COMMON = [
  "password", "contraseña", "contrasena", "qwerty", "123456", "abc123", "iloveyou",
  "teamo", "amor", "boda", "vinklo", "admin", "letmein", "welcome", "bienvenido",
];

function looksCommon(lower: string): boolean {
  if (/^(.)\1+$/.test(lower)) return true; // «aaaaaaaa»
  if (/^\d+$/.test(lower) && "01234567890123456789".includes(lower)) return true; // «12345678»
  return COMMON.some((word) => lower.includes(word) && lower.length - word.length < 4);
}

export function passwordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN) return { score: 0, label: `Mínimo ${PASSWORD_MIN} caracteres` };
  if (looksCommon(password.toLowerCase())) return { score: 1, label: "Floja: es de las primeras que se prueban" };
  const kinds = [/[a-zñ]/, /[A-ZÑ]/, /\d/, /[^A-Za-zÑñ\d]/].filter((re) => re.test(password)).length;
  let points = kinds - 1; // 0–3
  if (password.length >= 12) points += 1;
  if (password.length >= 16) points += 1;
  if (points <= 0) return { score: 1, label: "Floja: mezclad letras, números o símbolos" };
  if (points === 1) return { score: 2, label: "Aceptable" };
  // «Muy buena» solo con longitud: la variedad sola no compensa ser corta.
  if (points === 2 || password.length < 12) return { score: 3, label: "Buena" };
  return { score: 4, label: "Muy buena" };
}
