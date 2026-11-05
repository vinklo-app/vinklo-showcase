/**
 * OG de la home (se genera en build: sin parámetros, es estática).
 * Bodegón (6-oct-2026, referencia: la tarjeta de cordially.io en WhatsApp):
 * un portátil con la invitación real en pantalla y, alrededor, «Reservad la
 * fecha», menú, tarjeta de asistencia y el móvil con la invitación. Marca v9
 * «Ciruela y perla» (9-oct-2026): fondo perla, tarjetas blancas, ciruela en
 * la marca y la acción, una curva de marca al fondo; sin sobre ni lacre.
 * Todo dibujado aquí (sin fotos de stock) más la foto a contraluz del hero.
 * Las fuentes son subconjuntos TTF de Google Fonts (OFL) guardados en
 * `assets/og/` con solo los glifos de esta tarjeta: si se cambia el copy,
 * regeneradlos con el parámetro `text=` de fonts.googleapis.com/css2.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CSSProperties, ReactNode } from "react";

import { ImageResponse } from "next/og";
import sharp from "sharp";

export const alt = "vinklo · Vuestra web de boda, los detalles bajo control";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#24212A";
const MUTED = "#655E6B";
const CIRUELA = "#573B62";
const PERLA = "#F8F7FA";
const PERLA_2 = "#ECE7F0";
const SEPARADOR = "#DCD4E1";
const DEVICE = "#2E2335";
const CARD = "#FFFFFF";
const ON_PHOTO = "#F8F7FA";

async function font(file: string) {
  return readFile(join(process.cwd(), "assets/og", file));
}

/** La foto del hero (WebP) en JPEG: Satori no lee WebP. */
async function photo(width: number, height: number): Promise<string> {
  const jpeg = await sharp(join(process.cwd(), "public/landing/portada-contraluz.webp"))
    .resize({ width, height, fit: "cover", position: "centre" })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

const shadow = "0 18px 30px -14px rgba(36, 33, 42, 0.35), 0 2px 4px rgba(36, 33, 42, 0.08)";

/** Tarjeta de papel girada, posicionada en el lienzo. */
function Paper({ x, y, w, h, rotate, children, bg = CARD, style }: { x: number; y: number; w: number; h: number; rotate: number; children?: ReactNode; bg?: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        borderRadius: 12,
        boxShadow: shadow,
        transform: `rotate(${rotate}deg)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default async function Image() {
  const [serif, serifItalic, sans, sansBold, screen, phoneShot] = await Promise.all([
    font("playfair-400.ttf"),
    font("playfair-400-italic.ttf"),
    font("jakarta-600.ttf"),
    font("jakarta-700.ttf"),
    photo(560, 330),
    photo(150, 300),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: PERLA,
          fontFamily: "Jakarta",
          color: INK,
        }}
      >
        {/* Curva de marca (abajo izquierda, recortada por el borde) */}
        <svg width={600} height={315} viewBox="0 0 800 420" style={{ position: "absolute", left: -180, top: 400 }}>
          <path d="M-40 400C120 120 330 30 520 70c150 32 250 140 320 300" fill="none" stroke={SEPARADOR} strokeWidth={3} strokeLinecap="round" />
          <path d="M-40 430C140 170 340 90 530 126c140 26 236 120 306 260" fill="none" stroke={SEPARADOR} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
        </svg>

        {/* Reservad la fecha (arriba izquierda) */}
        <Paper x={70} y={38} w={210} h={150} rotate={-9}>
          <span style={{ fontSize: 11, letterSpacing: 3, color: CIRUELA }}>RESERVAD LA FECHA</span>
          <span style={{ fontFamily: "Playfair", fontSize: 30, marginTop: 8 }}>Lucía & Juan</span>
          <span style={{ fontSize: 12, letterSpacing: 2, color: MUTED, marginTop: 8 }}>12 · 06 · 2027</span>
        </Paper>

        {/* Menú (derecha arriba) */}
        <Paper x={925} y={40} w={170} h={235} rotate={6}>
          <span style={{ fontFamily: "PlayfairItalic", fontSize: 34, color: INK }}>Menú</span>
          <div style={{ width: 40, height: 1, background: SEPARADOR, marginTop: 10, marginBottom: 10 }} />
          <span style={{ fontFamily: "Playfair", fontSize: 17, color: MUTED }}>Cóctel</span>
          <span style={{ fontFamily: "Playfair", fontSize: 17, color: MUTED, marginTop: 6 }}>Banquete</span>
        </Paper>

        {/* Tarjeta de asistencia (abajo derecha, tinte perla-2 y acción en ciruela) */}
        <Paper x={935} y={405} w={230} h={150} rotate={-5} bg={PERLA_2}>
          <span style={{ fontFamily: "PlayfairItalic", fontSize: 28, color: INK }}>¿Nos acompañas?</span>
          <div style={{ display: "flex", marginTop: 14, padding: "8px 16px", borderRadius: 10, background: CIRUELA, color: "#FFFFFF", fontFamily: "JakartaBold", fontSize: 13 }}>
            Confirmar asistencia
          </div>
        </Paper>

        {/* Portátil con la invitación */}
        <div style={{ position: "absolute", left: 300, top: 95, width: 600, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 580, height: 360, display: "flex", padding: 12, borderRadius: 18, background: DEVICE, boxShadow: "0 30px 50px -18px rgba(36, 33, 42, 0.5)" }}>
            <div style={{ position: "relative", width: 556, height: 336, display: "flex", borderRadius: 6, overflow: "hidden" }}>
              <img src={screen} alt="" width={556} height={336} style={{ position: "absolute", left: 0, top: 0, width: 556, height: 336 }} />
              <div style={{ position: "absolute", left: 0, top: 0, width: 556, height: 336, display: "flex", background: "linear-gradient(180deg, rgba(20,14,10,0.15) 0%, rgba(20,14,10,0.05) 40%, rgba(20,14,10,0.7) 100%)" }} />
              <div style={{ position: "absolute", left: 0, top: 0, width: 556, height: 336, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 34, color: ON_PHOTO }}>
                <span style={{ fontSize: 12, letterSpacing: 4 }}>¡NOS CASAMOS!</span>
                <span style={{ fontFamily: "Playfair", fontSize: 64, lineHeight: 1, marginTop: 10, letterSpacing: -1 }}>Lucía & Juan</span>
                <span style={{ fontFamily: "Playfair", fontSize: 18, marginTop: 10 }}>sábado, 12 de junio de 2027</span>
              </div>
            </div>
          </div>
          <div style={{ width: 640, height: 16, display: "flex", borderRadius: "0 0 14px 14px", background: "linear-gradient(180deg, #D9D3DE, #ADA4B4)", boxShadow: "0 14px 20px -10px rgba(36, 33, 42, 0.4)" }} />
        </div>

        {/* Móvil con la invitación (delante, a la derecha del portátil) */}
        <div style={{ position: "absolute", left: 790, top: 255, width: 150, height: 300, display: "flex", padding: 6, borderRadius: 26, background: DEVICE, boxShadow: "0 24px 36px -14px rgba(36, 33, 42, 0.55)", transform: "rotate(5deg)" }}>
          <div style={{ position: "relative", width: 138, height: 288, display: "flex", borderRadius: 21, overflow: "hidden" }}>
            <img src={phoneShot} alt="" width={138} height={288} style={{ position: "absolute", left: 0, top: 0, width: 138, height: 288 }} />
            <div style={{ position: "absolute", left: 0, top: 0, width: 138, height: 288, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "0 12px 26px", background: "linear-gradient(180deg, rgba(20,14,10,0) 35%, rgba(20,14,10,0.75) 100%)", color: ON_PHOTO }}>
              <span style={{ fontFamily: "Playfair", fontSize: 24, lineHeight: 1 }}>Lucía</span>
              <span style={{ fontFamily: "Playfair", fontSize: 24, lineHeight: 1 }}>& Juan</span>
            </div>
          </div>
        </div>

        {/* Marca discreta (abajo centro) */}
        <div style={{ position: "absolute", left: 0, top: 585, width: 1200, display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <path d="M3 5.5 12 20l9-14.5" stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={12} cy={3.2} r={1.6} fill={CIRUELA} />
          </svg>
          <div style={{ display: "flex", fontFamily: "JakartaBold", fontSize: 22, letterSpacing: -0.4 }}>
            <span>v</span>
            <span style={{ color: CIRUELA }}>ı</span>
            <span>nklo</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Playfair", data: serif, weight: 400, style: "normal" },
        { name: "PlayfairItalic", data: serifItalic, weight: 400, style: "italic" },
        { name: "Jakarta", data: sans, weight: 600, style: "normal" },
        { name: "JakartaBold", data: sansBold, weight: 700, style: "normal" },
      ],
    },
  );
}
