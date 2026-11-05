/**
 * Tarjeta social de una invitación (/b/[slug]) — la que se ve al compartir
 * por WhatsApp. Se sirve versionada por revisión desde
 * /og/invitacion/[slug]/[rev] (revisión de código 2026-10-06, R03).
 *
 * Contrato (dueño, 13-oct-2026): la tarjeta es la invitación, no una tarjeta
 * genérica de vinklo.
 * - Con apertura de sobre: el mismo sobre cerrado que ve el invitado al abrir
 *   el enlace (paleta de la boda, flores en relieve, lacre con las iniciales).
 * - Sin sobre: la foto de portada de la pareja; sin foto, los nombres sobre el
 *   papel de su paleta.
 * Los colores replican sealed-envelope.css (color-mix en oklab) con los mismos
 * valores de `resolvePalette`. Satori no puede usar fuentes del sistema ni
 * pedirlas a Google con los nombres en la URL (H08): todas van empaquetadas en
 * `assets/og` (OFL). La salida se pasa a JPEG con sharp: WhatsApp descarta
 * imágenes pesadas y una foto en PNG supera fácilmente su límite.
 * Lee `getPublicSite` (instantánea publicada), no la fila viva (R-02).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";
import sharp from "sharp";

import { coupleInitials, formatWeddingDate, isOptimizableImage } from "@/components/invitation/format";
import type { PublicSite } from "@/lib/data/site-public";
import { findScene, resolveOpening, resolvePalette, type SitePalette } from "@/lib/site-document";

export const OG_SIZE = { width: 1200, height: 630 };

const SANS = "Plus Jakarta Sans";
const SERIF = "Playfair Display";

// ---------------------------------------------------------------------------
// Color: color-mix(in oklab, a p%, b) como en el CSS del sobre
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, fromLinear(c)))) as Rgb;
}

/** color-mix(in oklab, a weight, b) → #rrggbb. */
export function mixOklab(a: string, weight: number, b: string): string {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  const mixed = oklabToRgb([0, 1, 2].map((i) => A[i]! * weight + B[i]! * (1 - weight)) as Rgb);
  return `#${mixed.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// Recursos
// ---------------------------------------------------------------------------

type FontSpec = { name: string; data: ArrayBuffer; weight: 400 | 600 | 800; style: "normal" | "italic" };

async function loadFonts(): Promise<FontSpec[]> {
  const files: Array<[string, string, FontSpec["weight"], FontSpec["style"]]> = [
    ["jakarta-600.ttf", SANS, 600, "normal"],
    ["jakarta-800.ttf", SANS, 800, "normal"],
    ["playfair-400.ttf", SERIF, 400, "normal"],
    ["playfair-400-italic.ttf", SERIF, 400, "italic"],
  ];
  const loaded = await Promise.all(
    files.map(async ([file, name, weight, style]) => {
      try {
        const buf = await readFile(join(process.cwd(), "assets/og", file));
        return { name, weight, style, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer } satisfies FontSpec;
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((f): f is FontSpec => f !== null);
}

const PHOTO_MAX_BYTES = 12 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 4000;

/**
 * Foto de portada recortada a 1200×630 en JPEG (data URI) o null. Solo del
 * bucket público `wedding-photos`: la URL la escribe la pareja y el servidor
 * no debe pedir direcciones arbitrarias.
 */
async function loadCoverPhoto(url: string): Promise<string | null> {
  if (url.startsWith("/") || !isOptimizableImage(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS), redirect: "error" });
    if (!res.ok) return null;
    const size = Number(res.headers.get("content-length") ?? 0);
    if (size > PHOTO_MAX_BYTES) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.byteLength > PHOTO_MAX_BYTES) return null;
    const jpeg = await sharp(raw).rotate().resize(OG_SIZE.width, OG_SIZE.height, { fit: "cover", position: "attention" }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// El sobre (mismo dibujo que sealed-envelope.css + wax-seal.tsx)
// ---------------------------------------------------------------------------

const ENV_W = 476;
const ENV_H = 340; // 7:5
const SEAL = 118;

/** Flores en relieve del papel del sobre (el patrón de sealed-envelope.css). */
const FLORAL =
  "<path d='M14 104 C30 84 40 70 46 46 M30 82 c-10 -2 -16 -10 -15 -18 c9 1 15 8 15 18Z M38 64 c9 -3 15 -11 14 -19 c-9 2 -14 9 -14 19Z M44 52 c-8 -4 -11 -12 -9 -19 c8 3 11 10 9 19Z'/>" +
  "<g transform='translate(82 30)'><circle r='3'/><ellipse cx='0' cy='-8' rx='4' ry='6'/><ellipse cx='0' cy='-8' rx='4' ry='6' transform='rotate(72)'/><ellipse cx='0' cy='-8' rx='4' ry='6' transform='rotate(144)'/><ellipse cx='0' cy='-8' rx='4' ry='6' transform='rotate(216)'/><ellipse cx='0' cy='-8' rx='4' ry='6' transform='rotate(288)'/></g>" +
  "<path d='M78 112 c4 -10 12 -16 22 -18 M92 98 c-1 -7 3 -12 9 -14 c1 7 -3 12 -9 14Z M100 74 c5 -2 9 0 10 4 c-5 2 -9 0 -10 -4Z'/>";

/**
 * resvg no hereda fill-opacity/stroke-opacity de un <g> dentro de un patrón
 * (las flores salían macizas): se escriben en cada forma.
 */
function paint(shapes: string, color: string, strokeOpacity: number, fillOpacity: number): string {
  return shapes.replace(/<(path|circle|ellipse) /g, `<$1 stroke='${color}' stroke-opacity='${strokeOpacity}' fill='${color}' fill-opacity='${fillOpacity}' `);
}

/** Contorno del lacre (wax-seal.tsx), viewBox 100×100. */
const WAX_OUTLINE =
  "M97.7 50.0 L98.8 54.3 L96.3 58.2 L95.6 62.2 L94.9 66.4 L92.0 69.9 L89.9 73.7 L86.6 76.5 L84.0 79.9 L80.5 82.3 L77.5 85.3 L73.6 86.9 L70.1 89.3 L66.0 90.1 L62.3 91.9 L58.1 91.8 L54.1 92.9 L50.0 92.0 L45.9 92.9 L41.9 91.8 L37.7 91.9 L34.0 90.1 L29.9 89.3 L26.4 86.9 L22.5 85.3 L19.5 82.3 L16.0 79.9 L13.4 76.5 L10.1 73.7 L8.0 69.9 L5.1 66.4 L4.4 62.2 L3.7 58.2 L1.2 54.3 L2.3 50.0 L1.2 45.7 L3.7 41.8 L4.4 37.8 L5.1 33.6 L8.0 30.1 L10.1 26.3 L13.4 23.5 L16.0 20.1 L19.5 17.7 L22.5 14.7 L26.4 13.1 L29.9 10.7 L34.0 9.9 L37.7 8.1 L41.9 8.2 L45.9 7.1 L50.0 8.0 L54.1 7.1 L58.1 8.2 L62.3 8.1 L66.0 9.9 L70.1 10.7 L73.6 13.1 L77.5 14.7 L80.5 17.7 L84.0 20.1 L86.6 23.5 L89.9 26.3 L92.0 30.1 L94.9 33.6 L95.6 37.8 L96.3 41.8 L98.8 45.7 Z";

/** SVG del sobre cerrado con lacre (sin letras: las pinta Satori encima). */
export function envelopeSvg(p: SitePalette, floral: boolean): string {
  const back = mixOklab(p.surface, 0.84, p.ink);
  const pocket = mixOklab(p.surface, 0.92, p.ink);
  const flap = mixOklab(p.surface, 0.78, p.paper);
  const shadow = mixOklab(p.ink, 0.45, p.paper);
  const wax = p.accent;
  const waxLight = mixOklab(p.accent, 0.68, "#ffffff");
  const waxDark = mixOklab(p.accent, 0.72, "#000000");
  const waxWell = mixOklab(p.accent, 0.9, "#000000");
  const waxInk = mixOklab(p.paper, 0.9, p.accent);
  const pad = 40;
  const W = ENV_W + pad * 2;
  const H = ENV_H + pad * 2;
  const tile = 149;
  const k = tile / 120;
  const pattern = floral
    ? `<pattern id='fl' width='${tile}' height='${tile}' patternUnits='userSpaceOnUse'><g transform='scale(${k.toFixed(3)})' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'>` +
      `<g transform='translate(1.4 1.7)'>${paint(FLORAL, "#7d6648", 0.55, 0.1)}</g>` +
      `<g>${paint(FLORAL, "#fffaf2", 0.95, 0.35)}</g></g></pattern>`
    : "";
  const fill = (color: string, shape: string) => `${shape.replace("/>", ` fill='${color}'/>`)}${floral ? shape.replace("/>", " fill='url(#fl)'/>") : ""}`;
  const x0 = pad;
  const y0 = pad;
  const x1 = pad + ENV_W;
  const y1 = pad + ENV_H;
  const cx = pad + ENV_W / 2;
  const pocketPath = `<path d='M${x0} ${y0} L${cx} ${y0 + ENV_H * 0.54} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z'/>`;
  const flapPath = `<path d='M${x0} ${y0} L${x1} ${y0} L${cx} ${y0 + ENV_H * 0.6} Z'/>`;
  const sealX = cx - SEAL / 2;
  const sealY = y0 + ENV_H * 0.6 - SEAL / 2;
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>` +
    `<defs>${pattern}` +
    `<filter id='sh' x='-20%' y='-20%' width='140%' height='160%'><feGaussianBlur stdDeviation='14'/></filter>` +
    `<filter id='ws' x='-30%' y='-30%' width='160%' height='170%'><feGaussianBlur stdDeviation='3.5'/></filter>` +
    `<radialGradient id='wx' cx='38%' cy='32%' r='75%'><stop offset='0' stop-color='${waxLight}'/><stop offset='.45' stop-color='${wax}'/><stop offset='1' stop-color='${waxDark}'/></radialGradient>` +
    `<radialGradient id='wl' cx='50%' cy='45%' r='60%'><stop offset='0' stop-color='${waxWell}'/><stop offset='1' stop-color='${waxDark}'/></radialGradient>` +
    `</defs>` +
    // Sombra del sobre sobre el papel.
    `<rect x='${x0 + 10}' y='${y0 + 22}' width='${ENV_W - 20}' height='${ENV_H - 10}' rx='8' fill='${shadow}' opacity='.55' filter='url(#sh)'/>` +
    fill(back, `<rect x='${x0}' y='${y0}' width='${ENV_W}' height='${ENV_H}' rx='6'/>`) +
    fill(pocket, pocketPath) +
    `<path d='M${x0} ${y0} L${cx} ${y0 + ENV_H * 0.54} L${x1} ${y0}' fill='none' stroke='${p.ink}' stroke-opacity='.14' stroke-width='1.2'/>` +
    fill(flap, flapPath) +
    `<path d='M${x0} ${y0} L${cx} ${y0 + ENV_H * 0.6} L${x1} ${y0}' fill='none' stroke='${p.ink}' stroke-opacity='.18' stroke-width='1.4'/>` +
    // Lacre: sombra, cuerpo, pozo y aro.
    `<g transform='translate(${sealX} ${sealY + 5}) scale(${SEAL / 100})' opacity='.5' filter='url(#ws)'><path d='${WAX_OUTLINE}' fill='${waxDark}'/></g>` +
    `<g transform='translate(${sealX} ${sealY}) scale(${SEAL / 100})'>` +
    `<path d='${WAX_OUTLINE}' fill='url(#wx)'/>` +
    `<circle cx='50' cy='50' r='31' fill='url(#wl)' stroke='${waxDark}' stroke-opacity='.6' stroke-width='2.4'/>` +
    `<circle cx='50' cy='50' r='27.5' fill='none' stroke='${waxInk}' stroke-opacity='.35' stroke-width='.9'/>` +
    `<ellipse cx='36' cy='28' rx='13' ry='6' fill='#fff' opacity='.16' transform='rotate(-24 36 28)'/>` +
    `</g></svg>`
  );
}

// ---------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------

interface CardData {
  name1: string;
  name2: string;
  initials: [string, string];
  date: string | null;
  palette: SitePalette;
}

function Names({ data, size, color, amp }: { data: CardData; size: number; color: string; amp: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "center", gap: size * 0.28, maxWidth: 1080, fontFamily: SERIF, fontSize: size, lineHeight: 1.1, color, letterSpacing: -0.5 }}>
      <span>{data.name1}</span>
      <span style={{ fontStyle: "italic", color: amp }}>&amp;</span>
      <span>{data.name2}</span>
    </div>
  );
}

function EnvelopeCard({ data, floral }: { data: CardData; floral: boolean }) {
  const p = data.palette;
  const svg = envelopeSvg(p, floral);
  const pad = 40;
  const waxInk = mixOklab(p.paper, 0.9, p.accent);
  const nameSize = data.name1.length + data.name2.length > 22 ? 46 : 58;
  // Centro del lacre dentro de la imagen del sobre.
  const sealCx = pad + ENV_W / 2;
  const sealCy = pad + ENV_H * 0.6;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: p.paper,
        backgroundImage: `radial-gradient(120% 80% at 50% 45%, ${p.paper} 40%, ${mixOklab(p.surface, 0.7, p.paper)} 100%)`,
        color: p.ink,
        fontFamily: SANS,
      }}
    >
      <div style={{ display: "flex", fontSize: 17, fontWeight: 600, letterSpacing: 4, textTransform: "uppercase", color: p.accent }}>Tienes una invitación</div>
      <div style={{ display: "flex", position: "relative", width: ENV_W + pad * 2, height: ENV_H + pad * 2, marginTop: -14, marginBottom: -24 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori: solo <img> */}
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} width={ENV_W + pad * 2} height={ENV_H + pad * 2} alt="" />
        <div
          style={{
            position: "absolute",
            left: sealCx - SEAL / 2,
            top: sealCy - SEAL / 2,
            width: SEAL,
            height: SEAL,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: 28,
            color: waxInk,
            letterSpacing: -0.5,
          }}
        >
          {data.initials[0]}
          {data.initials[1] ? <span style={{ fontSize: 20, opacity: 0.9, margin: "0 1px" }}>&amp;</span> : null}
          {data.initials[1]}
        </div>
      </div>
      <Names data={data} size={nameSize} color={p.ink} amp={p.accent} />
      {data.date && <div style={{ display: "flex", marginTop: 12, fontSize: 22, fontWeight: 600, color: mixOklab(p.ink, 0.62, p.paper) }}>{data.date}</div>}
    </div>
  );
}

function PhotoCard({ data, photo }: { data: CardData; photo: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", backgroundColor: data.palette.ink }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori: solo <img> */}
      <img src={photo} width={OG_SIZE.width} height={OG_SIZE.height} alt="" style={{ position: "absolute", left: 0, top: 0 }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 340,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 40,
          backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 45%, rgba(0,0,0,0.66) 100%)",
          fontFamily: SANS,
        }}
      >
        <Names data={data} size={data.name1.length + data.name2.length > 22 ? 50 : 62} color="#ffffff" amp="#ffffff" />
        {data.date && <div style={{ display: "flex", marginTop: 10, fontSize: 22, fontWeight: 600, color: "rgba(255,255,255,0.86)" }}>{data.date}</div>}
      </div>
    </div>
  );
}

function NamesCard({ data, eyebrow }: { data: CardData; eyebrow: string }) {
  const p = data.palette;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, backgroundColor: p.paper, fontFamily: SANS }}>
      <div style={{ position: "absolute", top: 32, left: 32, right: 32, bottom: 32, border: `2px solid ${p.accent}`, borderRadius: 8, display: "flex" }} />
      <div style={{ display: "flex", fontSize: 22, fontWeight: 600, letterSpacing: 8, textTransform: "uppercase", color: p.accent }}>{eyebrow}</div>
      <Names data={data} size={data.name1.length + data.name2.length > 22 ? 64 : 84} color={p.ink} amp={p.accent} />
      {data.date && <div style={{ display: "flex", fontSize: 28, fontWeight: 600, color: mixOklab(p.ink, 0.72, p.paper) }}>{data.date}</div>}
    </div>
  );
}

function BrandCard() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#FAF6F1", color: "#17130F", fontFamily: SANS, fontWeight: 800, fontSize: 72 }}>
      vinklo
    </div>
  );
}

/** Qué tarjeta toca: sobre si la web abre con sobre; si no, foto; si no, nombres. */
export function cardVariant(site: PublicSite | null): "brand" | "envelope" | "photo" | "names" {
  const cover = site ? findScene(site.document, "cover") : undefined;
  if (!site || !cover) return "brand";
  if (resolveOpening(site.document) !== "ninguno") return "envelope";
  return cover.props.image?.url ? "photo" : "names";
}

/**
 * Pinta la tarjeta de una instantánea publicada (R-02: nunca la fila viva;
 * sin sitio → tarjeta genérica de vinklo, sin datos de la pareja).
 */
export async function renderInvitationCard(site: PublicSite | null, headers?: Record<string, string>): Promise<Response> {
  const cover = site ? findScene(site.document, "cover") : undefined;
  let variant = cardVariant(site);
  let node: React.ReactElement = <BrandCard />;

  if (site && cover) {
    const [a, b] = coupleInitials(cover.props.partnerName1, cover.props.partnerName2).split("·");
    const data: CardData = {
      name1: cover.props.partnerName1.trim(),
      name2: cover.props.partnerName2.trim(),
      initials: [a ?? "", b ?? ""],
      date: cover.props.weddingDate ? formatWeddingDate(cover.props.weddingDate) : null,
      palette: resolvePalette(site.document),
    };
    const photo = variant === "photo" && cover.props.image ? await loadCoverPhoto(cover.props.image.url) : null;
    if (variant === "photo" && !photo) variant = "names";
    node =
      variant === "envelope" ? (
        <EnvelopeCard data={data} floral={resolveOpening(site.document) === "sobre"} />
      ) : variant === "photo" && photo ? (
        <PhotoCard data={data} photo={photo} />
      ) : (
        <NamesCard data={data} eyebrow={cover.props.eyebrow || "¡Nos casamos!"} />
      );
  }

  const fonts = await loadFonts();
  const png = new ImageResponse(node, { ...OG_SIZE, fonts: fonts.length ? fonts : undefined });
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 86, chromaSubsampling: "4:4:4" }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(jpeg.byteLength), ...headers },
  });
}
