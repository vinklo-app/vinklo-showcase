import { getPublicSite } from "@/lib/data/site-public";
import { renderInvitationCard } from "@/lib/og/invitation-card";

/**
 * Tarjeta social versionada de una invitación (revisión de código
 * 2026-10-06, R03). La URL lleva la revisión publicada: cada publicación
 * cambia la dirección y la CDN y WhatsApp piden la nueva sin purgas. Una
 * web retirada (o una revisión que ya no es la publicada) no tiene tarjeta.
 * Vive fuera de /b/ para no heredar su `no-store` (ver next.config.ts).
 */
export const dynamic = "force-dynamic";

const LEGACY = "legado";
const SLUG_RE = /^[a-z0-9-]{3,60}$/;
const REV_RE = /^[a-z0-9-]{1,64}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; rev: string }> }) {
  const { slug, rev } = await params;
  if (!SLUG_RE.test(slug) || !REV_RE.test(rev)) return new Response("Not found", { status: 404 });
  const site = await getPublicSite(slug);
  const current = site ? site.revisionId ?? LEGACY : null;
  if (!site || current !== rev) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }
  // Caché corta a propósito: al retirar la web, una URL ya cacheada no debe
  // seguir enseñando nombres y fecha más de una hora. La URL cambia en cada
  // publicación, así que la frescura no depende de esta caché.
  const cache = "public, max-age=3600, s-maxage=3600";
  return renderInvitationCard(site, { "Cache-Control": cache, "X-Robots-Tag": "noindex" });
}

