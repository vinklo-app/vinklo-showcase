"use client";

/**
 * Secciones v2 de la maqueta «Como una web» (6-oct-2026, referencia de
 * estructura cordially.io/demo; ningún asset suyo):
 *  - WebGallery: collage de fotos en columnas que se desplazan a distinta
 *    velocidad (parallax) y, debajo, una frase que se enciende palabra a palabra.
 *  - WebStory: capítulos con el texto fijo a un lado y las fotos apiladas
 *    como polaroids que se van retirando al bajar.
 *  - WebDetails: tarjetas que se abren en el sitio (<details>).
 *  - WebFaq: acordeón de preguntas (<details>).
 *  - LiveCountdown: días : horas : minutos : segundos hasta la hora de la
 *    ceremonia (o las 00:00 del día de la boda) en reloj de pared de Madrid,
 *    solo tras montar
 *    (el servidor no pinta segundos: nunca desincroniza la hidratación).
 *
 * Mismas reglas que web-layout.tsx: solo transform/opacity, `useTransform`
 * en forma de función, todo visible y quieto sin JS, y sin desplazamientos
 * con reduced-motion. Los textos y las fotos son de la pareja; aquí solo hay
 * rótulos de sección.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { m, useScroll, useTransform, type MotionValue } from "framer-motion";
import type { BusStop, DetailCard, FaqItem, Hotel, SceneImage, StoryChapter } from "@/lib/site-document";
import type { InvitationMode } from "./types";
import { BusStops, HotelList } from "./scenes/modules";
import { ScenePhoto, photoAspect } from "./scenes/photo";
import { TintWord, WebReveal, WebSection, ramp, useWeb } from "./web-layout";
import { useEditTargets } from "./edit-context";
import { editPath, type EditAttrs } from "./edit-targets";
import { remainingParts } from "@/lib/countdown";

/** Marca de «Seleccionar» de un texto de la sección `id` (solo en el editor). */
function useEditAt(id: string) {
  const { on } = useEditTargets();
  return (path: string) => editPath(on, `${id}/${path}`);
}

// ---------------------------------------------------------------------------
// Galería: collage con parallax por columnas
// ---------------------------------------------------------------------------

const COLUMN_SPEED = [-46, 70, -34] as const;

function Column({ progress, images, speed, sizes }: { progress: MotionValue<number>; images: SceneImage[]; speed: number; sizes: string }) {
  const { motion: level } = useWeb();
  const y = useTransform(progress, (v) => (0.5 - v) * speed);
  return (
    <m.div className="wl-collage-col" style={level === "full" ? { y } : undefined}>
      {images.map((image, i) => (
        <WebReveal key={`${image.url}-${i}`} delay={i * 60} className="wl-collage-item" >
          <span className="wl-collage-frame" style={{ aspectRatio: photoAspect(image) }}>
            <ScenePhoto image={image} sizes={sizes} />
          </span>
          {image.caption && <span className="wl-collage-caption">{image.caption}</span>}
        </WebReveal>
      ))}
    </m.div>
  );
}

export function WebGallery({ id, title, images: all, consumed = 0 }: { id: string; title: string; images: SceneImage[]; consumed?: number }) {
  const { container, motion: level } = useWeb();
  const at = useEditAt(id);
  // Con la transición de portada activa (movimiento completo), las primeras
  // `consumed` fotos ya están en el mosaico de la portada.
  const images = level === "full" && consumed > 0 ? all.slice(consumed) : all;
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, container, offset: ["start end", "end start"] });
  if (images.length < 2) {
    // Sin nada que enseñar: un nodo vacío para que useScroll tenga su objetivo.
    if (!title) return <div ref={ref} hidden />;
    return (
      <WebSection id={id} tone="paper" className="wl-gallery" labelledBy={`${id}-title`} scene={id}>
        <div ref={ref} className="wl-inner"><WebTintLine id={`${id}-title`} text={title} edit={at("title")} /></div>
      </WebSection>
    );
  }
  // Cinco o más: composición de cordially.io/demo — la primera foto grande en el
  // centro, dos a cada lado con tamaños distintos (las demás, debajo).
  if (images.length >= 5) return <WebMosaic id={id} title={title} images={images} progress={scrollYProgress} refEl={ref} edit={at("title")} />;
  const columnCount = 2;
  const columns: SceneImage[][] = Array.from({ length: columnCount }, () => []);
  images.forEach((image, i) => columns[i % columnCount]!.push(image));
  const sizes = "(min-width: 64rem) 28rem, 50vw";
  return (
    <WebSection id={id} tone="paper" className="wl-gallery" labelledBy={title ? `${id}-title` : undefined} scene={id}>
      <div ref={ref} className="wl-inner">
        <div className="wl-collage" data-cols={columnCount}>
          {columns.map((column, k) => (
            <Column key={k} progress={scrollYProgress} images={column} speed={COLUMN_SPEED[k % COLUMN_SPEED.length]!} sizes={sizes} />
          ))}
        </div>
        {title && <WebTintLine id={`${id}-title`} text={title} edit={at("title")} />}
      </div>
    </WebSection>
  );
}

