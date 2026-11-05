"use client";

/**
 * Maqueta «Como una web» (`document.layout === "web"`).
 *
 * Las MISMAS escenas del documento (portada, lugar, programa, asistencia)
 * pintadas como una página de scroll largo, con movimiento ligado al scroll
 * (referencia de estructura: Cordially Origins; ningún asset suyo). La monta
 * `renderer.tsx` igual en la página pública y en los previews del creador y
 * del panel: no hay otra implementación.
 *
 * Reglas:
 *  - El servidor y el primer render pintan TODO visible y quieto (sin JS se
 *    lee entero). El movimiento solo se activa tras montar (`data-motion`).
 *  - Solo transform y opacity. Con `prefers-reduced-motion`: sin parallax
 *    ni desplazamientos; las secciones solo aparecen con un fundido.
 *  - `useTransform(mv, v => …)` (forma de función) a propósito: con rangos,
 *    framer-motion lo acelera con un ScrollTimeline que en Chrome deja el
 *    valor mal al final.
 *  - Público: se desplaza la ventana. Preview: la propia maqueta es el
 *    contenedor de scroll (vive dentro del marco de un móvil).
 *  - Orden de lectura = orden visual: navegación, portada, secciones con
 *    h2, asistencia y pie. «Confirmar asistencia» lleva al formulario y le
 *    pasa el foco.
 */
import { useEditTargets } from "./edit-context";
import { DATE_GAP_FIELD, editPath, editScene } from "./edit-targets";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { LazyMotion, domAnimation, m, useInView, useScroll, useTransform } from "framer-motion";
import type { SceneImage, SiteThemeId, AgendaItem } from "@/lib/site-document";
import { CoverPhoto } from "./scenes/cover-photo";
import { ScenePhoto } from "./scenes/photo";
import { NAME_FONT, Names, longestWord, nameTier } from "./scenes/cover";
import { isDirectionsUrl } from "./scenes/agenda";
import { isOptimizableImage } from "./format";
import { LiveCountdown } from "./web-scenes";
import { useNow } from "./use-countdown";
import { countdownText, remainingParts } from "@/lib/countdown";
import type { InvitationMode } from "./types";

import "./web-layout.css";

/** "off": SSR y primer render (todo quieto y visible). */
type MotionLevel = "off" | "full" | "reduce";
export type WebTone = "paper" | "surface";

interface WebContext {
  mode: InvitationMode;
  motion: MotionLevel;
  /** Contenedor de scroll en el preview; undefined = la ventana. */
  container: RefObject<HTMLDivElement | null> | undefined;
  go: (id: string) => void;
}

const Ctx = createContext<WebContext>({ mode: "public", motion: "off", container: undefined, go: () => {} });
export const useWeb = () => useContext(Ctx);

/** 0 → 1 entre `from` y `to`, recortado. */
export function ramp(v: number, from: number, to: number) {
  return Math.min(1, Math.max(0, (v - from) / (to - from)));
}

// ---------------------------------------------------------------------------
// Contenedor
// ---------------------------------------------------------------------------

export interface WebNavLink {
  id: string;
  label: string;
}

export interface WebLayoutProps {
  mode: InvitationMode;
  /** Iniciales "A·L" para la marca de la navegación. */
  initials: string;
  /** Secciones con ancla para la navegación de escritorio. */
  links: WebNavLink[];
  /** Id de la sección de asistencia (si la hay): destino de «Confirmar asistencia». */
  rsvpId?: string;
  /**
   * false: desde aquí no se puede confirmar (enlace general sin token, enlace
   * no válido o plazo cerrado). El botón lleva igual a la sección, pero dice
   * «Asistencia», no «Confirmar asistencia». Sin la prop, como siempre.
   */
  rsvpCanConfirm?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Solo tests: fija el nivel de movimiento desde el primer render (sin
   * esperar a montar ni leer la preferencia del sistema).
   */
  forcedMotion?: "full" | "reduce";
}

