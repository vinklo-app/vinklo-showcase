import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

import { isBacklogPath, RSVP_MVP } from "@/lib/product-scope";

export async function middleware(request: NextRequest) {
  if (RSVP_MVP && isBacklogPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = request.nextUrl.pathname.startsWith("/panel") ? "/panel" : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return await updateSession(request);
}

export const config = {
  /*
   * Solo rutas que necesitan sesión (refresco + protección).
   * Quedan fuera a propósito: `/` (landing), `/b/*` (página de invitados),
   * `/v/*` (portal de proveedores), `/guias/*` (contenido público), `/api/webhooks/*` y los assets estáticos.
   */
  matcher: [
    "/precios",
    "/v/:path*",
    "/panel/:path*",
    "/admin/:path*",
    "/onboarding/:path*",
    "/onboarding",
    "/login",
    "/auth/:path*",
    // Invitación de pareja: refresca la sesión para saber quién acepta.
    "/unirse",
  ],
};
