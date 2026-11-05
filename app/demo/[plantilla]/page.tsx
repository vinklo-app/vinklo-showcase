import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { DemoSite, demoPaper } from "@/components/landing/demo-site";
import { BUILDER_TEMPLATES, findBuilderTemplate } from "@/lib/templates";

/** Una ruta estática por plantilla; cualquier otro id es 404 (no se renderiza nada a demanda). */
export const dynamicParams = false;

export function generateStaticParams() {
  return BUILDER_TEMPLATES.map((t) => ({ plantilla: t.id }));
}

type Params = { params: Promise<{ plantilla: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const template = findBuilderTemplate((await params).plantilla);
  if (!template) return {};
  return {
    title: `Web de boda de ejemplo: ${template.name}`,
    description: "Así se ve una web de boda hecha con vinklo: portada, vuestra historia, fotos, programa, detalles, preguntas y confirmación de asistencia.",
    alternates: { canonical: `/demo/${template.id}` },
  };
}

// theme-color = papel de la paleta de la plantilla (sin costura en iOS).
export async function generateViewport({ params }: Params): Promise<Viewport> {
  const template = findBuilderTemplate((await params).plantilla);
  return { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: demoPaper(template?.id) };
}

export default async function DemoTemplatePage({ params }: Params) {
  const template = findBuilderTemplate((await params).plantilla);
  if (!template) notFound();
  return <DemoSite plantilla={template.id} />;
}
