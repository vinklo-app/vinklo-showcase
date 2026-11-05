import type { Metadata } from "next";
import { cookies } from "next/headers";

import { JoinView } from "@/components/panel/join-view";
import { JOIN_COOKIE, JOIN_TOKEN_RE } from "@/lib/partner/join";
import { createClient } from "@/lib/supabase/server";
import "@/app/login/access.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Únete a vuestra boda",
  robots: { index: false, follow: false },
  // El token va en la URL: que no viaje como Referer a ningún enlace externo.
  referrer: "no-referrer",
};

/**
 * Enlace de invitación a la segunda cuenta de pareja (`/unirse?token=…`).
 * Nunca muestra datos de la boda: sin sesión pide entrar (el token se guarda
 * en una cookie httpOnly y /auth/continuar devuelve aquí tras el enlace
 * mágico); con sesión, aceptar es un botón (POST de server action, no un GET
 * que pueda dispararse solo).
 */
export default async function UnirsePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const fromUrl = typeof params.token === "string" && JOIN_TOKEN_RE.test(params.token) ? params.token : null;
  const fromCookie = (await cookies()).get(JOIN_COOKIE)?.value ?? null;
  const token = fromUrl ?? (fromCookie && JOIN_TOKEN_RE.test(fromCookie) ? fromCookie : null);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return <JoinView token={token} email={user ? user.email ?? null : undefined} />;
}
