"use client";

/**
 * Apertura «sobre» (`document.opening === "sobre"`): antes de la portada el
 * invitado ve un sobre lacrado con las iniciales y lo abre con un toque.
 *
 * - Va dentro del renderer: hereda la paleta de la pareja (--papel, --tinta,
 *   --cava, --rubor) sin colores propios.
 * - El contenido se pinta en el servidor debajo (inert mientras está
 *   cerrado). Sin JavaScript el sobre no se muestra (<noscript>), así que
 *   nadie se queda bloqueado.
 * - Público: abierto una vez, no vuelve a cerrarse en esa sesión del
 *   navegador. Preview: solo en memoria, para que la pareja lo pruebe.
 * - Apertura en ~2,5 s (13-oct-2026, «muy rápido, poco realista»): el lacre
 *   se parte, la solapa gira en 3D, la tarjeta sale del sobre, se queda un
 *   momento a la vista y crece hasta llenar la pantalla antes de la portada.
 *   Solo transform/opacity; con reduced-motion se abre con un fundido corto.
 * - Papel con flores en relieve y lacre SVG (wax-seal.tsx) con la paleta de
 *   la boda: el mismo sobre que enseña la landing (6-oct-2026).
 * - No es «el sobre» de aportaciones (ContributionEnvelope), que es otra cosa.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { InvitationMode } from "./types";
import { EnvelopeOpenContext, SealedContext, useThemeColor } from "./theme-color";
import { WaxSeal } from "./wax-seal";
import { prefersReducedMotion } from "@/lib/hooks/use-media-query";
import "./sealed-envelope.css";

// Duración de toda la secuencia: la CSS la recibe en --seal-t (un solo valor).
const OPEN_MS = 2500;
const REDUCED_MS = 160;

/**
 * Cuánto mover y escalar la tarjeta para centrarla y llenar el sobre
 * abierto (overlay). En coordenadas locales del overlay: el marco del
 * creador escala el móvil (scale .6) y los rect vienen ya escalados.
 */
export function cardGeometry(m: {
  overlay: { left: number; top: number; width: number; offsetWidth: number; offsetHeight: number };
  envelope: { left: number; top: number; width: number; height: number; offsetWidth: number; offsetHeight: number };
  card: { offsetLeft: number; offsetTop: number; offsetWidth: number; offsetHeight: number };
}): Record<string, string> {
  const k = m.overlay.width / m.overlay.offsetWidth || 1;
  const ow = m.overlay.offsetWidth;
  const oh = m.overlay.offsetHeight;
  const cw = m.card.offsetWidth || 1;
  const ch = m.card.offsetHeight || 1;
  // El :active escala el sobre desde su centro: el centro no se mueve.
  const ex = (m.envelope.left + m.envelope.width / 2 - m.overlay.left) / k;
  const ey = (m.envelope.top + m.envelope.height / 2 - m.overlay.top) / k;
  const cx = ex + m.card.offsetLeft + cw / 2 - m.envelope.offsetWidth / 2;
  const cy = ey + m.card.offsetTop + ch / 2 - m.envelope.offsetHeight / 2;
  // A la vista: casi todo el ancho, sin pasar de 1,6× (el texto se ve nítido).
  const hero = Math.max(1, Math.min((ow * 0.9) / cw, (oh * 0.62) / ch, 1.6));
  const round = (n: number) => String(Math.round(n * 1000) / 1000);
  return {
    "--card-dx": `${round(ow / 2 - cx)}px`,
    "--card-dy": `${round(oh / 2 - cy)}px`,
    "--card-hero": round(hero),
    // Un poco más que la pantalla para que no asomen los bordes.
    "--card-fill-x": round((ow / cw) * 1.06),
    "--card-fill-y": round((oh / ch) * 1.06),
  };
}

function storageKey(pathname: string): string {
  return `vk-sobre:${pathname}`;
}

type SessionStore = Pick<Storage, "getItem" | "setItem">;

/**
 * ¿Ya abrió este invitado el sobre de esta web en esta sesión del navegador?
 * Solo cuenta si lo abrió él (la marca se pone al tocar el sello, nunca al
 * pintarlo): la primera visita siempre ve el sobre cerrado. Sin
 * almacenamiento (modo privado) → false: se enseña el sobre.
 */
export function envelopeOpenedThisSession(storage: SessionStore | null | undefined, pathname: string): boolean {
  try {
    return storage?.getItem(storageKey(pathname)) === "1";
  } catch {
    return false;
  }
}

export function rememberEnvelopeOpened(storage: SessionStore | null | undefined, pathname: string): void {
  try {
    storage?.setItem(storageKey(pathname), "1");
  } catch {
    // Sin almacenamiento: se volverá a ver el sobre, sin más.
  }
}

export interface SealedEnvelopeProps {
  partnerName1: string;
  partnerName2: string;
  /** Iniciales "A·L" de coupleInitials. */
  initials: string;
  mode: InvitationMode;
  /** Papel del sobre: con flores en relieve o liso. */
  variant?: "floral" | "liso";
  /** Color de la franja del iPhone mientras el sobre está cerrado (papel). Solo web pública. */
  sealedThemeColor?: string;
  /** Nombre de pila del titular del enlace personal: «Para Carmen» sobre el sobre. */
  guestName?: string | null;
  children: ReactNode;
}

