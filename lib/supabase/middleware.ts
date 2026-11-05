import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { PANEL_MANIFEST_PATH } from "@/lib/pwa/panel-manifest";

const PROTECTED_PREFIXES = ["/panel", "/onboarding"];

export async function updateSession(request: NextRequest) {
  // El manifest del panel es público y el navegador lo pide SIN cookies:
  // si se redirigiera a /login, el icono de la pantalla de inicio no
  // abriría el panel ni Chrome ofrecería instalarlo. Solo esta ruta exacta.
  if (request.nextUrl.pathname === PANEL_MANIFEST_PATH) return NextResponse.next();

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANTE: no ejecutar código entre createServerClient y
  // supabase.auth.getUser() — un fallo aquí puede cerrar sesiones al azar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  // IMPORTANTE: devolver siempre supabaseResponse tal cual (o copiar sus
  // cookies a cualquier respuesta nueva) para no desincronizar la sesión.
  supabaseResponse.headers.set("Cache-Control", "private, no-store");
  return supabaseResponse;
}
