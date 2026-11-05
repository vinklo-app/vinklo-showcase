"use client";

/**
 * «El vuelo» (6-oct-2026): la sección central de la landing, con la
 * estructura del motor de scroll-world (oso95/scroll-world) pero sin vídeo
 * ni assets generados: una escena fija (sticky) que se recorre con el
 * scroll como un plano continuo y, encima, el texto de cada paso que se
 * asienta a mitad de tramo («linger») y cambia hacia los bordes.
 *
 * Tres tramos, un solo progreso (0→1) del alto de la sección:
 *  1. El sobre: se abre y sale la tarjeta (0 → 0,36).
 *  2. La invitación: el móvil entra, la paleta cambia (0,30 → 0,66).
 *  3. Las respuestas: el móvil se aparta, la lista se rellena (0,62 → 1).
 *
 * Solo transform/opacity; `useTransform` en forma de función (con
 * rangos, Chrome deja mal el valor final); todo visible sin JS (el servidor pinta el estado
 * inicial y el texto del primer paso). Por debajo de 900 px los tres pasos
 * se apilan y cada escena recorre su tramo con su propio scroll
 * (`StackScene`). Con reduced-motion no hay sticky ni recorrido: los tres
 * pasos se apilan, cada uno con su escena en estado final.
 */
import Link from "next/link";
import { DEMO_GUESTS, DEMO_INVITED } from "@/components/landing/demo-guests";
import { landingCopy, type LandingCopy, type Locale } from "@/components/landing/copy";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRightIcon, CheckCheckIcon } from "lucide-react";
import { LazyMotion, domAnimation, m, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";

import { WaxSeal } from "@/components/invitation/wax-seal";
import { FLIGHT_PALETTES as PALETTES } from "@/components/landing/flight-palettes";
import type { SitePaletteId } from "@/lib/site-document";
import { useMediaQuery } from "@/lib/hooks/use-media-query";

/** Los tres pasos (textos en copy/es.ts y copy/en.ts). */
const STEP_COUNT = 3;

/** 0 → 1 entre `from` y `to`, recortado. */
const ramp = (v: number, from: number, to: number) => Math.min(1, Math.max(0, (v - from) / (to - from)));
/** Suavizado Hermite (scroll-world `smooth`). */
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Dentro de [a, b]: entra en `edge`, se asienta, sale en `edge` («linger»). */
const window = (v: number, a: number, b: number, edge = 0.05) => Math.min(ramp(v, a, a + edge), 1 - ramp(v, b - edge, b));

type P = MotionValue<number>;
type Covers = Record<string, ReactNode>;

// ---------------------------------------------------------------------------
// Capas
// ---------------------------------------------------------------------------

function EnvelopeLayer({ p }: { p: P }) {
  // Visible hasta 0,38; se abre entre 0,08 y 0,26; la tarjeta sube y crece después.
  const layerOpacity = useTransform(p, (v) => 1 - ramp(v, 0.3, 0.38));
  const layerTransform = useTransform(p, (v) => `scale(${1 - 0.1 * ramp(v, 0.3, 0.38)})`);
  const sealTransform = useTransform(p, (v) => `scale(${v < 0.08 ? 1 : v < 0.12 ? 1 - 0.1 * ramp(v, 0.08, 0.12) : 0.9 + 0.3 * ramp(v, 0.12, 0.16)})`);
  const sealOpacity = useTransform(p, (v) => 1 - ramp(v, 0.12, 0.16));
  const flapTransform = useTransform(p, (v) => `rotateX(${178 * smooth(ramp(v, 0.14, 0.24))}deg)`);
  const flapZ = useTransform(p, (v) => (v < 0.19 ? 4 : 1));
  const cardTransform = useTransform(p, (v) => `translateY(${-30 * smooth(ramp(v, 0.22, 0.3))}%) scale(${1 + 0.26 * smooth(ramp(v, 0.26, 0.34))})`);
  const paperOpacity = useTransform(p, (v) => 1 - ramp(v, 0.27, 0.34));
  // La tarjeta va detrás del bolsillo hasta que sale del sobre.
  const cardZ = useTransform(p, (v) => (v < 0.27 ? 2 : 6));
  return (
    <m.div className="lc-flight-layer lc-flight-env" style={{ opacity: layerOpacity, transform: layerTransform }}>
      <div className="lc-browser lc-browser--bare">
        <div className="lc-browser-body">
          <div className="lc-env" data-scrub="">
            <div className="lc-env-stage">
              <m.div className="lc-env-back" style={{ opacity: paperOpacity }} />
              <m.div className="lc-env-card" style={{ transform: cardTransform, zIndex: cardZ }}>
                <span className="lc-env-card-names">Lucía <em>&amp;</em> Juan</span>
              </m.div>
              <m.div className="lc-env-pocket" style={{ opacity: paperOpacity }}><i /></m.div>
              <m.div className="lc-env-flap" style={{ transform: flapTransform, zIndex: flapZ, opacity: paperOpacity }}><i /></m.div>
              <m.div className="lc-flight-seal" style={{ transform: sealTransform, opacity: sealOpacity }}>
                <WaxSeal className="lc-env-seal" initials={["L", "J"]} id="lc-flight-seal" />
              </m.div>
            </div>
          </div>
        </div>
      </div>
    </m.div>
  );
}

/** Cuándo entra (fundido) cada paleta, centrado en el cambio de 0,46 y 0,56. */
const COVER_FADES: ReadonlyArray<[number, number] | null> = [null, [0.44, 0.48], [0.54, 0.58]];

/**
 * Las portadas van apiladas y todas pintadas (nunca `hidden`): la de cada
 * paleta se funde encima de la anterior con el scroll. Con `hidden`, el
 * IntersectionObserver de la cabecera de la invitación (web-layout.tsx)
 * veía la portada oculta fuera de la vista y al mostrarla salía un instante
 * en su estado «al bajar» (píldora blanca tras «L&J» y «Confirmar»).
 */
function CoverLayer({ p, index, children }: { p: P; index: number; children: ReactNode }) {
  const fade = COVER_FADES[index] ?? null;
  const opacity = useTransform(p, (v) => (fade ? smooth(ramp(v, fade[0], fade[1])) : 1));
  return <m.div className="lc-flight-cover" data-layer={index} style={{ opacity, zIndex: index }}>{children}</m.div>;
}

const paletteAt = (v: number) => (v < 0.46 ? PALETTES[0]! : v < 0.56 ? PALETTES[1]! : PALETTES[2]!);

function PhoneLayer({ p, covers, fixedPalette }: { p: P; covers: Covers; fixedPalette?: SitePaletteId }) {
  // Entra 0,3 → 0,4; de 0,62 a 0,72 se aparta a la izquierda y encoge; la paleta cambia a 0,46 y 0,56.
  const opacity = useTransform(p, (v) => ramp(v, 0.3, 0.38));
  // Un solo `transform` (translate + scale + rotate) en vez de las abreviaturas de framer: va por GPU.
  const transform = useTransform(p, (v) => {
    const scale = 0.82 + 0.18 * smooth(ramp(v, 0.3, 0.42)) - 0.16 * smooth(ramp(v, 0.62, 0.72));
    const y = 60 * (1 - smooth(ramp(v, 0.3, 0.42)));
    const x = -34 * smooth(ramp(v, 0.62, 0.72));
    const rotate = -6 * smooth(ramp(v, 0.62, 0.72));
    return `translate3d(${x}%, ${y}px, 0) scale(${scale}) rotate(${rotate}deg)`;
  });
  const [palette, setPalette] = useState<SitePaletteId>(fixedPalette ?? PALETTES[0]!);
  // Tras hidratar, desde el valor actual (al recargar a media página el scroll ya no está en 0).
  useEffect(() => { if (!fixedPalette) setPalette(paletteAt(p.get())); }, [p, fixedPalette]);
  useMotionValueEvent(p, "change", (v) => {
    if (fixedPalette) return;
    const next = paletteAt(v);
    if (next !== palette) setPalette(next);
  });
  return (
    <m.div className="lc-flight-layer lc-flight-phone-wrap" style={{ opacity, transform }}>
      <div className="lc-flight-phone">
        <div className="ll-phone-screen" inert>
          {fixedPalette
            ? <div className="lc-flight-cover">{covers[fixedPalette]}</div>
            : PALETTES.map((id, i) => <CoverLayer key={id} p={p} index={i}>{covers[id]}</CoverLayer>)}
        </div>
      </div>
      <div className="lc-flight-dots" aria-hidden="true">
        {PALETTES.map((id) => <span key={id} data-on={id === palette ? "" : undefined} data-palette={id} />)}
      </div>
    </m.div>
  );
}

// Los mismos invitados que la tarjeta del bento: al final del tramo, 14
// confirmados de 16. Jorge la abre pero aún no contesta.
const TIMING = [[0.64, 0.76], [0.67, 0.8], [0.7, 0.84], [0.73, 2], [0.76, 0.88]] as const;
const GUESTS = DEMO_GUESTS.map((g, i) => ({ ...g, open: TIMING[i]![0], yes: TIMING[i]![1] }));
/** Cuántos umbrales (abierta/confirmada) ha cruzado `v`. */
const guestStep = (v: number) => GUESTS.reduce((n, g) => n + (v >= g.open ? 1 : 0) + (v >= g.yes ? 1 : 0), 0);

function ListLayer({ p, fixed, t }: { p: P; fixed?: number; t: LandingCopy }) {
  const opacity = useTransform(p, (v) => ramp(v, 0.62, 0.7));
  const transform = useTransform(p, (v) => `translateY(${80 * (1 - smooth(ramp(v, 0.62, 0.74)))}px)`);
  const [v, setV] = useState(fixed ?? 0);
  useEffect(() => { if (fixed === undefined) setV(p.get()); }, [p, fixed]);
  // Solo se vuelve a pintar cuando cruza un umbral (abre/confirma alguien), no en cada fotograma.
  useMotionValueEvent(p, "change", (value) => { if (fixed === undefined && guestStep(value) !== guestStep(v)) setV(value); });
  const coming = GUESTS.filter((g) => v >= g.yes).reduce((sum, g) => sum + g.confirmed, 0);
  return (
    <m.div className="lc-flight-layer lc-flight-list" style={{ opacity, transform }}>
      <div className="lc-flight-card">
        <div className="lc-flight-card-head">
          <span className="lc-kicker lc-kicker--clay">{t.flight.listKicker}</span>
          <b className="font-display"><span className="tabular">{coming}</span> {t.flight.ofConfirmed(DEMO_INVITED)}</b>
        </div>
        <ul className="lc-proc-list">
          {GUESTS.map((g, i) => {
            const state = v >= g.yes ? "viene" : v >= g.open ? "abierta" : "enviada";
            return (
              <li key={g.name}>
                <span className="lc-proc-avatar">{t.guests.names[i]![0]}</span>
                <span className="lc-proc-name">{t.guests.names[i]}<small>{t.flight.invited(g.invited)}</small></span>
                <span className="lc-flight-state" data-s={state}>
                  {state === "viene" ? <><CheckCheckIcon width={14} height={14} strokeWidth={2} /> {t.guests.confirmed(g.confirmed)}</> : state === "abierta" ? t.guests.opened : t.guests.sent}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </m.div>
  );
}

// ---------------------------------------------------------------------------
// Texto fijo por tramo
// ---------------------------------------------------------------------------

const SEGMENTS: ReadonlyArray<[number, number]> = [[0, 0.36], [0.33, 0.66], [0.63, 1.001]];

function Copy({ p, index, children }: { p: P; index: number; children: ReactNode }) {
  const [a, b] = SEGMENTS[index]!;
  const opacity = useTransform(p, (v) => window(v, a, b, 0.05));
  const transform = useTransform(p, (v) => `translateY(${v < (a + b) / 2 ? 16 * (1 - ramp(v, a, a + 0.05)) : -16 * ramp(v, b - 0.05, b)}px)`);
  return (
    <m.div className="lc-flight-copy" style={{ opacity, transform }} aria-hidden={index === 0 ? undefined : true}>
      {children}
    </m.div>
  );
}

function StepCopy({ index, cta, t }: { index: number; cta?: boolean; t: LandingCopy }) {
  const step = t.flight.steps[index]!;
  return (
    <>
      <p className="lc-kicker">{step.kicker}</p>
      <h3 className="lc-display lc-flight-title">{step.title}</h3>
      <p className="lc-flight-body">{step.body}</p>
      {cta && (
        <Link href="/crear" className="lc-pill lc-pill--solid lc-flight-cta">{t.nav.create} <ArrowUpRightIcon aria-hidden="true" width={18} height={18} strokeWidth={1.75} /></Link>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sección
// ---------------------------------------------------------------------------

/** Móvil y tableta estrecha: los tres pasos apilados (el recorrido fijo dejaba huecos y textos montados). */
const NARROW_QUERY = "(max-width: 899.98px)";
function useNarrow() { return useMediaQuery(NARROW_QUERY); }

/**
 * Móvil (13-oct-2026): cada escena apilada recorre su propio tramo del vuelo
 * de escritorio con su posición en pantalla (de asomar por abajo a llegar al
 * centro): el sobre se abre, el móvil entra y cambia de paleta, la lista se
 * rellena. Con reduced-motion, el estado final fijo de siempre.
 */
const STACK_RANGES: ReadonlyArray<[number, number]> = [[0, 0.29], [0.3, 0.6], [0.62, 0.92]];
const STACK_FINAL = [0.26, 0.5, 1] as const;

function StackScene({ index, still, children }: { index: number; still: boolean; children: (p: P) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const [from, to] = STACK_RANGES[index]!;
  const scrubbed = useTransform(scrollYProgress, (v) => from + (to - from) * v);
  const fixed = useMotionValue<number>(STACK_FINAL[index]!);
  return (
    <div ref={ref} className="lc-flight-stage" data-scene={index} aria-hidden="true">
      {children(still ? fixed : scrubbed)}
    </div>
  );
}

/** `covers`: portadas del móvil pintadas en el servidor (flight-covers.tsx), una por paleta. */
export function LandingFlight({ covers, locale = "es" }: { covers: Covers; locale?: Locale }) {
  const t = landingCopy(locale);
  const reducedMotion = useReducedMotion();
  const narrow = useNarrow();
  const reduce = reducedMotion || narrow;
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const trackTransform = useTransform(scrollYProgress, (v) => `scaleX(${v})`);

  if (reduce) {
    // Reduced-motion: tres escenas quietas en su estado final. Móvil: cada una se anima con su scroll.
    const still = Boolean(reducedMotion);
    return (
      <LazyMotion features={domAnimation}>
      <section className="lc-chapter lc-flight lc-flight--static" data-scrub={still ? undefined : ""} aria-label={t.flight.label}>
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <div key={i} className="lc-flight-static">
            <div className="lc-flight-copy"><StepCopy index={i} cta={i === 2} t={t} /></div>
            <StackScene index={i} still={still}>
              {(p) => (
                <>
                  {i === 0 && <EnvelopeLayer p={p} />}
                  {i === 1 && <PhoneLayer p={p} covers={covers} fixedPalette={still ? "terracota" : undefined} />}
                  {i === 2 && <ListLayer p={p} fixed={still ? 1 : undefined} t={t} />}
                </>
              )}
            </StackScene>
          </div>
        ))}
      </section>
      </LazyMotion>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
    <section ref={ref} className="lc-chapter lc-flight" aria-label={t.flight.label}>
      <div className="lc-flight-sticky">
        <div className="lc-flight-inner">
          <div className="lc-flight-copies">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <Copy key={i} p={scrollYProgress} index={i}><StepCopy index={i} cta={i === 2} t={t} /></Copy>
            ))}
          </div>
          <div className="lc-flight-stage" aria-hidden="true">
            <EnvelopeLayer p={scrollYProgress} />
            <PhoneLayer p={scrollYProgress} covers={covers} />
            <ListLayer p={scrollYProgress} t={t} />
          </div>
        </div>
        <div className="lc-flight-track" aria-hidden="true"><m.i style={{ transform: trackTransform }} /></div>
      </div>
    </section>
    </LazyMotion>
  );
}
