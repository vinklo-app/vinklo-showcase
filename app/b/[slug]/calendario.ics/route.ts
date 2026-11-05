import { calendarEventFromDocument } from "@/components/invitation/calendar-event";
import { buildWeddingIcs, icsFileName } from "@/components/invitation/format";
import { getPublicSiteResult } from "@/lib/data/site-public";

/**
 * «Añadir al calendario» (ítem 13): el .ics servido como archivo real
 * (text/calendar, inline). Los navegadores integrados de WhatsApp e
 * Instagram ignoran los enlaces `data:` con `download`; con una URL normal
 * el teléfono abre su hoja de «Añadir evento».
 *
 * Misma visibilidad que la página: solo lo publicado (getPublicSiteResult);
 * web retirada o inexistente → 404, fallo de lectura → 503. Nunca lleva el
 * enlace personal del invitado: la URL del evento es la general.
 */
export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{3,60}$/;
const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return new Response("Not found", { status: 404, headers: NO_STORE });
  const result = await getPublicSiteResult(slug);
  if (result.status === "unavailable") return new Response("Unavailable", { status: 503, headers: { ...NO_STORE, "Retry-After": "30" } });
  if (result.status !== "ok") return new Response("Not found", { status: 404, headers: NO_STORE });
  const event = calendarEventFromDocument(result.site.document);
  const ics = event ? buildWeddingIcs({ ...event, url: `${new URL(request.url).origin}/b/${result.site.slug}`, stamp: new Date() }) : null;
  if (!event || !ics) return new Response("Not found", { status: 404, headers: NO_STORE });
  return new Response(ics, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${icsFileName(event.partnerName1, event.partnerName2)}"`,
    },
  });
}