export function WebLayout({ mode, initials, links, rsvpId, rsvpCanConfirm = true, children, footer, forcedMotion }: WebLayoutProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrollerReady, setScrollerReady] = useState(false);
  useLayoutEffect(() => { setScrollerReady(Boolean(rootRef.current)); }, []);
  const [motionLevel, setMotionLevel] = useState<MotionLevel>(forcedMotion ?? "off");
  const [tone, setTone] = useState<WebTone>("paper");
  /** La barra va transparente sobre la portada con foto y se vuelve píldora al bajar. */
  const [overHero, setOverHero] = useState(true);

  // La preferencia solo se conoce en el navegador: tras montar.
  useEffect(() => {
    if (forcedMotion) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionLevel(query.matches ? "reduce" : "full");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [forcedMotion]);

  // Tono del fondo: el de la sección que cruza el centro de la pantalla.
  const sectionsKey = links.map((l) => l.id).join("|") + (rsvpId ?? "");
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setTone(((entry.target as HTMLElement).dataset.tone as WebTone) || "paper");
        }
      },
      { root: mode === "preview" ? root : null, rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    root.querySelectorAll("[data-wl-section]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [mode, sectionsKey]);

  useEffect(() => {
    const root = rootRef.current;
    // Centinela dentro de la portada: su alto marca cuánto dura la barra
    // transparente (toda la portada; con el mosaico, solo el primer tramo).
    const hero = root?.querySelector<HTMLElement>(".wl-hero[data-photo] .wl-hero-sentinel");
    if (!root || !hero || typeof IntersectionObserver === "undefined") { setOverHero(false); return; }
    const observer = new IntersectionObserver(([entry]) => setOverHero(Boolean(entry?.isIntersecting)), {
      root: mode === "preview" ? root : null,
      threshold: 0,
      rootMargin: "-64px 0px 0px 0px",
    });
    observer.observe(hero);
    return () => observer.disconnect();
  }, [mode]);

  // Bloques fijos (capítulos de la historia, cabeceras de programa y
  // preguntas): se quedan centrados en la pantalla mientras se recorren, no
  // pegados arriba. El CSS necesita su alto (--wl-h) para calcular el centro.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const blocks = root.querySelectorAll<HTMLElement>("[data-wl-center]");
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        (entry.target as HTMLElement).style.setProperty("--wl-h", `${Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)}px`);
      }
    });
    blocks.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [sectionsKey, motionLevel]);

  const go = useCallback(
    (id: string) => {
      const target = rootRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      if (!target) return;
      const reduce = motionLevel !== "full";
      const scroller = mode === "preview" ? rootRef.current : null;
      const offset = 72; // la navegación flotante no tapa el título
      if (scroller) {
        const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset;
        scroller.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
      } else {
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
      }
      // El foco va al título de la sección (o a la sección), sin otro salto.
      const heading = target.querySelector<HTMLElement>("h1, h2") ?? target;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    },
    [mode, motionLevel],
  );

  // El contenedor solo se ofrece ya montado: con la ref aún vacía, useScroll de
  // las escenas lanzaba «Container ref is defined but not hydrated» en /crear
  // (Sentry VINKLO-WEB-3). Hasta entonces siguen el scroll de la ventana.
  const ctx: WebContext = { mode, motion: motionLevel, container: mode === "preview" && scrollerReady ? rootRef : undefined, go };

  return (
    <LazyMotion features={domAnimation}>
    <Ctx.Provider value={ctx}>
      <div ref={rootRef} className="wl" data-mode={mode} data-motion={motionLevel === "off" ? undefined : motionLevel} data-tone={tone} data-over-hero={overHero ? "" : undefined}>
        <div aria-hidden="true" className="wl-wash">
          <span className="wl-wash-surface" />
        </div>
        <WebNav initials={initials} links={links} rsvpId={rsvpId} canConfirm={rsvpCanConfirm} />
        {children}
        {footer && <div className="wl-footer">{footer}</div>}
      </div>
    </Ctx.Provider>
    </LazyMotion>
  );
}

// ---------------------------------------------------------------------------
// Navegación flotante
// ---------------------------------------------------------------------------

