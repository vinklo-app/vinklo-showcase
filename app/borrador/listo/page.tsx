import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreatedNotice } from "@/components/creator/created-notice";
import { publicWeddingUrl } from "@/lib/invitation-sharing";
import "@/components/panel/wedding-builder.css";

export const metadata: Metadata = { title: "Borrador · web creada", robots: { index: false, follow: false } };

/**
 * Preview de `/onboarding/listo` — SOLO en desarrollo (404 en producción),
 * sin sesión ni boda: los mismos parámetros que la página real.
 *   (sin parámetros)        todo bien: «¡Vuestra web ya está publicada!»
 *   ?foto=size|type|…       publicada sin la foto de portada
 *   ?fotos=1-6              publicada sin alguna foto de la galería
 *   ?web=failed             publicada con el estilo base
 *   ?web=live               sin publicar (el enlace ya la abre, sin foto ni colores)
 *   ?web=withdrawn          retirada (el enlace no se abre)
 */
const PHOTO_REASONS: Record<string, string> = {
  size: "la foto pesa demasiado (una vez reducida, el máximo son 4 MB)",
  generic: "la subida no se completó",
};

export default async function BorradorListoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const photo = typeof params.foto === "string" ? PHOTO_REASONS[params.foto] ?? PHOTO_REASONS.generic : undefined;
  const web = params.web === "live" || params.web === "withdrawn" || params.web === "failed" ? params.web : params.web === "draft" ? "live" : undefined;
  const gallery = typeof params.fotos === "string" && /^[1-6]$/.test(params.fotos) ? Number(params.fotos) : undefined;
  return <CreatedNotice photo={photo} web={web} gallery={gallery} publicUrl={web === "withdrawn" ? null : publicWeddingUrl("ana-y-pablo", "https://vinklo.es")} />;
}
