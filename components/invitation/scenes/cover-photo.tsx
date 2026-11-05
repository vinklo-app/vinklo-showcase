"use client";

import { useState } from "react";
import Image from "next/image";

export interface CoverPhotoProps {
  src: string;
  alt: string;
  unoptimized: boolean;
}

/**
 * Foto de portada con salida digna si la imagen ya no existe (borrada del
 * almacenamiento, enlace caducado): en lugar del icono roto y el texto
 * alternativo encima del progreso, queda el fondo de tinta del tema y la
 * portada sigue siendo legible.
 */
export function CoverPhoto({ src, alt, unoptimized }: CoverPhotoProps) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <Image
      src={src}
      alt={alt}
      fill
      priority
      unoptimized={unoptimized}
      sizes="100vw"
      className="sp-cover-img object-cover"
      onError={() => setBroken(true)}
    />
  );
}
