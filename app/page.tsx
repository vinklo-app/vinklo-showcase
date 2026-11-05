import type { Metadata, Viewport } from "next";

// La landing antes que DeletionNotice: ver el orden de imports en landing-lovable.tsx
// (no reordenar; lo vigila scripts/check-shared-renderer-chunk.mjs en CI).
import { LANDING_FAQS, LandingLovable } from "@/components/landing/landing-lovable";
import { DeletionNotice } from "@/components/landing/deletion-notice";
import {
  faqPageJsonLd,
  JsonLd,
  WEB_APPLICATION_JSONLD,
  WEBSITE_JSONLD,
} from "@/lib/jsonld";

const SITE_URL = "https://vinklo.es";
const title = "Vuestra web de boda y vuestros invitados, sin Excel · vinklo";
const description =
  "Mandad la invitación por WhatsApp y sabed quién viene, quién es alérgico y quién va en autobús según van respondiendo. Después, sentad a cada uno en su mesa. Todo en un solo panel.";

// La landing va sobre perla (v9, 9-oct-2026): la franja del sistema (Dynamic
// Island / notch) toma ese color.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F8F7FA",
};

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  // Versión en inglés en /en (1-nov-2026).
  alternates: { canonical: SITE_URL, languages: { es: SITE_URL, en: `${SITE_URL}/en`, "x-default": SITE_URL } },
  openGraph: {
    title,
    description,
    url: SITE_URL,
    type: "website",
    locale: "es_ES",
    alternateLocale: ["en_GB"],
    siteName: "vinklo",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "vinklo — Gestionad a los invitados de vuestra boda en un solo sitio." }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
};

export default function Home() {
  return (
    <>
      <JsonLd data={WEBSITE_JSONLD} />
      <JsonLd data={WEB_APPLICATION_JSONLD} />
      <JsonLd data={faqPageJsonLd(`${SITE_URL}/#faq`, LANDING_FAQS)} />
      <LandingLovable />
      <DeletionNotice />
    </>
  );
}