function NavTarget({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  const { mode, go } = useWeb();
  const onClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    go(id);
  };
  // Público: ancla real (funciona sin JS); preview: botón (los enlaces del preview no navegan).
  return mode === "public" ? (
    <a href={`#${id}`} className={className} onClick={onClick}>
      {children}
    </a>
  ) : (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
}

function WebNav({ initials, links, rsvpId, canConfirm }: { initials: string; links: WebNavLink[]; rsvpId?: string; canConfirm: boolean }) {
  const [first, second] = initials.split("·");
  return (
    <nav className="wl-nav" aria-label="Secciones de la invitación">
      <div className="wl-nav-bar">
        <NavTarget id="wl-inicio" className="wl-nav-mono font-display">
          <span aria-hidden="true">
            {first}
            {second ? <span className="wl-nav-amp font-script">&amp;</span> : null}
            {second}
          </span>
          <span className="sr-only">Inicio</span>
        </NavTarget>
        {links.length > 0 && (
          <ul className="wl-nav-links">
            {links.map((link) => (
              <li key={link.id}>
                <NavTarget id={link.id} className="wl-nav-link">
                  {link.label}
                </NavTarget>
              </li>
            ))}
          </ul>
        )}
        {rsvpId && (
          <NavTarget id={rsvpId} className="wl-nav-cta">
            {canConfirm ? (
              <>
                Confirmar<span className="wl-nav-cta-long">asistencia</span>
              </>
            ) : (
              "Asistencia"
            )}
          </NavTarget>
        )}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

/** Entra con fundido y desplazamiento (solo fundido con reduced-motion). */
export function WebReveal({ children, className, delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "span" }) {
  const { container } = useWeb();
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { root: container, once: true, margin: "0px 0px -12% 0px" });
  return (
    <Tag
      ref={ref as RefObject<HTMLDivElement & HTMLSpanElement>}
      className={className}
      data-reveal=""
      data-shown={inView ? "" : undefined}
      style={delay ? ({ "--wl-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

/** Sección con tono de fondo y ancla. */
export function WebSection({ id, tone, className, labelledBy, scene, children }: { id: string; tone: WebTone; className?: string; labelledBy?: string; /** Solo en el editor: sección que se marca para «Seleccionar». */ scene?: string; children: ReactNode }) {
  const edit = useEditTargets();
  return (
    <section id={id} data-wl-section="" data-tone={tone} aria-labelledby={labelledBy} className={`wl-section ${className ?? ""}`.trim()} {...(scene ? editScene(edit.on, scene) : {})}>
      {children}
    </section>
  );
}

export interface WebHeroProps {
  partnerName1: string;
  partnerName2: string;
  eyebrow: string;
  themeId: SiteThemeId;
  image: SceneImage | null;
  initials: string;
  headingLevel: 1 | 2;
  /**
   * Cuatro fotos de la galería para la transición «portada → mosaico»
   * (referencia cordially.io/demo): al bajar, la portada se recoge hasta ser
   * la foto central y estas entran desde los lados. Solo con foto de portada
   * y movimiento completo; si no, la portada de siempre.
   */
  orbit?: SceneImage[];
  /** Solo en el creador (marcas activas): sin fecha, la portada pinta su hueco para tocarlo. */
  dateMissing?: boolean;
}

/** Posiciones finales (en % del escenario) de las cuatro fotos que entran. */
const ORBIT_WIDE = [
  { left: 6, top: 5, width: 24, ratio: 1.06, from: -1 },
  { left: 11, top: 47, width: 19, ratio: 1.4, from: -1 },
  { left: 70, top: 28, width: 19, ratio: 1.4, from: 1 },
  { left: 70, top: 54, width: 24, ratio: 1.06, from: 1 },
] as const;
const ORBIT_NARROW = [
  { left: 3, top: 4, width: 40, ratio: 1.15, from: -1 },
  { left: 57, top: 9, width: 40, ratio: 1.3, from: 1 },
  { left: 3, top: 70, width: 44, ratio: 1.3, from: -1 },
  { left: 53, top: 72, width: 44, ratio: 1.15, from: 1 },
] as const;
/** Recorte final de la portada (inset top right bottom left, en %). */
const CENTER_WIDE = [12, 31, 4, 31] as const;
const CENTER_NARROW = [26, 12, 32, 12] as const;

const smooth = (t: number) => t * t * (3 - 2 * t);

function OrbitTile({ image, slot, index, progress }: { image: SceneImage; slot: (typeof ORBIT_WIDE)[number] | (typeof ORBIT_NARROW)[number]; index: number; progress: ReturnType<typeof useScroll>["scrollYProgress"] }) {
  const start = 0.14 + index * 0.05;
  const t = useTransform(progress, (v) => smooth(ramp(v, start, start + 0.5)));
  const x = useTransform(t, (k) => `${slot.from * 120 * (1 - k)}%`);
  const y = useTransform(t, (k) => `${(index % 2 ? 30 : -20) * (1 - k)}%`);
  const rotate = useTransform(t, (k) => slot.from * 8 * (1 - k));
  const opacity = useTransform(t, (k) => Math.min(1, k * 1.6));
  return (
    <m.figure
      className="wl-orbit"
      style={{ left: `${slot.left}%`, top: `${slot.top}%`, width: `${slot.width}%`, x, y, rotate, opacity }}
    >
      <span className="wl-orbit-frame" style={{ aspectRatio: String(slot.ratio) }}>
        <ScenePhoto image={image} sizes="(min-width: 64rem) 22rem, 45vw" />
      </span>
    </m.figure>
  );
}

/**
 * Portada a sangre en un marco redondeado: la foto (o el papel de la paleta
 * con el monograma) y los nombres a escala de cartel. Al bajar, el marco se
 * recoge un poco, la foto se acerca y sube más despacio que la página
 * (parallax) y los nombres se adelantan y se funden. Con `orbit`, la
 * portada se fija y se recoge hasta el centro de un mosaico (ver arriba).
 */
export function WebHero({ partnerName1, partnerName2, eyebrow, themeId, image, initials, headingLevel, orbit, dateMissing }: WebHeroProps) {
  const { motion: level, container } = useWeb();
  const edit = useEditTargets();
  const ref = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, container, offset: ["start start", "end start"] });
  const { scrollYProgress: pinProgress } = useScroll({ target: ref, container, offset: ["start start", "end end"] });
  const full = level === "full";
  const orbitOn = full && Boolean(image) && (orbit?.length ?? 0) >= 4;
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = pinRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? 1000) < 700));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frameScale = useTransform(scrollYProgress, (v) => 1 - 0.06 * ramp(v, 0, 1));
  const mediaScale = useTransform(scrollYProgress, (v) => 1.04 + 0.16 * ramp(v, 0, 1));
  const mediaY = useTransform(scrollYProgress, (v) => `${18 * ramp(v, 0, 1)}%`);
  const bodyY = useTransform(scrollYProgress, (v) => -120 * ramp(v, 0, 1));
  const bodyOpacity = useTransform(scrollYProgress, (v) => 1 - ramp(v, 0.1, 0.6));
  // Transición a mosaico: el marco se recorta hacia el centro.
  const center = narrow ? CENTER_NARROW : CENTER_WIDE;
  const clipPath = useTransform(pinProgress, (v) => {
    const k = smooth(ramp(v, 0.06, 0.72));
    const [t, r, b, l] = center.map((n) => (n * k).toFixed(2));
    return `inset(${t}% ${r}% ${b}% ${l}% round var(--wl-radius))`;
  });
  const orbitMediaScale = useTransform(pinProgress, (v) => 1.06 - 0.06 * smooth(ramp(v, 0.06, 0.72)));
  const orbitBodyOpacity = useTransform(pinProgress, (v) => 1 - ramp(v, 0.02, 0.22));
  const orbitBodyY = useTransform(pinProgress, (v) => -60 * ramp(v, 0, 0.22));
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const chars = Array.from(`${partnerName1} & ${partnerName2}`).length;
  const vars = { "--sp-word": String(longestWord(partnerName1, partnerName2)), "--wl-chars": String(Math.max(8, chars)) } as CSSProperties;
  const slots = narrow ? ORBIT_NARROW : ORBIT_WIDE;

  const frameStyle = orbitOn ? { clipPath } : full ? { scale: frameScale } : undefined;
  const mediaStyle = orbitOn ? { scale: orbitMediaScale } : full ? { scale: mediaScale, y: mediaY } : undefined;
  const bodyStyle = orbitOn ? { y: orbitBodyY, opacity: orbitBodyOpacity, ...vars } : full ? { y: bodyY, opacity: bodyOpacity, ...vars } : vars;

  return (
    <header ref={ref} id="wl-inicio" className="wl-hero" data-photo={image ? "" : undefined} data-orbit={orbitOn ? "" : undefined} data-wl-section="" data-tone="paper" {...editScene(edit.on, edit.coverId)}>
      <span aria-hidden="true" className="wl-hero-sentinel" />
      <div ref={pinRef} className="wl-hero-pin">
        <m.div className="wl-hero-frame" style={frameStyle}>
          {image ? (
            <>
              {/* Ruta de la foto: el creador la marca como hueco mientras es de relleno (lib/template-preview.ts). */}
              <m.div className="wl-hero-media" style={mediaStyle} {...editPath(edit.on, `${edit.coverId}/image`)}>
                <CoverPhoto src={image.url} alt={image.alt || `Foto de ${partnerName1} y ${partnerName2}`} unoptimized={!isOptimizableImage(image.url)} />
              </m.div>
              <div aria-hidden="true" className="wl-hero-scrim" />
            </>
          ) : (
            <p aria-hidden="true" className="wl-hero-mono font-script">
              {initials}
            </p>
          )}
          <m.div className="wl-hero-body" style={bodyStyle}>
            {eyebrow && <p className="wl-eyebrow font-mono" {...editPath(edit.on, `${edit.coverId}/eyebrow`)}>{eyebrow}</p>}
            <Heading className={`wl-names ${NAME_FONT[themeId]}`} data-long={nameTier(partnerName1, partnerName2)} {...editPath(edit.on, `${edit.coverId}/names`)}>
              <Names partnerName1={partnerName1} partnerName2={partnerName2} ampClassName={image ? "" : "text-cava"} />
            </Heading>
            {edit.on && dateMissing && <p className="wl-date-gap font-display" {...editPath(edit.on, `${edit.coverId}/${DATE_GAP_FIELD}`)}>Vuestra fecha</p>}
          </m.div>
          <m.p aria-hidden="true" className="wl-hero-hint font-mono" style={orbitOn ? { opacity: orbitBodyOpacity } : undefined}>
            <span className="wl-hero-hint-arrow">↓</span>
            <span className="wl-hero-hint-line" />
            Desliza para ver más
          </m.p>
        </m.div>
        {orbitOn && (
          <div aria-hidden="true" className="wl-orbits">
            {orbit!.slice(0, 4).map((photo, i) => (
              <OrbitTile key={`${photo.url}-${i}`} image={photo} slot={slots[i]!} index={i} progress={pinProgress} />
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * Bienvenida de la pareja (su propio texto) a escala de cita: cada palabra
 * se enciende al pasar, ligada al scroll. Con reduced-motion, entera.
 */
export function WebWelcome({ text }: { text: string }) {
  const { motion: level, container } = useWeb();
  const edit = useEditTargets();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, container, offset: ["start 85%", "end 50%"] });
  const words = text.split(/(\s+)/);
  const count = words.filter((w) => w.trim()).length || 1;
  let index = 0;
  return (
    <WebSection id="wl-bienvenida" tone="paper" className="wl-welcome" scene={edit.coverId || undefined}>
      <div ref={ref} className="wl-inner">
        <p className="wl-welcome-text font-display" {...editPath(edit.on, `${edit.coverId}/welcomeMessage`)}>
          {level === "full"
            ? words.map((word, i) =>
                word.trim() ? <TintWord key={i} progress={scrollYProgress} index={index++} total={count}>{word}</TintWord> : word,
              )
            : text}
        </p>
      </div>
    </WebSection>
  );
}

export function TintWord({ progress, index, total, children }: { progress: ReturnType<typeof useScroll>["scrollYProgress"]; index: number; total: number; children: string }) {
  const start = (index / total) * 0.8;
  const opacity = useTransform(progress, (v) => 0.2 + 0.8 * ramp(v, start, start + 0.2));
  return <m.span style={{ opacity }}>{children}</m.span>;
}

const WEEKDAY = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });

/** Partes de una fecha civil AAAA-MM-DD (sin zona: se lee en UTC). */
function dateParts(weddingDate: string): { weekday: string; day: number; monthYear: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weddingDate);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return { weekday: WEEKDAY.format(date), day: date.getUTCDate(), monthYear: MONTH_YEAR.format(date) };
}

/**
 * La fecha como cartel y la cuenta atrás (días para el sí), viva y en reloj
 * de pared de Madrid, con el reloj días : horas : minutos : segundos debajo.
 * Cuenta hasta la hora de la ceremonia o, sin ella, hasta las 00:00 del día
 * de la boda. La línea de días y el reloj salen de la MISMA resta.
 */
export function WebDatePoster({ id, weddingDate, showCountdown, ceremonyTime, initialNow, children }: { id: string; weddingDate: string; showCountdown: boolean; ceremonyTime: string | null; initialNow: number; children?: ReactNode }) {
  const { motion: level, container } = useWeb();
  // Solo en el editor: la fecha se toca para cambiarla (edición desde la vista previa).
  const edit = useEditTargets();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, container, offset: ["start end", "end start"] });
  const dayY = useTransform(scrollYProgress, (v) => (0.5 - v) * 56);
  const { now, mounted } = useNow(initialNow, 1000);
  const target = ceremonyTime ?? "00:00";
  const left = showCountdown ? remainingParts(weddingDate, target, now) : null;
  const parts = dateParts(weddingDate);
  if (!parts) return null;
  // La línea dice los días; el día de la boda (0 días), las horas y minutos.
  const line = left ? countdownText(left.d > 0 ? { days: left.d, hours: null, minutes: null } : { days: 0, hours: left.h, minutes: left.h === 0 ? Math.max(1, left.m) : left.m }) : null;
  const titleId = `${id}-title`;
  return (
    <WebSection id={id} tone="surface" labelledBy={titleId} className="wl-date" scene={id.replace(/-fecha$/, "")}>
      <div ref={ref} className="wl-inner wl-center">
        <WebReveal>
          <h2 id={titleId} className="wl-eyebrow font-mono">
            La fecha
          </h2>
          <p className="wl-date-lead font-display">Nos encantaría contar contigo…</p>
        </WebReveal>
        <time dateTime={weddingDate} className="wl-date-poster" {...(edit.coverId ? editPath(edit.on, `${edit.coverId}/${DATE_GAP_FIELD}`) : {})}>
          <WebReveal as="span" delay={80} className="wl-date-weekday font-script">
            {parts.weekday}
          </WebReveal>
          <m.span className="wl-date-day font-display tabular" style={level === "full" ? { y: dayY } : undefined}>
            {parts.day}
          </m.span>
          <WebReveal as="span" delay={120} className="wl-date-month font-display">
            {parts.monthYear}
          </WebReveal>
        </time>
        {line && (
          <WebReveal delay={160} className="wl-count">
            <p className="font-display" suppressHydrationWarning>
              <span className="wl-count-num tabular" suppressHydrationWarning>{line.value}</span> {line.rest}
            </p>
            <LiveCountdown weddingDate={weddingDate} time={target} now={mounted ? now : null} />
          </WebReveal>
        )}
        {children && <WebReveal delay={200}>{children}</WebReveal>}
      </div>
    </WebSection>
  );
}

/** Lugar: nombre a escala de cartel, dirección, hora y las acciones de siempre. */
export function WebVenue({ id, venue, address, time, children }: { id: string; venue: string; address: string; time: string; children?: ReactNode }) {
  const titleId = `${id}-title`;
  const edit = useEditTargets();
  return (
    <WebSection id={id} tone="paper" labelledBy={titleId} className="wl-venue" scene={id}>
      <div className="wl-inner wl-center">
        <WebReveal>
          <h2 id={titleId} className="wl-eyebrow font-mono">
            Lugar de la celebración
          </h2>
        </WebReveal>
        {venue && (
          <WebReveal delay={80}>
            <p className="wl-venue-name font-display" data-long={Array.from(venue).length > 60 ? "" : undefined} {...editPath(edit.on, `${id}/venue`)}>
              {venue}
            </p>
          </WebReveal>
        )}
        {address && (
          <WebReveal delay={120}>
            <p className="wl-venue-address" {...editPath(edit.on, `${id}/address`)}>{address}</p>
          </WebReveal>
        )}
        {time && (
          <WebReveal delay={160}>
            <p className="wl-venue-time font-script">Te esperamos a las {time}</p>
          </WebReveal>
        )}
        {children && <WebReveal delay={200}>{children}</WebReveal>}
      </div>
    </WebSection>
  );
}

/**
 * Programa del día como un raíl: una línea que se va llenando al bajar y
 * cada momento que entra con su hora.
 */
export function WebAgenda({ id, title, items }: { id: string; title: string; items: AgendaItem[] }) {
  const { mode, motion: level, container } = useWeb();
  const edit = useEditTargets();
  const listRef = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: listRef, container, offset: ["start 75%", "end 55%"] });
  const fill = useTransform(scrollYProgress, (v) => ramp(v, 0, 1));
  const titleId = `${id}-title`;
  if (items.length === 0) return null;
  return (
    <WebSection id={id} tone="surface" labelledBy={titleId} className="wl-agenda" scene={id}>
      <div className="wl-inner wl-agenda-grid">
        <div className="wl-agenda-head" data-wl-center="">
          <WebReveal>
            <p aria-hidden="true" className="wl-eyebrow font-mono">
              Programa
            </p>
            <h2 id={titleId} className="wl-h2 font-display" {...editPath(edit.on, `${id}/title`)}>
              {title}
            </h2>
          </WebReveal>
        </div>
        <div className="wl-rail">
          <span aria-hidden="true" className="wl-rail-track" />
          <m.span aria-hidden="true" className="wl-rail-fill" style={level === "full" ? { scaleY: fill } : undefined} />
          <ol ref={listRef} className="wl-rail-list">
          {items.map((item) => (
            <li key={item.id} className="wl-rail-item">
              <WebReveal>
                <span aria-hidden="true" className="wl-rail-dot" />
                {item.timeLabel && <p className="wl-rail-time font-script tabular">{item.timeLabel}</p>}
                <p className="wl-rail-title font-display" {...editPath(edit.on, `${id}/items/${item.id}/title`)}>{item.title}</p>
                {item.place && <p className="wl-rail-place">{item.place}</p>}
                {item.address &&
                  (isDirectionsUrl(item.address) ? (
                    mode === "public" ? (
                      <a href={item.address} target="_blank" rel="noopener noreferrer" className="wl-rail-link">
                        Cómo llegar
                      </a>
                    ) : (
                      <span aria-disabled="true" className="wl-rail-link">
                        Cómo llegar
                      </span>
                    )
                  ) : (
                    <p className="wl-rail-place">{item.address}</p>
                  ))}
                {item.notes && <p className="wl-rail-notes">{item.notes}</p>}
              </WebReveal>
            </li>
          ))}
          </ol>
        </div>
      </div>
    </WebSection>
  );
}

/** Contenedor para escenas ya pintadas (asistencia, «el sobre»). */
export function WebBlock({ id, tone, scene, children }: { id: string; tone: WebTone; scene?: string; children: ReactNode }) {
  const edit = useEditTargets();
  return (
    <div id={id} data-wl-section="" data-tone={tone} className="wl-section wl-block" {...(scene ? editScene(edit.on, scene) : {})}>
      <WebReveal className="wl-inner">{children}</WebReveal>
    </div>
  );
}
