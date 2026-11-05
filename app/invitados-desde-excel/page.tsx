import "@/components/landing/landing-lovable.css";
import "@/components/landing/landing-cordially.css";
import "@/components/landing/landing-excel.css";

import type { Metadata, Viewport } from "next";

import { LandingExcel } from "@/components/landing/landing-excel";

const PAGE_URL = "https://vinklo.es/invitados-desde-excel";
const title = "Del Excel de invitados a WhatsApp, sin copiar y pegar · vinklo";
const description =
  "Subid el Excel de vuestros invitados tal cual, revisad cómo lo hemos leído y preparad el mensaje de cada uno con su enlace personal, listo para abrirlo en WhatsApp.";

// Sobre perla, como la landing: la franja del sistema toma ese color.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F8F7FA",
};

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title,
    description,
    url: PAGE_URL,
    type: "website",
    locale: "es_ES",
    siteName: "vinklo",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "vinklo — Gestionad a los invitados de vuestra boda en un solo sitio." }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
};

/** Punto 17 del dueño: la landing en «vídeo» del camino Excel → lista → WhatsApp. */
export default function InvitadosDesdeExcelPage() {
  return <LandingExcel />;
}
