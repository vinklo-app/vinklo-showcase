"use client";

/**
 * «Más fotos» del creador (opcional, hasta 6): además de la foto de portada,
 * unas cuantas fotos que forman la galería tras la portada; con 4 o más, la
 * web «Como una web» abre con el mosaico alrededor de la portada (como /demo).
 *
 * Igual que la portada, se quedan en este navegador (IndexedDB) ya reducidas
 * y sin metadatos (`preparePhoto`) hasta que exista la boda; entonces
 * `finishCreatedWedding` las sube de dos en dos. Componente y hook aislados
 * para que el creador solo tenga que conectarlos.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SceneImage } from "@/lib/site-document";
import { mapWithConcurrency, takeSlots } from "@/lib/photo-batch";
import { PHOTO_ACCEPT, preparePhoto, type PreparedPhoto } from "./photo-prepare";
import { clearStoredGallery, loadStoredGallery, saveStoredGallery } from "./photo-store";
import { CREATOR_GALLERY_MAX, CREATOR_MOSAIC_MIN } from "./creator-gallery";
import "./gallery-picker.css";

type Entry = { photo: PreparedPhoto; url: string };

export interface CreatorGallery {
  photos: PreparedPhoto[];
  /** Las mismas fotos como imágenes `blob:` para la vista previa del móvil. */
  localImages: SceneImage[];
  entries: Entry[];
  busy: number;
  error: string | null;
  add(files: File[]): Promise<void>;
  remove(index: number): void;
  /** Vacía la selección y el almacén del navegador. */
  clear(): void;
  /** Borra solo el almacén (tras subirlas). */
  forget(): void;
  /** Ya se miró el almacén del navegador (haya o no fotos): publicar antes las perdería. */
  restored: boolean;
}

export function useCreatorGallery(): CreatorGallery {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const latest = useRef<Entry[]>([]);
  latest.current = entries;

  const commit = useCallback((next: Entry[]) => {
    latest.current = next;
    setEntries(next);
    if (next.length === 0) { void clearStoredGallery(); return; }
    // Si el navegador no deja guardarlas, siguen en esta sesión y se avisa.
    void saveStoredGallery(next.map((e) => e.photo)).then((saved) => { if (!saved) setError("Este navegador no deja guardar estas fotos: si recargáis o volvéis atrás, tendréis que elegirlas otra vez."); });
  }, []);

  useEffect(() => {
    let alive = true;
    void loadStoredGallery().catch(() => [] as PreparedPhoto[]).then((stored) => {
      if (!alive) return;
      setRestored(true);
      if (stored.length === 0 || latest.current.length > 0) return;
      const loaded = stored.slice(0, CREATOR_GALLERY_MAX).map((photo) => ({ photo, url: URL.createObjectURL(photo.blob) }));
      latest.current = loaded;
      setEntries(loaded);
    });
    return () => { alive = false; };
  }, []);
  // Al salir se liberan los object URLs que sigan vivos.
  useEffect(() => () => { for (const e of latest.current) URL.revokeObjectURL(e.url); }, []);

  const add = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const { take, skipped } = takeSlots(files, latest.current.length + busy, CREATOR_GALLERY_MAX);
    if (take.length === 0) { setError(`Ya tenéis ${CREATOR_GALLERY_MAX} fotos: quitad alguna para elegir otra.`); return; }
    setError(null);
    setBusy((n) => n + take.length);
    // De una en una: reducir fotos de 12 Mpx a la vez agota la memoria de un iPhone.
    const settled = await mapWithConcurrency(take, 1, async (file) => {
      try {
        const prepared = await preparePhoto(file);
        if (!prepared.ok) throw new Error(prepared.error);
        return prepared.photo;
      } finally {
        setBusy((n) => n - 1);
      }
    });
    const ready = settled.flatMap((s) => (s.ok ? [{ photo: s.value, url: URL.createObjectURL(s.value.blob) }] : []));
    const failed = settled.flatMap((s) => (s.ok ? [] : [s.error instanceof Error ? s.error.message : ""]));
    const room = CREATOR_GALLERY_MAX - latest.current.length;
    for (const extra of ready.slice(room)) URL.revokeObjectURL(extra.url);
    commit([...latest.current, ...ready.slice(0, Math.max(0, room))]);
    const notes: string[] = [];
    if (failed.length > 0) notes.push(failed.length === 1 ? `Una foto no se ha podido añadir: ${failed[0]}` : `${failed.length} fotos no se han podido añadir. ${failed[0]}`);
    if (skipped > 0) notes.push(`Solo caben ${CREATOR_GALLERY_MAX}: hemos añadido las primeras.`);
    setError(notes.length > 0 ? notes.join(" ") : null);
  }, [busy, commit]);

  const remove = useCallback((index: number) => {
    const gone = latest.current[index];
    if (!gone) return;
    URL.revokeObjectURL(gone.url);
    commit(latest.current.filter((_, k) => k !== index));
  }, [commit]);

  const clear = useCallback(() => {
    for (const e of latest.current) URL.revokeObjectURL(e.url);
    commit([]);
    setError(null);
  }, [commit]);

  const forget = useCallback(() => { void clearStoredGallery(); }, []);

  const photos = useMemo(() => entries.map((e) => e.photo), [entries]);
  const localImages = useMemo(() => entries.map((e, i) => ({ url: e.url, alt: `Foto ${i + 1}`, width: e.photo.width, height: e.photo.height })), [entries]);
  return { photos, localImages, entries, busy, error, add, remove, clear, forget, restored };
}

