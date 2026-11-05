"use client";

/**
 * Escenas v2 en la maqueta «Como una Story» (una pantalla por escena, con
 * desplazamiento interno cuando el contenido es largo, como la agenda):
 * historia por capítulos, galería en cuadrícula, detalles y preguntas con
 * <details>. Mismo contenido que la maqueta web (web-scenes.tsx), sin
 * movimiento ligado al scroll.
 */
import type { SceneOf } from "@/lib/site-document";
import type { InvitationMode } from "../types";
import { ScenePhoto, photoAspect } from "./photo";
import { BusStops, HotelList } from "./modules";
import { editPath, editScene } from "../edit-targets";

import "./content.css";

const ORDINALS = ["uno", "dos", "tres", "cuatro", "cinco", "seis"] as const;

export function StoryScene({ scene, edit }: { scene: SceneOf<"story">; edit?: boolean }) {
  const at = (path: string) => editPath(edit, `${scene.id}/${path}`);
  const { title, intro, chapters } = scene.props;
  const shown = chapters.filter((c) => c.title || c.body || c.images.length > 0);
  if (shown.length === 0) return null;
  const titleId = `${scene.id}-title`;
  return (
    <section aria-labelledby={titleId} className="sp-content sp-story mx-auto w-full max-w-[44rem]" {...editScene(edit, scene.id)}>
      {intro && <p className="sp-content-intro font-display" {...at("intro")}>{intro}</p>}
      <h2 id={titleId} className="sp-h2 font-display text-tinta" {...at("title")}>{title}</h2>
      <ol className="sp-chapters">
        {shown.map((chapter, i) => (
          <li key={chapter.id} className="sp-chapter">
            <p className="sp-chapter-kicker font-script text-cava-texto" {...at(`chapters/${chapter.id}/title`)}>
              Capítulo {ORDINALS[i] ?? i + 1}
              {chapter.title ? `: ${chapter.title}` : ""}
            </p>
            {chapter.body && <p className="sp-chapter-body" {...at(`chapters/${chapter.id}/body`)}>{chapter.body}</p>}
            {chapter.images.length > 0 && (
              <ul className="sp-photo-row" data-count={Math.min(chapter.images.length, 2)}>
                {chapter.images.map((image, k) => (
                  <li key={`${image.url}-${k}`} className="sp-polaroid">
                    <span className="sp-photo-frame" style={{ aspectRatio: image.width && image.height && image.width > image.height ? "4 / 3" : "4 / 5" }}>
                      <ScenePhoto image={image} sizes="(min-width: 44rem) 20rem, 45vw" />
                    </span>
                    {image.caption && <span className="sp-photo-caption">{image.caption}</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function GalleryScene({ scene, edit }: { scene: SceneOf<"gallery">; edit?: boolean }) {
  const { title, images } = scene.props;
  if (images.length === 0) return null;
  const titleId = `${scene.id}-title`;
  return (
    <section aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : "Fotos"} className="sp-content sp-gallery mx-auto w-full max-w-[44rem]" {...editScene(edit, scene.id)}>
      {title && <h2 id={titleId} className="sp-content-intro font-display" {...editPath(edit, `${scene.id}/title`)}>{title}</h2>}
      <ul className="sp-photo-grid">
        {images.map((image, k) => (
          <li key={`${image.url}-${k}`}>
            <span className="sp-photo-frame" style={{ aspectRatio: photoAspect(image) }}>
              <ScenePhoto image={image} sizes="(min-width: 44rem) 22rem, 50vw" />
            </span>
            {image.caption && <span className="sp-photo-caption">{image.caption}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DetailsScene({ scene, mode, edit }: { scene: SceneOf<"details">; mode: InvitationMode; edit?: boolean }) {
  const at = (path: string) => editPath(edit, `${scene.id}/${path}`);
  const { title, intro, cards } = scene.props;
  if (cards.length === 0) return null;
  const titleId = `${scene.id}-title`;
  return (
    <section aria-labelledby={titleId} className="sp-content sp-details mx-auto w-full max-w-[44rem]" {...editScene(edit, scene.id)}>
      <h2 id={titleId} className="sp-h2 font-display text-tinta" {...at("title")}>{title}</h2>
      {intro && <p className="sp-content-sub" {...at("intro")}>{intro}</p>}
      <ul className="sp-cards">
        {cards.map((card) => (
          <li key={card.id}>
            <details className="sp-card">
              <summary className="sp-card-summary">
                <span className="sp-card-title font-display" {...at(`cards/${card.id}/title`)}>{card.title}</span>
                {card.teaser && <span className="sp-card-teaser">{card.teaser}</span>}
                <span aria-hidden="true" className="sp-plus" />
              </summary>
              <div className="sp-card-body">
                {card.body && <p {...at(`cards/${card.id}/body`)}>{card.body}</p>}
                {card.link &&
                  (mode === "public" ? (
                    <a href={card.link} target="_blank" rel="noopener noreferrer" className="sp-card-link">{card.linkLabel || "Ver más"}</a>
                  ) : (
                    <span aria-disabled="true" className="sp-card-link">{card.linkLabel || "Ver más"}</span>
                  ))}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FaqScene({ scene, edit }: { scene: SceneOf<"faq">; edit?: boolean }) {
  const at = (path: string) => editPath(edit, `${scene.id}/${path}`);
  const { title, contact, items } = scene.props;
  if (items.length === 0) return null;
  const titleId = `${scene.id}-title`;
  return (
    <section aria-labelledby={titleId} className="sp-content sp-faq mx-auto w-full max-w-[44rem]" {...editScene(edit, scene.id)}>
      <h2 id={titleId} className="sp-h2 font-display text-tinta" {...at("title")}>{title}</h2>
      {contact && <p className="sp-content-sub" {...at("contact")}>{contact}</p>}
      <ul className="sp-faq-list">
        {items.map((item) => (
          <li key={item.id}>
            <details className="sp-faq-item">
              <summary className="sp-faq-q font-display">
                <span {...at(`items/${item.id}/question`)}>{item.question}</span>
                <span aria-hidden="true" className="sp-plus" />
              </summary>
              {item.answer && <p className="sp-faq-a" {...at(`items/${item.id}/answer`)}>{item.answer}</p>}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Autobuses (8-oct-2026): paradas de ida y nota de vuelta. */
export function TransportScene({ scene, edit }: { scene: SceneOf<"transport">; edit?: boolean }) {
  const at = (path: string) => editPath(edit, `${scene.id}/${path}`);
  const { title, intro, stops, returnNote } = scene.props;
  const titleId = `${scene.id}-title`;
  return (
    <section aria-labelledby={titleId} className="sp-content sp-transport mx-auto w-full max-w-[44rem]" {...editScene(edit, scene.id)}>
      <h2 id={titleId} className="sp-h2 font-display text-tinta" {...at("title")}>{title}</h2>
      {intro && <p className="sp-content-sub" {...at("intro")}>{intro}</p>}
      <BusStops stops={stops} returnNote={returnNote} />
    </section>
  );
}

/** Alojamiento (8-oct-2026): hoteles con nota, código, fecha límite y enlace. */
export function StayScene({ scene, mode, now, edit }: { scene: SceneOf<"stay">; mode: InvitationMode; now?: Date; edit?: boolean }) {
  const at = (path: string) => editPath(edit, `${scene.id}/${path}`);
  const { title, intro, hotels } = scene.props;
  if (hotels.length === 0) return null;
  const titleId = `${scene.id}-title`;
  return (
    <section aria-labelledby={titleId} className="sp-content sp-stay mx-auto w-full max-w-[44rem]" {...editScene(edit, scene.id)}>
      <h2 id={titleId} className="sp-h2 font-display text-tinta" {...at("title")}>{title}</h2>
      {intro && <p className="sp-content-sub" {...at("intro")}>{intro}</p>}
      <HotelList hotels={hotels} mode={mode} now={now} />
    </section>
  );
}
