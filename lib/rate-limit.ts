import "server-only";

import { createHmac } from "node:crypto";
import { isIPv6 } from "node:net";
import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rate limiting de acciones anónimas sobre Postgres (función rl_check).
 *
 * Fail-closed: una escritura anónima requiere autorización positiva.
 * Las claves se hashean (HMAC) para no persistir IPs/tokens en rate_limit_hits.
 */

/**
 * HMAC-SHA256 con secreto de servidor: un SHA-256 plano de una IP se invierte
 * por fuerza bruta (solo hay 2^32 IPv4). Conviene definir RATE_LIMIT_SECRET en
 * producción; si falta, se usa CRON_SECRET y, en último caso, clave vacía
 * (sigue siendo HMAC, pero sin secreto).
 */
export function keyedHash(value: string): string {
  const secret = process.env.RATE_LIMIT_SECRET ?? process.env.CRON_SECRET ?? "";
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** IPv6 → su /64 (los 4 primeros grupos): un cliente rota a voluntad los 64 bits bajos. IPv4 y otros textos, intactos. */
export function normalizeIp(raw: string): string {
  const ip = raw.trim().split("%")[0]!;
  if (!isIPv6(ip)) return ip;
  // ::ffff:1.2.3.4 es una IPv4 envuelta: se trata como IPv4.
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1]!;
  let text = ip.toLowerCase();
  // IPv4 incrustada al final → dos grupos hex, para poder expandir.
  const v4 = text.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b, c, d] = [v4[2], v4[3], v4[4], v4[5]].map(Number) as [number, number, number, number];
    text = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0");
  const groups = [...headGroups, ...fill, ...tailGroups].slice(0, 4);
  return `${groups.map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * IP del cliente detrás del proxy de Vercel. x-vercel-forwarded-for la pone
 * Vercel y el cliente no puede falsearla; x-forwarded-for sí admite entradas
 * del cliente, por eso va la última.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const vercel = h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return normalizeIp(vercel);
  const real = h.get("x-real-ip")?.trim();
  if (real) return normalizeIp(real);
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd ? normalizeIp(fwd) : "unknown";
}

/**
 * true si la acción se permite; false si supera el límite en la ventana.
 * @param action  etiqueta corta ("rsvp", "contribute", "waitlist")
 * @param id      identificador (normalmente la IP, opcionalmente + slug)
 * @param max     nº máximo de acciones permitidas en la ventana
 * @param windowSecs  tamaño de la ventana en segundos
 */
export async function rateLimit(
  action: string,
  id: string,
  max: number,
  windowSecs: number,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rl_check", {
      p_key: `${action}:${keyedHash(id)}`,
      p_max: max,
      p_window_secs: windowSecs,
    });
    if (error) {
      console.warn("[rate-limit] unavailable", error.code);
      return false;
    }
    return data === true;
  } catch {
    console.warn("[rate-limit] unavailable");
    return false;
  }
}
