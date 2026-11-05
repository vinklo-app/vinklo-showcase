import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { JsonLd, ORGANIZATION_JSONLD } from "@/lib/jsonld";

// Identidad v9 «Ciruela y perla» (2026-10-09, DESIGN.md): se conserva el par
// Playfair Display (titulares; cursivas moderadas) +
// Plus Jakarta Sans (cuerpo, UI y wordmark 700), y se añade JetBrains Mono
// para las etiquetas editoriales ("Nº 01 — EL SOBRE", "ESPAÑA · 2026").
// globals.css apunta --font-display y --font-script a la serif y
// --font-mono a la mono.
//
// Fuentes propias (app/fonts, OFL): variables, recortadas a los pesos usados
// y a latín + latín extendido (incluye la ı sin punto del wordmark). Antes
// eran next/font/google: cada build las descargaba de Google y a veces
// fallaba («next/font/google queries have exactly one entry»).
// Playfair: una sola familia con normal y cursiva (next/font ignora un
// font-family propio en `declarations`: con dos familias separadas los
// titulares caían a Georgia). La normal es la del LCP; la cursiva solo se
// descarga si la página la usa (el navegador la pide al pintarla).
const playfair = localFont({
  variable: "--font-serif-face",
  src: [
    { path: "./fonts/playfair-display.woff2", weight: "400 600", style: "normal" },
    { path: "./fonts/playfair-display-italic.woff2", weight: "400 600", style: "italic" },
  ],
  display: "swap",
});

const jakarta = localFont({
  variable: "--font-sans",
  src: "./fonts/plus-jakarta-sans.woff2",
  weight: "500 800",
  display: "swap",
  fallback: ["Helvetica Neue", "Arial", "sans-serif"],
});

// Caligrafía de la plantilla «Hora dorada» (estilo Clásico de las webs de
// boda, 6-oct-2026): Pinyon Script (OFL), solo latín (incluye á é í ó ú ñ).
const pinyon = localFont({
  variable: "--font-calligraphy",
  src: "./fonts/pinyon-script.woff2",
  weight: "400",
  display: "swap",
  preload: false,
  fallback: ["Snell Roundhand", "Apple Chancery", "cursive"],
});

const jetbrains = localFont({
  variable: "--font-jetbrains",
  src: "./fonts/jetbrains-mono.woff2",
  weight: "400 500",
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

// viewport-fit=cover: el contenido llega a los bordes (bajo la Dynamic
// Island / notch); el padding con env(safe-area-inset-*) de globals.css lo
// compensa en modo standalone. themeColor = perla de la marca v9.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F8F7FA",
};

// Título y descripción por defecto = posicionamiento del hero (P2-1); las
// páginas sin metadata propia los heredan.
const DEFAULT_TITLE = "vinklo · Vuestra web de boda, los detalles bajo control";
const DEFAULT_DESCRIPTION =
  "Cread vuestra invitación, compartidla por WhatsApp y organizad respuestas, acompañantes y mesas desde vuestro panel.";

export const metadata: Metadata = {
  metadataBase: new URL("https://vinklo.es"),
  alternates: { canonical: "./" },
  manifest: "/manifest.webmanifest",
  // iOS: abre como app a pantalla completa desde la pantalla de inicio.
  // La barra de estado translúcida deja ver el lienzo blanco; el título es
  // el nombre corto bajo el icono.
  appleWebApp: {
    capable: true,
    title: "vinklo",
    statusBarStyle: "black-translucent",
  },
  // Next 15 emite `mobile-web-app-capable` (estándar nuevo); añadimos la
  // variante `apple-` que iOS más antiguo aún lee, por compatibilidad.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  title: {
    default: DEFAULT_TITLE,
    template: "%s · vinklo",
  },
  description: DEFAULT_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "vinklo",
    locale: "es_ES",
    url: "https://vinklo.es",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: DEFAULT_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${jakarta.variable} ${playfair.variable} ${jetbrains.variable} ${pinyon.variable}`}
    >
      <body className="antialiased">
        <JsonLd data={ORGANIZATION_JSONLD} />
        {children}
      </body>
    </html>
  );
}