const MOSAIC_SLOTS = ["wl-mo-a", "wl-mo-b", "wl-mo-main", "wl-mo-c", "wl-mo-d"] as const;
const MOSAIC_SPEED = [-60, 40, 0, 70, -30] as const;

function MosaicTile({ image, slot, speed, progress, sizes }: { image: SceneImage; slot: string; speed: number; progress: MotionValue<number>; sizes: string }) {
  const { motion: level } = useWeb();
  const y = useTransform(progress, (v) => (0.5 - v) * speed);
  const scale = useTransform(progress, (v) => (slot === "wl-mo-main" ? 1.08 - 0.08 * Math.min(1, v * 1.6) : 1));
  return (
    <m.figure className={`wl-mo ${slot}`} style={level === "full" ? { y } : undefined}>
      <span className="wl-mo-frame">
        <m.span className="wl-mo-img" style={level === "full" ? { scale } : undefined}>
          <ScenePhoto image={image} sizes={sizes} />
        </m.span>
      </span>
      {image.caption && <figcaption className="wl-collage-caption">{image.caption}</figcaption>}
    </m.figure>
  );
}

function WebMosaic({ id, title, images, progress, refEl, edit }: { id: string; title: string; images: SceneImage[]; progress: MotionValue<number>; refEl: React.RefObject<HTMLDivElement | null>; edit?: EditAttrs }) {
  const [main, ...others] = images;
  const ordered = [others[0], others[1], main, others[2], others[3]] as SceneImage[];
  const extra = others.slice(4);
  return (
    <WebSection id={id} tone="paper" className="wl-gallery wl-gallery--mosaic" labelledBy={title ? `${id}-title` : undefined} scene={id}>
      <div ref={refEl} className="wl-inner wl-inner--wide">
        <div className="wl-mosaic">
          {ordered.map((image, k) => (
            <MosaicTile key={`${image.url}-${k}`} image={image} slot={MOSAIC_SLOTS[k]!} speed={MOSAIC_SPEED[k]!} progress={progress} sizes={k === 2 ? "(min-width: 64rem) 40rem, 90vw" : "(min-width: 64rem) 24rem, 45vw"} />
          ))}
        </div>
        {extra.length > 0 && (
          <div className="wl-collage" data-cols="3">
            {extra.map((image, k) => (
              <WebReveal key={`${image.url}-x${k}`} className="wl-collage-item">
                <span className="wl-collage-frame" style={{ aspectRatio: photoAspect(image) }}><ScenePhoto image={image} sizes="33vw" /></span>
              </WebReveal>
            ))}
          </div>
        )}
        {title && <WebTintLine id={`${id}-title`} text={title} edit={edit} />}
      </div>
    </WebSection>
  );
}

