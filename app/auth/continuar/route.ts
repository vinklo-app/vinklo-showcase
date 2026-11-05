import { NextResponse } from "next/server";

import { postLoginPath } from "@/lib/auth/post-login";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino de /auth/confirm tras verificar el enlace mágico (allí todo es
 * cliente y la cookie de /unirse es httpOnly): decide en servidor entre
 * /unirse, /panel y /onboarding. Sin sesión, a /login.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  const destination = await postLoginPath(supabase);
  const response = NextResponse.redirect(`${origin}${destination}`);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