export function SealedEnvelope({ partnerName1, partnerName2, initials, mode, variant = "floral", sealedThemeColor, guestName, children }: SealedEnvelopeProps) {
  const [state, setState] = useState<"closed" | "opening" | "open">("closed");
  const [geometry, setGeometry] = useState<Record<string, string> | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const envelopeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  // `inert` solo tras hidratar: sin JS el sobre no se ve y la web debe seguir usable.
  const [hydrated, setHydrated] = useState(false);
  const [first, second] = initials.split("·");

  useEffect(() => {
    setHydrated(true);
    if (mode !== "public") return;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* modo privado: se muestra el sobre */ }
    if (envelopeOpenedThisSession(storage, window.location.pathname)) setState("open");
  }, [mode]);

  // El preview se desmonta a mitad de apertura (cambio de escena, de tema…).
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function open() {
    if (state !== "closed") return;
    const reduced = prefersReducedMotion();
    const overlay = overlayRef.current;
    const envelope = envelopeRef.current;
    const card = cardRef.current;
    if (!reduced && overlay && envelope && card) {
      const o = overlay.getBoundingClientRect();
      const e = envelope.getBoundingClientRect();
      setGeometry(
        cardGeometry({
          overlay: { left: o.left, top: o.top, width: o.width, offsetWidth: overlay.offsetWidth, offsetHeight: overlay.offsetHeight },
          envelope: { left: e.left, top: e.top, width: e.width, height: e.height, offsetWidth: envelope.offsetWidth, offsetHeight: envelope.offsetHeight },
          card: { offsetLeft: card.offsetLeft, offsetTop: card.offsetTop, offsetWidth: card.offsetWidth, offsetHeight: card.offsetHeight },
        }),
      );
    }
    setState("opening");
    if (mode === "public") {
      let storage: Storage | null = null;
      try { storage = window.sessionStorage; } catch { /* idem */ }
      rememberEnvelopeOpened(storage, window.location.pathname);
    }
    // «Abierto» (EnvelopeOpenContext) solo al terminar toda la secuencia: el
    // autoavance de la Story no arranca con la portada aún tapada.
    timer.current = window.setTimeout(() => setState("open"), reduced ? REDUCED_MS : OPEN_MS);
  }

  const sealed = state !== "open";
  const opening = state === "opening";
  // Hasta que el sobre se retira, la franja es del papel del sobre; después
  // el reproductor (SealedContext) toma el relevo con el color de la portada.
  useThemeColor(sealed ? sealedThemeColor : null);
  const overlayStyle = { "--seal-t": `${OPEN_MS}ms`, ...geometry } as CSSProperties;

  return (
    <>
      <SealedContext.Provider value={sealed}>
        <EnvelopeOpenContext.Provider value={state === "open"}>
          {/* inert hasta que se retira el sobre: nada de debajo recibe toques ni foco a mitad de apertura. */}
          <div inert={hydrated && sealed} className="sp-seal-content">
            {children}
          </div>
        </EnvelopeOpenContext.Provider>
      </SealedContext.Provider>
      {sealed && (
        <div
          ref={overlayRef}
          className="sp-seal"
          style={overlayStyle}
          data-state={state}
          data-variant={variant}
          data-sealed=""
          role="dialog"
          aria-modal="true"
          aria-label={`Invitación de ${partnerName1} y ${partnerName2}`}
        >
          <noscript>
            <style>{".sp-seal{display:none!important}"}</style>
          </noscript>
          <p className="sp-seal-eyebrow">
            {/* Enlace personal: a quién va dirigida (ítem 11). Mismo párrafo: sale con el antetítulo. */}
            {guestName ? (
              <span className="sp-seal-for" data-seal-for="">
                Para {guestName}
              </span>
            ) : null}
            Tienes una invitación
          </p>
          <button ref={envelopeRef} type="button" className="sp-seal-envelope" onClick={open} aria-label="Abrir la invitación">
            <span aria-hidden="true" className="sp-seal-back" />
            {/* Forro de la solapa y texto de la tarjeta: solo al abrir, para que
                el sobre cerrado sea idéntico píxel a píxel (y a la imagen OG). */}
            {opening ? <span aria-hidden="true" className="sp-seal-flap-inner" /> : null}
            <span ref={cardRef} aria-hidden="true" className="sp-seal-card" />
            {opening ? (
              // El texto va aparte del papel: el papel se estira hasta llenar
              // la pantalla y el texto no (se deformaría).
              <span aria-hidden="true" className="sp-seal-card-face">
                <span className="sp-seal-card-names">
                  {partnerName1} <span className="sp-seal-amp">&amp;</span> {partnerName2}
                </span>
              </span>
            ) : null}
            <span aria-hidden="true" className="sp-seal-pocket" />
            <span aria-hidden="true" className="sp-seal-flap" />
            <WaxSeal className="sp-seal-wax" initials={[first ?? "", second ?? ""]} id="sp-seal" />
            {opening ? (
              <>
                {/* El lacre se parte en dos al abrir. */}
                <WaxSeal className="sp-seal-shard sp-seal-shard-l" initials={[first ?? "", second ?? ""]} id="sp-seal-l" />
                <WaxSeal className="sp-seal-shard sp-seal-shard-r" initials={[first ?? "", second ?? ""]} id="sp-seal-r" />
              </>
            ) : null}
          </button>
          <p className="sp-seal-names">
            {partnerName1} <span className="sp-seal-amp">&amp;</span> {partnerName2}
          </p>
          <p className="sp-seal-hint" aria-hidden="true">
            Toca el sello para abrir
          </p>
        </div>
      )}
    </>
  );
}