/** Frase grande que se enciende palabra a palabra al pasar (como la bienvenida). */
export function WebTintLine({ id, text, as: Tag = "h2", edit }: { id?: string; text: string; as?: "h2" | "p"; /** Marca de «Seleccionar» (solo en el editor). */ edit?: EditAttrs }) {
  const { motion: level, container } = useWeb();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, container, offset: ["start 85%", "end 50%"] });
  const words = text.split(/(\s+)/);
  const count = words.filter((w) => w.trim()).length || 1;
  let index = 0;
  return (
    <div ref={ref} className="wl-tint">
      <Tag id={id} className="wl-tint-text font-display" {...edit}>
        {level === "full"
          ? words.map((word, i) => (word.trim() ? <TintWord key={i} progress={scrollYProgress} index={index++} total={count}>{word}</TintWord> : word))
          : text}
      </Tag>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historia: capítulos con polaroids apiladas
// ---------------------------------------------------------------------------

const ORDINALS = ["uno", "dos", "tres", "cuatro", "cinco", "seis"] as const;
const TILTS = [-3, 2.5, -1.5, 3.5] as const;

/**
 * Una columna (el contenedor `.wl` por debajo de 48 rem, el mismo corte que
 * el CSS): el capítulo no es sticky (el texto nunca queda debajo de una foto)
 * y las fotos se retiran hacia un lado dentro de su propio hueco, con el
 * scroll del montón y no del capítulo.
 */
export function chapterIsCompact(wlWidth: number, remPx = 16): boolean {
  return wlWidth < 48 * remPx;
}

/**
 * Tramo de recorrido en el que se retira la foto `index` (la última no se
 * retira: null). Dos columnas: el del capítulo sticky. Una columna: repartido
 * entre 0,15 y 0,9 del paso del montón por la pantalla.
 */
export function peelRange(index: number, total: number, compact: boolean): [number, number] | null {
  if (index >= total - 1) return null;
  if (!compact) return [(index + 0.55) / total, (index + 1) / total];
  const n = total - 1;
  return [0.15 + (0.75 * index) / n, 0.15 + (0.75 * (index + 1)) / n];
}

function StackedPhoto({ progress, image, index, total, sizes, compact }: { progress: MotionValue<number>; image: SceneImage; index: number; total: number; sizes: string; compact: boolean }) {
  const { motion: level } = useWeb();
  const range = peelRange(index, total, compact);
  const [start, end] = range ?? [0, 1];
  const tilt = TILTS[index % TILTS.length]!;
  // Una columna: hacia un lado (alternando), apenas sube; nunca por encima del texto.
  const side = index % 2 === 0 ? -1 : 1;
  const t = (v: number) => (range ? ramp(v, start, end) : 0);
  const x = useTransform(progress, (v) => (compact ? `${side * 70 * t(v)}%` : "0%"));
  const y = useTransform(progress, (v) => `${(compact ? -6 : -150) * t(v)}%`);
  const rotate = useTransform(progress, (v) => tilt + (compact ? side * 12 : -10) * t(v));
  const scale = useTransform(progress, (v) => (compact ? 1 - 0.04 * t(v) : 1));
  const opacity = useTransform(progress, (v) => (range ? 1 - ramp(v, start + (end - start) * (compact ? 0.35 : 0.6), end) : 1));
  const full = level === "full";
  const base = { "--wl-tilt": `${tilt}deg`, "--wl-fan": String(index), zIndex: total - index } as CSSProperties;
  return (
    <m.figure className="wl-polaroid" data-static={full ? undefined : ""} style={full ? { ...base, x, y, rotate, scale, opacity } : base}>
      <span className="wl-polaroid-frame" style={{ aspectRatio: "4 / 3" }}>
        <ScenePhoto image={image} sizes={sizes} />
      </span>
      {image.caption && <figcaption className="wl-polaroid-caption">{image.caption}</figcaption>}
    </m.figure>
  );
}

function Chapter({ chapter, index, sceneId }: { chapter: StoryChapter; index: number; sceneId: string }) {
  const { container } = useWeb();
  const at = useEditAt(sceneId);
  const ref = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, container, offset: ["start 20%", "end 80%"] });
  // Una columna: el recorrido es el del montón (de asomar por abajo a irse por arriba).
  const { scrollYProgress: stackProgress } = useScroll({ target: stackRef, container, offset: ["start 85%", "end 30%"] });
  const photos = chapter.images.length;
  const ordinal = ORDINALS[index] ?? String(index + 1);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const wl = ref.current?.closest<HTMLElement>(".wl");
    if (!wl || typeof ResizeObserver === "undefined") return;
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const ro = new ResizeObserver(([entry]) => setCompact(chapterIsCompact(entry?.contentRect.width ?? wl.clientWidth, remPx)));
    ro.observe(wl);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="wl-chapter" data-first={index === 0 ? "" : undefined} data-photos={photos} style={{ "--wl-photos": String(Math.max(1, photos)) } as CSSProperties}>
      <div className="wl-chapter-sticky" data-wl-center="">
        <div className="wl-chapter-text">
          <WebReveal>
            <p className="wl-chapter-kicker font-display">Capítulo {ordinal}{chapter.title ? ": " : ""}{chapter.title && <span className="wl-chapter-title" {...at(`chapters/${chapter.id}/title`)}>{chapter.title}</span>}</p>
          </WebReveal>
          {chapter.body && (
            <WebReveal delay={80}>
              <p className="wl-chapter-body" {...at(`chapters/${chapter.id}/body`)}>{chapter.body}</p>
            </WebReveal>
          )}
        </div>
        {photos > 0 && (
          <div ref={stackRef} className="wl-stack">
            {chapter.images.map((image, i) => (
              // compact en la key: al pasar de dos columnas a una, cada foto se monta de nuevo con su recorrido.
              <StackedPhoto key={`${compact ? "una" : "dos"}-${image.url}-${i}`} progress={compact ? stackProgress : scrollYProgress} image={image} index={i} total={photos} sizes="(min-width: 64rem) 30rem, 80vw" compact={compact} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function WebStory({ id, title, intro, chapters }: { id: string; title: string; intro: string; chapters: StoryChapter[] }) {
  const at = useEditAt(id);
  const shown = chapters.filter((c) => c.title || c.body || c.images.length > 0);
  if (shown.length === 0) return null;
  const titleId = `${id}-title`;
  return (
    <WebSection id={id} tone="paper" className="wl-story" labelledBy={titleId} scene={id}>
      <div className="wl-inner">
        {intro && <WebTintLine as="p" text={intro} edit={at("intro")} />}
        <WebReveal>
          <h2 id={titleId} className="wl-story-title font-display" {...at("title")}>{title}</h2>
        </WebReveal>
        {shown.map((chapter, i) => (
          <Chapter key={chapter.id} chapter={chapter} index={i} sceneId={id} />
        ))}
      </div>
    </WebSection>
  );
}

// ---------------------------------------------------------------------------
// Cuenta atrás en directo
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Solo pinta tras montar: el servidor no sabe la hora del invitado y los
 * segundos cambiarían entre servidor y cliente. Hasta entonces, nada (la
 * cuenta en días de siempre ya está encima).
 */
export function LiveCountdown({ weddingDate, time, now }: { weddingDate: string; time: string; now: number | null }) {
  // El reloj lo lleva el cartel de la fecha (una sola resta para la línea de días y este reloj).
  if (now === null) return null;
  const left = remainingParts(weddingDate, time, now);
  if (!left) return null;
  const parts: Array<[number, string]> = [
    [left.d, left.d === 1 ? "día" : "días"],
    [left.h, left.h === 1 ? "hora" : "horas"],
    [left.m, left.m === 1 ? "minuto" : "minutos"],
    [left.s, left.s === 1 ? "segundo" : "segundos"],
  ];
  return (
    <p className="wl-clock" aria-live="off" aria-label={parts.map(([n, label]) => `${n} ${label}`).join(", ")}>
      {parts.map(([n, label], i) => (
        <span key={label} className="wl-clock-part">
          {i > 0 && <span aria-hidden="true" className="wl-clock-sep">:</span>}
          <span className="wl-clock-unit">
            <span className="wl-clock-num font-display tabular" aria-hidden="true">{i === 0 ? n : pad(n)}</span>
            <span className="wl-clock-label font-mono" aria-hidden="true">{label}</span>
          </span>
        </span>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Detalles (tarjetas) y preguntas (acordeón)
// ---------------------------------------------------------------------------

function PlusIcon() {
  return <span aria-hidden="true" className="wl-plus" />;
}

function CardLink({ href, label }: { href: string; label: string }) {
  const { mode } = useWeb();
  const text = label || "Ver más";
  return mode === "public" ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="wl-card-link">{text}</a>
  ) : (
    <span aria-disabled="true" className="wl-card-link">{text}</span>
  );
}

export function WebDetails({ id, title, intro, cards }: { id: string; title: string; intro: string; cards: DetailCard[] }) {
  const at = useEditAt(id);
  if (cards.length === 0) return null;
  const titleId = `${id}-title`;
  return (
    <WebSection id={id} tone="surface" className="wl-details" labelledBy={titleId} scene={id}>
      <div className="wl-inner wl-center">
        <WebReveal>
          <h2 id={titleId} className="wl-h2 wl-details-title font-display" {...at("title")}>{title}</h2>
          {intro && <p className="wl-details-intro" {...at("intro")}>{intro}</p>}
        </WebReveal>
        <ul className="wl-cards">
          {cards.map((card, i) => (
            <li key={card.id}>
              <WebReveal delay={Math.min(i, 5) * 60} className="wl-card-reveal">
                <details className="wl-card">
                  <summary className="wl-card-summary">
                    <span className="wl-card-title font-display" {...at(`cards/${card.id}/title`)}>{card.title}</span>
                    {card.teaser && <span className="wl-card-teaser">{card.teaser}</span>}
                    <PlusIcon />
                  </summary>
                  <div className="wl-card-body">
                    {card.body && <p {...at(`cards/${card.id}/body`)}>{card.body}</p>}
                    {card.link && <CardLink href={card.link} label={card.linkLabel} />}
                  </div>
                </details>
              </WebReveal>
            </li>
          ))}
        </ul>
      </div>
    </WebSection>
  );
}

export function WebFaq({ id, title, contact, items, children }: { id: string; title: string; contact: string; items: FaqItem[]; children?: ReactNode }) {
  const at = useEditAt(id);
  if (items.length === 0) return null;
  const titleId = `${id}-title`;
  return (
    <WebSection id={id} tone="paper" className="wl-faq" labelledBy={titleId} scene={id}>
      <div className="wl-inner wl-faq-grid">
        <div className="wl-faq-head" data-wl-center="">
          <WebReveal>
            <h2 id={titleId} className="wl-h2 font-display" {...at("title")}>{title}</h2>
            {contact && <p className="wl-faq-contact" {...at("contact")}>{contact}</p>}
            {children}
          </WebReveal>
        </div>
        <ul className="wl-faq-list">
          {items.map((item, i) => (
            <li key={item.id}>
              <WebReveal delay={Math.min(i, 5) * 50}>
                <details className="wl-faq-item">
                  <summary className="wl-faq-q font-display">
                    <span {...at(`items/${item.id}/question`)}>{item.question}</span>
                    <PlusIcon />
                  </summary>
                  {item.answer && <p className="wl-faq-a" {...at(`items/${item.id}/answer`)}>{item.answer}</p>}
                </details>
              </WebReveal>
            </li>
          ))}
        </ul>
      </div>
    </WebSection>
  );
}

/** Autobuses en la web (8-oct-2026). */
export function WebTransport({ id, title, intro, stops, returnNote }: { id: string; title: string; intro: string; stops: BusStop[]; returnNote: string }) {
  const at = useEditAt(id);
  const titleId = `${id}-title`;
  return (
    <WebSection id={id} tone="paper" className="wl-modules wl-transport" labelledBy={titleId} scene={id}>
      <div className="wl-inner wl-center">
        <WebReveal>
          <h2 id={titleId} className="wl-h2 wl-details-title font-display" {...at("title")}>{title}</h2>
          {intro && <p className="wl-details-intro" {...at("intro")}>{intro}</p>}
        </WebReveal>
        <WebReveal className="wl-modules-body">
          <BusStops stops={stops} returnNote={returnNote} />
        </WebReveal>
      </div>
    </WebSection>
  );
}

/** Alojamiento en la web (8-oct-2026). */
export function WebStay({ id, title, intro, hotels, mode, now }: { id: string; title: string; intro: string; hotels: Hotel[]; mode: InvitationMode; now?: Date }) {
  const at = useEditAt(id);
  if (hotels.length === 0) return null;
  const titleId = `${id}-title`;
  return (
    <WebSection id={id} tone="surface" className="wl-modules wl-stay" labelledBy={titleId} scene={id}>
      <div className="wl-inner wl-center">
        <WebReveal>
          <h2 id={titleId} className="wl-h2 wl-details-title font-display" {...at("title")}>{title}</h2>
          {intro && <p className="wl-details-intro" {...at("intro")}>{intro}</p>}
        </WebReveal>
        <WebReveal className="wl-modules-body">
          <HotelList hotels={hotels} mode={mode} now={now} />
        </WebReveal>
      </div>
    </WebSection>
  );
}