export function GalleryPicker({ gallery, disabled }: { gallery: CreatorGallery; disabled?: boolean }) {
  const inputId = useId();
  const { entries, busy, error } = gallery;
  const free = CREATOR_GALLERY_MAX - entries.length - busy;
  const count = entries.length;
  const status = busy > 0
    ? `Preparando ${busy === 1 ? "la foto" : `${busy} fotos`}…`
    : count === 0
      ? `Opcional. Hasta ${CREATOR_GALLERY_MAX}; con ${CREATOR_MOSAIC_MIN} o más, la portada se abre en mosaico al recorrer la web.`
      : count < CREATOR_MOSAIC_MIN
        ? `${count} de ${CREATOR_GALLERY_MAX}. Con ${CREATOR_MOSAIC_MIN - count} más, la portada se abre en mosaico.`
        : `${count} de ${CREATOR_GALLERY_MAX}. La portada se abrirá en mosaico.`;

  return <div className="wb-gallery" aria-busy={busy > 0 || undefined}>
    <p className="wb-gallery-title">Más fotos</p>
    <p className="wb-help" role="status">{status}</p>
    {(entries.length > 0 || busy > 0) && <ul className="wb-gallery-grid" aria-label="Fotos de la galería">
      {entries.map((entry, i) => <li key={entry.url} className="wb-gallery-item">
        {/* eslint-disable-next-line @next/next/no-img-element -- blob: local, solo preview */}
        <img src={entry.url} alt={`Foto ${i + 1} de la galería`} />
        <button type="button" className="wb-gallery-remove" disabled={disabled} onClick={() => gallery.remove(i)} aria-label={`Quitar la foto ${i + 1}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </li>)}
      {Array.from({ length: busy }, (_, i) => <li key={`busy-${i}`} className="wb-gallery-item" data-busy="true" aria-hidden="true" />)}
    </ul>}
    {free > 0 && <>
      <input
        id={inputId}
        className="wb-photo-input"
        type="file"
        accept={PHOTO_ACCEPT}
        multiple={free > 1}
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void gallery.add(files);
        }}
      />
      <label htmlFor={inputId} className="wb-gallery-pick">{free > 1 ? "Elegir fotos" : "Elegir foto"}</label>
    </>}
    {error && <p className="wb-error" role="alert">{error}</p>}
  </div>;
}
