"use client";

import { useState, type CSSProperties } from "react";
import Image from "next/image";
import type { SceneImage } from "@/lib/site-document";
import { isOptimizableImage } from "../format";

/**
 * Foto de una escena (historia, galería) con salida digna si la imagen ya no
 * existe: el hueco se queda en el tono de la paleta, sin icono roto. Las
 * fotos publicadas (bucket público) pasan por next/image; las firmadas del
 * borrador y los `blob:` locales se pintan tal cual (`unoptimized`).
 *
 * Ocupa el marco que le dé el padre (`fill`); el padre fija la proporción.
 */
export function ScenePhoto({ image, sizes, className, style }: { image: SceneImage; sizes: string; className?: string; style?: CSSProperties }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span aria-hidden="true" className={`sp-photo-missing ${className ?? ""}`.trim()} style={style} />;
  return (
    <Image
      src={image.url}
      alt={image.alt}
      fill
      sizes={sizes}
      unoptimized={!isOptimizableImage(image.url)}
      className={`sp-photo-img ${className ?? ""}`.trim()}
      style={style}
      onError={() => setBroken(true)}
    />
  );
}

/** Proporción del marco a partir de las dimensiones conocidas (4:5 si no hay). */
export function photoAspect(image: SceneImage): string {
  return image.width && image.height ? `${image.width} / ${image.height}` : "4 / 5";
}
