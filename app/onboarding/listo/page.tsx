import { redirect } from "next/navigation";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { CreatedNotice, listoWebState } from "@/components/creator/created-notice";
import { publicWeddingUrl } from "@/lib/invitation-sharing";
import { siteVisibility } from "@/components/panel/site-visibility";
import "@/components/panel/wedding-builder.css";

export const metadata = { title: "Vuestra web" };

/**
 * Destino del creador SIEMPRE tras crear la boda (revisión UX, ítem 8). Sin
 * motivos en la URL, todo salió: se celebra con el enlace público. Con
 * motivos (subir la foto, guardar los colores/cambios o publicar), se explica
 * qué falló y dónde arreglarlo. Los motivos llegan como códigos fijos; nunca
 * se pinta texto libre de la URL.
 */
const PHOTO_REASONS: Record<string, string> = {
  size: "la foto pesa demasiado (una vez reducida, el máximo son 4 MB)",
  type: "el archivo no es una foto JPG, PNG o WebP válida",
  dimensions: "la foto es demasiado grande (como máximo 10 000 píxeles por lado)",
  rate: "se han subido muchas fotos seguidas",
  session: "la sesión caducó durante la subida",
  generic: "la subida no se completó",
};

export default async function CreatedNoticePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getCurrentWedding();
  if (!context) redirect("/onboarding");

  const params = await searchParams;
  const photo = typeof params.foto === "string" ? PHOTO_REASONS[params.foto] : undefined;
  const webParam = params.web === "draft" || params.web === "failed" ? params.web : undefined;
  // Fotos de la galería que no subieron: solo 1–6 (nunca texto libre).
  const gallery = typeof params.fotos === "string" && /^[1-6]$/.test(params.fotos) ? Number(params.fotos) : undefined;

  // Estado real de la web con la misma regla que Ajustes, el editor y el
  // panel (siteVisibility): publicada, en vivo (la sirve el adaptador) o
  // retirada. Si no se puede leer, se fía de lo que dijo el creador.
  const { data: site, error } = await context.supabase.from("wedding_sites").select("published_revision_id, published_at").eq("wedding_id", context.wedding.id).maybeSingle();
  const row = site as { published_revision_id: string | null; published_at: string | null } | null;
  const visibility = error ? null : siteVisibility(row ? { publishedRevisionId: row.published_revision_id, publishedAt: row.published_at } : null);
  const web = listoWebState(webParam, visibility);

  return <CreatedNotice photo={photo} web={web} gallery={gallery} publicUrl={web === "withdrawn" ? null : publicWeddingUrl(context.wedding.slug)} />;
}
