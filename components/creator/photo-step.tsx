"use client";

import { useId } from "react";
import { PHOTO_ACCEPT } from "./photo-prepare";

/**
 * Paso de la foto: elegir (o cambiar/quitar) una foto de la pareja, o seguir
 * con sus iniciales. La miniatura es el mismo object URL que pinta la
 * portada del móvil; nada se sube hasta que exista la boda.
 */
export function PhotoStep({ photoUrl, initials, busy, chosenInitials, onFile, onRemove, onInitials }: {
  photoUrl: string | null;
  initials: string;
  busy: boolean;
  chosenInitials: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
  onInitials: () => void;
}) {
  const inputId = useId();
  const input = <input
    id={inputId}
    className="wb-photo-input"
    type="file"
    accept={PHOTO_ACCEPT}
    onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) onFile(file);
    }}
  />;

  return <div className="wb-photo" data-state={busy ? "busy" : photoUrl ? "photo" : "empty"}>
    {photoUrl
      ? <div className="wb-photo-chosen">
        {/* eslint-disable-next-line @next/next/no-img-element -- blob: local, solo preview */}
        <img src={photoUrl} alt="Vuestra foto elegida" className="wb-photo-thumb" />
        <div className="wb-photo-meta">
          <p>Vuestra foto ya está en la portada.</p>
          <div className="wb-photo-actions">
            {input}
            <label htmlFor={inputId} className="wb-photo-change">Cambiar foto</label>
            <button type="button" className="wb-photo-remove" onClick={onRemove}>Quitar</button>
          </div>
        </div>
      </div>
      : <>
        {input}
        <label htmlFor={inputId} className="wb-photo-pick" aria-busy={busy}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10.5" r="1.75" /><path d="m21 16-5-5-9 8" /></svg>
          <span><strong>{busy ? "Preparando la foto…" : "Elegir una foto"}</strong><small>JPG, PNG o WebP, hasta 25 MB</small></span>
        </label>
      </>}
    {!photoUrl && <button type="button" className="wb-initials" aria-pressed={chosenInitials} onClick={onInitials}>
      <span className="wb-initials-mark" aria-hidden="true">{initials}</span>
      <span>Seguir sin foto, con vuestras iniciales</span>
    </button>}
    <p className="wb-help">La foto se queda en este navegador hasta que creéis la web; entonces la subimos a vuestra portada. Podréis cambiarla después en Ajustes.</p>
  </div>;
}
