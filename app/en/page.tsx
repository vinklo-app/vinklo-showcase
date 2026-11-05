import type { Metadata, Viewport } from "next";

// La landing primero, como en app/page.tsx: ver el orden de imports en
// landing-lovable.tsx (no reordenar).
import { LandingLovable } from "@/components/landing/landing-lovable";
import { landingCopy } from "@/components/landing/copy";
import { faqPageJsonLd, JsonLd } from "@/lib/jsonld";

/**
 * Landing en inglés (1-nov-2026): la misma página que / con los textos de
 * copy/en.ts. El creador, el panel y la invitación siguen en español; la
 * página lo dice (hero, última pregunta y pie). Sin DeletionNotice: tras
 * borrar la boda, el panel (en español) vuelve a /.
 */
const SITE_URL = "https://vinklo.es";
const URL = `${SITE_URL}/en`;
const title = "Your wedding website and your guests, without spreadsheets · vinklo";
const description =
  "Send the invitation on WhatsApp and see who’s coming, who has allergies and who’s taking the coach as replies come in. Then seat everyone at their table. All in one dashboard.";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F8F7FA",
};

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: URL, languages: { es: SITE_URL, en: URL, "x-default": SITE_URL } },
  openGraph: {
    title,
    description,
    url: URL,
    type: "website",
    locale: "en_GB",
    alternateLocale: ["es_ES"],
    siteName: "vinklo",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "vinklo — Manage your wedding guests in one place." }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
};

export default function HomeEn() {
  return (
    <>
      <JsonLd data={faqPageJsonLd(`${URL}#faq`, landingCopy("en").faq.items, "en")} />
      <LandingLovable locale="en" />
    </>
  );
}
