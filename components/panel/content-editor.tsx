"use client";

/**
 * «Vuestro contenido» (panel › Ajustes › editor, 6-oct-2026): las secciones
 * v2 de la web — historia por capítulos, galería, detalles y preguntas —
 * con sus textos y fotos. Escribe en el borrador vía `onChange` (el
 * SiteEditor guarda con bloqueo optimista); los cambios de texto se agrupan
 * (700 ms) y los estructurales (añadir, quitar, mover, foto) salen al momento.
 * `onLive` entrega cada cambio local sin esperar al guardado, para el móvil
 * de vista previa.
 *
 * Reglas: ningún texto se inventa (los defaults son rótulos de sección);
 * topes del contrato (lib/site-document.ts) en `maxLength` y en los botones
 * de añadir; las fotos se eligen varias a la vez y suben de dos en dos al
 * bucket privado (`upload`, lib/photo-batch.ts), en el orden elegido; aquí
 * solo se guarda su referencia. La portada y la asistencia no se tocan desde
 * aquí: la portada siempre primera, la asistencia siempre la última.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PHOTO_ACCEPT } from "@/components/creator/photo-prepare";
import { PHOTO_UPLOAD_CONCURRENCY, mapWithConcurrency, orderedCommitter, takeSlots } from "@/lib/photo-batch";
import { BedDoubleIcon, BookOpenIcon, BusIcon, ChevronDownIcon, ChevronUpIcon, CircleHelpIcon, EyeIcon, EyeOffIcon, ImagePlusIcon, ImagesIcon, LayoutGridIcon, ListChecksIcon, MessageCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { whatsappNumber } from "@/lib/whatsapp-number";
import {
  CONTENT_SCENE_TYPES,
  SITE_MAX_CHAPTER_IMAGES,
  SITE_MAX_DETAIL_CARDS,
  SITE_MAX_FAQ_ITEMS,
  SITE_MAX_BUS_STOPS,
  SITE_MAX_GALLERY_IMAGES,
  SITE_MAX_HOTELS,
  SITE_MAX_MENU_OPTIONS,
  SITE_MAX_SCENES,
  RSVP_WHATSAPP_INVALID,
  RSVP_WHATSAPP_MAX,
  SITE_MAX_STORY_CHAPTERS,
  detailCardHasContent,
  faqItemHasAnswer,
  type ContentSceneType,
  type Scene,
  type SceneImage,
  type SceneOf,
  type SiteDocument,
} from "@/lib/site-document";

export type ContentUploadResult = { ok: true; image: SceneImage } | { ok: false; error: string };

export interface ContentEditorProps {
  document: SiteDocument;
  disabled?: boolean;
  /** Guarda el documento (el padre encola y aplica el bloqueo optimista). */
  onChange(next: SiteDocument): void;
  /** Cada cambio local, antes de guardar (vista previa). */
  onLive?(next: SiteDocument | null): void;
  /** Sube una foto y devuelve su referencia de borrador o el motivo del fallo (se enseña junto a esa foto). */
  upload(file: File): Promise<ContentUploadResult>;
  /** URL pintable de una referencia (firmada); null mientras llega. */
  thumb(url: string): string | null;
}

const META: Record<ContentSceneType, { label: string; help: string; icon: ReactNode; baseId: string }> = {
  story: { label: "Vuestra historia", help: "Capítulos con texto y fotos apiladas.", icon: <BookOpenIcon aria-hidden="true" />, baseId: "historia" },
  gallery: { label: "Fotos", help: "Un collage que se mueve al bajar.", icon: <ImagesIcon aria-hidden="true" />, baseId: "fotos" },
  details: { label: "Detalles", help: "Viaje, alojamiento, dress code, menú…", icon: <LayoutGridIcon aria-hidden="true" />, baseId: "detalles" },
  faq: { label: "Preguntas", help: "Lo que todo el mundo os pregunta.", icon: <CircleHelpIcon aria-hidden="true" />, baseId: "preguntas" },
  transport: { label: "Autobuses", help: "Paradas y horarios; el formulario pregunta quién lo usa.", icon: <BusIcon aria-hidden="true" />, baseId: "autobuses" },
  stay: { label: "Alojamiento", help: "Hoteles con código y enlace; el formulario pregunta dónde os alojáis.", icon: <BedDoubleIcon aria-hidden="true" />, baseId: "alojamiento" },
};
/** Módulos que solo pueden estar una vez (el contrato los trata como únicos). */
const SINGLE: ReadonlySet<ContentSceneType> = new Set(["transport", "stay"]);

const DEBOUNCE_MS = 700;

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function itemId(prefix: string, items: ReadonlyArray<{ id: string }>): string {
  return uniqueId(`${prefix}-${items.length + 1}`, new Set(items.map((i) => i.id)));
}

function newScene(type: ContentSceneType, taken: Set<string>): Scene {
  const id = uniqueId(META[type].baseId, taken);
  switch (type) {
    case "story":
      return { id, type, enabled: true, props: { title: "Nuestra historia", intro: "", chapters: [{ id: "c-1", title: "", body: "", images: [] }] } };
    case "gallery":
      return { id, type, enabled: true, props: { title: "", images: [] } };
    case "details":
      return { id, type, enabled: true, props: { title: "Algunos detalles más", intro: "", cards: [{ id: "d-1", title: "", teaser: "", body: "", linkLabel: "" }] } };
    case "faq":
      return { id, type, enabled: true, props: { title: "Preguntas y respuestas", contact: "", items: [{ id: "q-1", question: "", answer: "" }] } };
    case "transport":
      return { id, type, enabled: true, props: { title: "Autobuses", intro: "", stops: [], returnNote: "", ask: true } };
    case "stay":
      return { id, type, enabled: true, props: { title: "Dónde alojarse", intro: "", hotels: [], ask: true } };
  }
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Pie de foto: vacío = sin la clave (el JSON de las fotos sin pie no cambia). */
function withCaption(image: SceneImage, caption: string): SceneImage {
  const rest = { ...image };
  delete rest.caption;
  return caption ? { ...rest, caption } : rest;
}

function withLink<T extends { link?: string }>(card: T, link: string): T {
  const rest = { ...card };
  delete rest.link;
  return link ? { ...rest, link } : rest;
}

function isContent(scene: Scene): scene is SceneOf<ContentSceneType> {
  return (CONTENT_SCENE_TYPES as readonly string[]).includes(scene.type);
}

export function ContentEditor({ document, disabled, onChange, onLive, upload, thumb }: ContentEditorProps) {
  const [doc, setDoc] = useState(document);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(doc);
  latest.current = doc;

  // El borrador del padre manda cuando aquí no hay cambios a medias.
  useEffect(() => {
    if (!dirty.current) setDoc(document);
  }, [document]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function flush() {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    onChange(latest.current);
    onLive?.(null);
  }

  function update(next: SiteDocument, immediate = false) {
    setDoc(next);
    latest.current = next;
    dirty.current = true;
    onLive?.(next);
    window.clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = window.setTimeout(flush, DEBOUNCE_MS);
  }

  function replaceScene(id: string, scene: Scene, immediate = false) {
    update({ ...doc, scenes: doc.scenes.map((s) => (s.id === id ? scene : s)) }, immediate);
  }

  /**
   * Cambio sobre el documento MÁS RECIENTE (no el del render): las fotos de
   * una tanda llegan en momentos distintos y cada una debe sumarse a lo que
   * ya haya, incluidas las anteriores de la misma tanda.
   */
  function patchScene(id: string, fn: (scene: Scene) => Scene) {
    const current = latest.current;
    update({ ...current, scenes: current.scenes.map((s) => (s.id === id ? fn(s) : s)) }, true);
  }

  function addSection(type: ContentSceneType) {
    const taken = new Set(doc.scenes.map((s) => s.id));
    const scene = newScene(type, taken);
    // Historia y fotos van arriba (tras la portada y las que ya haya de ese
    // tipo); detalles y preguntas, al final, antes de la asistencia (siempre
    // la última). Después se pueden mover.
    const scenes = [...doc.scenes];
    let at: number;
    if (type === "story" || type === "gallery") {
      at = 1;
      while (at < scenes.length && (scenes[at]!.type === "gallery" || scenes[at]!.type === "story")) at++;
    } else {
      const rsvpIndex = scenes.findIndex((s) => s.type === "rsvp");
      at = rsvpIndex === -1 ? scenes.length : rsvpIndex;
    }
    scenes.splice(at, 0, scene);
    update({ ...doc, scenes }, true);
  }

  function removeSection(id: string) {
    update({ ...doc, scenes: doc.scenes.filter((s) => s.id !== id) }, true);
  }

  function moveSection(id: string, dir: -1 | 1) {
    const from = doc.scenes.findIndex((s) => s.id === id);
    const to = from + dir;
    // Nunca por delante de la portada ni por detrás de la asistencia.
    if (to < 1 || to >= doc.scenes.length || doc.scenes[to]?.type === "rsvp") return;
    update({ ...doc, scenes: move(doc.scenes, from, to) }, true);
  }

  const sections = doc.scenes.filter(isContent);
  const full = doc.scenes.length >= SITE_MAX_SCENES;

  return (
    <div className="pn-content">
      {sections.length === 0 && <p className="pn-help">Todavía no habéis añadido secciones. Empezad por vuestra historia o unas fotos.</p>}
      {sections.map((scene) => {
        const index = doc.scenes.findIndex((s) => s.id === scene.id);
        const canUp = index > 1;
        const canDown = index < doc.scenes.length - 1 && doc.scenes[index + 1]?.type !== "rsvp";
        return (
          <SectionCard
            key={scene.id}
            scene={scene}
            disabled={disabled}
            canUp={canUp}
            canDown={canDown}
            onMove={(dir) => moveSection(scene.id, dir)}
            onRemove={() => removeSection(scene.id)}
            onToggle={() => replaceScene(scene.id, { ...scene, enabled: !scene.enabled } as Scene, true)}
            onBlur={flush}
          >
            {scene.type === "story" && <StoryFields scene={scene} disabled={disabled} upload={upload} thumb={thumb} onChange={(next, now) => replaceScene(scene.id, next, now)} onPatch={(fn) => patchScene(scene.id, fn)} />}
            {scene.type === "gallery" && <GalleryFields scene={scene} disabled={disabled} upload={upload} thumb={thumb} onChange={(next, now) => replaceScene(scene.id, next, now)} onPatch={(fn) => patchScene(scene.id, fn)} />}
            {scene.type === "details" && <DetailsFields scene={scene} disabled={disabled} onChange={(next, now) => replaceScene(scene.id, next, now)} />}
            {scene.type === "faq" && <FaqFields scene={scene} disabled={disabled} onChange={(next, now) => replaceScene(scene.id, next, now)} />}
            {scene.type === "transport" && <TransportFields scene={scene} disabled={disabled} onChange={(next, now) => replaceScene(scene.id, next, now)} />}
            {scene.type === "stay" && <StayFields scene={scene} disabled={disabled} onChange={(next, now) => replaceScene(scene.id, next, now)} />}
          </SectionCard>
        );
      })}
      <div className="pn-content-add" aria-label="Añadir una sección">
        {CONTENT_SCENE_TYPES.map((type) => (
          <button key={type} type="button" className="pn-chip pn-press" disabled={disabled || full || (SINGLE.has(type) && doc.scenes.some((s) => s.type === type))} onClick={() => addSection(type)}>
            {META[type].icon}
            {META[type].label}
          </button>
        ))}
      </div>
      {full && <p className="pn-help">La web ya tiene el máximo de secciones ({SITE_MAX_SCENES}). Quitad una para añadir otra.</p>}
      <RsvpQuestions doc={doc} disabled={disabled} onChange={(next, now) => update(next, now)} onBlur={flush} />
      {/* key: si el documento cambia desde fuera (restaurar, deshacer), el campo vuelve a leerlo. */}
      <RsvpContact key={doc.scenes.find((s): s is SceneOf<"rsvp"> => s.type === "rsvp")?.props.whatsapp ?? ""} doc={doc} disabled={disabled} onChange={(next, now) => update(next, now)} onBlur={flush} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de sección
// ---------------------------------------------------------------------------

function SectionCard({ scene, disabled, canUp, canDown, onMove, onRemove, onToggle, onBlur, children }: {
  scene: SceneOf<ContentSceneType>;
  disabled?: boolean;
  canUp: boolean;
  canDown: boolean;
  onMove(dir: -1 | 1): void;
  onRemove(): void;
  onToggle(): void;
  onBlur(): void;
  children: ReactNode;
}) {
  const meta = META[scene.type];
  const count =
    scene.type === "story" ? `${scene.props.chapters.length} ${scene.props.chapters.length === 1 ? "capítulo" : "capítulos"}`
    : scene.type === "gallery" ? `${scene.props.images.length} ${scene.props.images.length === 1 ? "foto" : "fotos"}`
    : scene.type === "details" ? `${scene.props.cards.length} ${scene.props.cards.length === 1 ? "tarjeta" : "tarjetas"}`
    : scene.type === "transport" ? `${scene.props.stops.length} ${scene.props.stops.length === 1 ? "parada" : "paradas"}`
    : scene.type === "stay" ? `${scene.props.hotels.length} ${scene.props.hotels.length === 1 ? "hotel" : "hoteles"}`
    : `${scene.props.items.length} ${scene.props.items.length === 1 ? "pregunta" : "preguntas"}`;
  // Plantillas del creador sin rellenar: existen aquí, pero los invitados no las ven hasta que tengan texto.
  const pending =
    scene.type === "faq" ? scene.props.items.filter((item) => !faqItemHasAnswer(item)).length
    : scene.type === "details" ? scene.props.cards.filter((card) => !detailCardHasContent(card)).length
    : 0;
  const pendingNote = pending === 0 ? "" : scene.type === "faq" ? ` · ${pending} sin respuesta (no se ven)` : ` · ${pending} sin texto (no se ven)`;
  const title = scene.type === "gallery" ? scene.props.title || meta.label : scene.props.title || meta.label;
  return (
    <details className="pn-section-card" data-off={scene.enabled ? undefined : "true"} onBlur={onBlur}>
      <summary className="pn-section-head">
        <span className="pn-section-icon">{meta.icon}</span>
        <span className="pn-section-title">
          <b>{title}</b>
          <small>{meta.label} · {count}{pendingNote}{scene.enabled ? "" : " · oculta"}</small>
        </span>
        <ChevronDownIcon aria-hidden="true" className="pn-section-chevron size-4" />
      </summary>
      <div className="pn-section-body">
        {children}
        <div className="pn-section-tools">
          <button type="button" className="pn-icon-btn pn-press" disabled={disabled || !canUp} onClick={onMove.bind(null, -1)} aria-label="Subir la sección"><ChevronUpIcon aria-hidden="true" /></button>
          <button type="button" className="pn-icon-btn pn-press" disabled={disabled || !canDown} onClick={onMove.bind(null, 1)} aria-label="Bajar la sección"><ChevronDownIcon aria-hidden="true" /></button>
          <button type="button" className="pn-icon-btn pn-press" disabled={disabled} onClick={onToggle} aria-pressed={!scene.enabled} aria-label={scene.enabled ? "Ocultar la sección" : "Mostrar la sección"}>
            {scene.enabled ? <EyeIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />}
          </button>
          <button type="button" className="pn-link pn-press" disabled={disabled} onClick={onRemove}>Quitar la sección</button>
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="pn-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function ItemHead({ label, index, total, disabled, onMove, onRemove }: { label: string; index: number; total: number; disabled?: boolean; onMove(dir: -1 | 1): void; onRemove(): void }) {
  return (
    <div className="pn-item-head">
      <span className="pn-label">{label} {index + 1}</span>
      <button type="button" className="pn-icon-btn pn-press" disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label={`Subir ${label.toLowerCase()} ${index + 1}`}><ChevronUpIcon aria-hidden="true" /></button>
      <button type="button" className="pn-icon-btn pn-press" disabled={disabled || index === total - 1} onClick={() => onMove(1)} aria-label={`Bajar ${label.toLowerCase()} ${index + 1}`}><ChevronDownIcon aria-hidden="true" /></button>
      <button type="button" className="pn-icon-btn pn-icon-btn--danger pn-press" disabled={disabled} onClick={onRemove} aria-label={`Quitar ${label.toLowerCase()} ${index + 1}`}><Trash2Icon aria-hidden="true" /></button>
    </div>
  );
}

type PendingPhoto = { key: string; local: string; status: "waiting" | "uploading" | "done" | "error"; error?: string };
let pendingSeq = 0;

/**
 * Miniaturas con pie de foto, quitar y añadir. Se pueden elegir varias a la
 * vez (hasta llenar la fila): cada una enseña su hueco mientras sube, suben
 * de dos en dos, entran en el orden elegido y un fallo se explica junto a su
 * foto sin perder las demás.
 */
function PhotoRow({ images, max, disabled, upload, thumb, onChange, onAppend, label }: {
  images: SceneImage[];
  max: number;
  disabled?: boolean;
  upload(file: File): Promise<ContentUploadResult>;
  thumb(url: string): string | null;
  onChange(images: SceneImage[], immediate: boolean): void;
  /** Añade fotos al final sobre el documento más reciente (no sobre `images`, que puede ir por detrás). */
  onAppend(images: SceneImage[]): void;
  label: string;
}) {
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [overflow, setOverflow] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const objectUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrls.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); };
  }, []);
  // Huecos ocupados: fotos guardadas + las que aún suben (una segunda tanda no se pasa del tope).
  const inFlight = pending.filter((p) => p.status !== "error").length;
  const used = images.length + inFlight;
  const free = Math.max(0, max - used);

  function release(keys: ReadonlySet<string>) {
    if (keys.size === 0) return;
    setPending((list) => list.filter((p) => {
      if (!keys.has(p.key)) return true;
      URL.revokeObjectURL(p.local);
      objectUrls.current.delete(p.local);
      return false;
    }));
  }
  const mark = (key: string, patch: Partial<PendingPhoto>) => setPending((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    const { take, skipped } = takeSlots(files, used, max);
    setOverflow(skipped === 0 ? null
      : take.length === 0 ? `Ya no caben más fotos aquí (máximo ${max}).`
        : `Solo cabían ${take.length === 1 ? "una foto más" : `${take.length} fotos más`} (máximo ${max}): hemos añadido ${take.length === 1 ? "la primera" : `las ${take.length} primeras`}.`);
    if (take.length === 0) return;
    const batch: PendingPhoto[] = take.map((file) => {
      const local = URL.createObjectURL(file);
      objectUrls.current.add(local);
      return { key: `p${++pendingSeq}`, local, status: "waiting" };
    });
    setPending((list) => [...list, ...batch]);
    // Cada foto entra cuando ella y las anteriores de la tanda han terminado.
    const commit = orderedCommitter<SceneImage | null>(take.length, (values, from) => {
      const added = values.filter((v): v is SceneImage => v !== null);
      if (added.length > 0) onAppend(added);
      release(new Set(batch.slice(from, from + values.length).filter((_, k) => values[k] !== null).map((p) => p.key)));
    });
    await mapWithConcurrency(take, PHOTO_UPLOAD_CONCURRENCY, async (file, i) => {
      const key = batch[i]!.key;
      mark(key, { status: "uploading" });
      let result: ContentUploadResult;
      try { result = await upload(file); } catch { result = { ok: false, error: "No hemos podido subir la foto. Probad de nuevo." }; }
      mark(key, result.ok ? { status: "done" } : { status: "error", error: result.error });
      commit(i, result.ok ? result.image : null);
    });
  }

  return (
    <div className="grid gap-2">
      <div className="pn-thumbs" role="group" aria-label={label}>
        {images.map((image, i) => {
          const src = thumb(image.url);
          return (
            <div key={`${image.url}-${i}`} className="pn-thumb">
              <div className="pn-thumb-img" data-busy={src ? undefined : "true"}>
                {/* eslint-disable-next-line @next/next/no-img-element -- miniatura firmada o local, sin optimizar */}
                {src && <img src={src} alt="" />}
                <button type="button" className="pn-icon-btn pn-icon-btn--danger pn-thumb-remove pn-press" disabled={disabled} onClick={() => onChange(images.filter((_, k) => k !== i), true)} aria-label={`Quitar la foto ${i + 1}`}>
                  <Trash2Icon aria-hidden="true" />
                </button>
              </div>
              <input type="text" maxLength={120} placeholder="Pie de foto" aria-label={`Pie de la foto ${i + 1}`} value={image.caption ?? ""} disabled={disabled}
                onChange={(e) => onChange(images.map((img, k) => (k === i ? withCaption(img, e.target.value) : img)), false)} />
            </div>
          );
        })}
        {pending.map((p) => (
          <div key={p.key} className="pn-thumb">
            <div className="pn-thumb-img" data-busy={p.status === "error" ? undefined : "true"} data-failed={p.status === "error" ? "true" : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element -- foto local mientras sube */}
              <img src={p.local} alt="" />
              {p.status === "error" && (
                <button type="button" className="pn-icon-btn pn-icon-btn--danger pn-thumb-remove pn-press" onClick={() => release(new Set([p.key]))} aria-label="Descartar la foto que no se ha podido subir">
                  <Trash2Icon aria-hidden="true" />
                </button>
              )}
            </div>
            {p.status === "error"
              ? <span className="pn-help pn-thumb-error" role="alert">{p.error}</span>
              : <span className="pn-help">{p.status === "waiting" ? "En cola…" : p.status === "uploading" ? "Subiendo…" : "Lista"}</span>}
          </div>
        ))}
        {free > 0 && (
          <>
            <input ref={input} id={id} type="file" accept={PHOTO_ACCEPT} multiple={free > 1} className="sr-only" tabIndex={-1}
              onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void onFiles(files); }} />
            <button type="button" className="pn-thumb-add pn-press" disabled={disabled} onClick={() => input.current?.click()}>
              <ImagePlusIcon aria-hidden="true" />
              <span>{free > 1 ? "Elegir fotos" : "Elegir foto"}{free > 1 && <small className="pn-thumb-add-hint">Hasta {free}</small>}</span>
            </button>
          </>
        )}
      </div>
      {inFlight > 0 && <p className="sr-only" role="status">Subiendo {inFlight === 1 ? "una foto" : `${inFlight} fotos`}…</p>}
      {overflow && <p className="pn-help" role="status">{overflow}</p>}
    </div>
  );
}

type FieldsProps<T extends ContentSceneType> = { scene: SceneOf<T>; disabled?: boolean; onChange(next: Scene, immediate: boolean): void };

/** Cambio sobre la versión más reciente de la escena (fotos que llegan de una tanda). */
type PatchProps = { onPatch(fn: (scene: Scene) => Scene): void };

function StoryFields({ scene, disabled, upload, thumb, onChange, onPatch }: FieldsProps<"story"> & Pick<ContentEditorProps, "upload" | "thumb"> & PatchProps) {
  const { title, intro, chapters } = scene.props;
  const set = (props: Partial<typeof scene.props>, now = false) => onChange({ ...scene, props: { ...scene.props, ...props } }, now);
  return (
    <>
      <div className="pn-fields-2">
        <Field label="Título de la sección"><input type="text" maxLength={80} value={title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Frase de entrada" hint="Opcional. Se enciende palabra a palabra al bajar."><input type="text" maxLength={200} value={intro} disabled={disabled} placeholder="Os invitamos a celebrar la historia de…" onChange={(e) => set({ intro: e.target.value })} /></Field>
      </div>
      <div className="pn-items">
        {chapters.map((chapter, i) => (
          <div key={chapter.id} className="pn-item">
            <ItemHead label="Capítulo" index={i} total={chapters.length} disabled={disabled} onMove={(dir) => set({ chapters: move(chapters, i, i + dir) }, true)} onRemove={() => set({ chapters: chapters.filter((_, k) => k !== i) }, true)} />
            <Field label="Título del capítulo"><input type="text" maxLength={80} value={chapter.title} disabled={disabled} placeholder="Cómo nos conocimos" onChange={(e) => set({ chapters: chapters.map((c, k) => (k === i ? { ...c, title: e.target.value } : c)) })} /></Field>
            <Field label="Texto"><textarea rows={3} maxLength={600} value={chapter.body} disabled={disabled} onChange={(e) => set({ chapters: chapters.map((c, k) => (k === i ? { ...c, body: e.target.value } : c)) })} /></Field>
            <PhotoRow label={`Fotos del capítulo ${i + 1}`} images={chapter.images} max={SITE_MAX_CHAPTER_IMAGES} disabled={disabled} upload={upload} thumb={thumb}
              onChange={(images, now) => set({ chapters: chapters.map((c, k) => (k === i ? { ...c, images } : c)) }, now)}
              onAppend={(added) => onPatch((s) => (s.type === "story" ? { ...s, props: { ...s.props, chapters: s.props.chapters.map((c) => (c.id === chapter.id ? { ...c, images: [...c.images, ...added].slice(0, SITE_MAX_CHAPTER_IMAGES) } : c)) } } : s))} />
          </div>
        ))}
      </div>
      <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press justify-self-start" disabled={disabled || chapters.length >= SITE_MAX_STORY_CHAPTERS}
        onClick={() => set({ chapters: [...chapters, { id: itemId("c", chapters), title: "", body: "", images: [] }] }, true)}>
        <PlusIcon aria-hidden="true" className="size-4" />Añadir capítulo
      </button>
    </>
  );
}

function GalleryFields({ scene, disabled, upload, thumb, onChange, onPatch }: FieldsProps<"gallery"> & Pick<ContentEditorProps, "upload" | "thumb"> & PatchProps) {
  const { title, images } = scene.props;
  const set = (props: Partial<typeof scene.props>, now = false) => onChange({ ...scene, props: { ...scene.props, ...props } }, now);
  return (
    <>
      <Field label="Frase bajo las fotos" hint="Opcional. Hasta 12 fotos; se colocan en columnas que se mueven al bajar."><input type="text" maxLength={80} value={title} disabled={disabled} placeholder="Os invitamos a celebrar la historia de…" onChange={(e) => set({ title: e.target.value })} /></Field>
      <PhotoRow label="Fotos de la galería" images={images} max={SITE_MAX_GALLERY_IMAGES} disabled={disabled} upload={upload} thumb={thumb} onChange={(next, now) => set({ images: next }, now)}
        onAppend={(added) => onPatch((s) => (s.type === "gallery" ? { ...s, props: { ...s.props, images: [...s.props.images, ...added].slice(0, SITE_MAX_GALLERY_IMAGES) } } : s))} />
    </>
  );
}

function DetailsFields({ scene, disabled, onChange }: FieldsProps<"details">) {
  const { title, intro, cards } = scene.props;
  const set = (props: Partial<typeof scene.props>, now = false) => onChange({ ...scene, props: { ...scene.props, ...props } }, now);
  const patch = (i: number, p: Partial<(typeof cards)[number]>) => set({ cards: cards.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  return (
    <>
      <div className="pn-fields-2">
        <Field label="Título de la sección"><input type="text" maxLength={80} value={title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Frase de entrada"><input type="text" maxLength={200} value={intro} disabled={disabled} placeholder="Lo práctico para que el fin de semana sea fácil." onChange={(e) => set({ intro: e.target.value })} /></Field>
      </div>
      <div className="pn-items">
        {cards.map((card, i) => (
          <div key={card.id} className="pn-item">
            <ItemHead label="Tarjeta" index={i} total={cards.length} disabled={disabled} onMove={(dir) => set({ cards: move(cards, i, i + dir) }, true)} onRemove={() => set({ cards: cards.filter((_, k) => k !== i) }, true)} />
            <div className="pn-fields-2">
              <Field label="Título"><input type="text" maxLength={80} value={card.title} disabled={disabled} placeholder="Viaje y alojamiento" required onChange={(e) => patch(i, { title: e.target.value })} /></Field>
              <Field label="Resumen" hint="Se ve con la tarjeta cerrada."><input type="text" maxLength={120} value={card.teaser} disabled={disabled} placeholder="Cómo llegar y dónde dormir." onChange={(e) => patch(i, { teaser: e.target.value })} /></Field>
            </div>
            <Field label="Texto" hint="Se ve al abrir la tarjeta."><textarea rows={3} maxLength={800} value={card.body} disabled={disabled} onChange={(e) => patch(i, { body: e.target.value })} /></Field>
            <div className="pn-fields-2">
              <Field label="Enlace" hint="Opcional, empieza por https://"><input type="url" maxLength={2048} value={card.link ?? ""} disabled={disabled} placeholder="https://" onChange={(e) => set({ cards: cards.map((c, k) => (k === i ? withLink(c, e.target.value) : c)) })} /></Field>
              <Field label="Texto del enlace"><input type="text" maxLength={40} value={card.linkLabel} disabled={disabled} placeholder="Ver el hotel" onChange={(e) => patch(i, { linkLabel: e.target.value })} /></Field>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press justify-self-start" disabled={disabled || cards.length >= SITE_MAX_DETAIL_CARDS}
        onClick={() => set({ cards: [...cards, { id: itemId("d", cards), title: "", teaser: "", body: "", linkLabel: "" }] }, true)}>
        <PlusIcon aria-hidden="true" className="size-4" />Añadir tarjeta
      </button>
    </>
  );
}

function FaqFields({ scene, disabled, onChange }: FieldsProps<"faq">) {
  const { title, contact, items } = scene.props;
  const set = (props: Partial<typeof scene.props>, now = false) => onChange({ ...scene, props: { ...scene.props, ...props } }, now);
  const patch = (i: number, p: Partial<(typeof items)[number]>) => set({ items: items.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  return (
    <>
      <div className="pn-fields-2">
        <Field label="Título de la sección"><input type="text" maxLength={80} value={title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Cómo contactaros" hint="Opcional."><input type="text" maxLength={160} value={contact} disabled={disabled} placeholder="¿Otra duda? Escríbenos por WhatsApp." onChange={(e) => set({ contact: e.target.value })} /></Field>
      </div>
      <div className="pn-items">
        {items.map((item, i) => (
          <div key={item.id} className="pn-item">
            <ItemHead label="Pregunta" index={i} total={items.length} disabled={disabled} onMove={(dir) => set({ items: move(items, i, i + dir) }, true)} onRemove={() => set({ items: items.filter((_, k) => k !== i) }, true)} />
            <Field label="Pregunta"><input type="text" maxLength={160} value={item.question} disabled={disabled} placeholder="¿Hay aparcamiento?" required onChange={(e) => patch(i, { question: e.target.value })} /></Field>
            <Field label="Respuesta" hint={item.answer.trim() ? undefined : "Sin respuesta, los invitados no ven esta pregunta."}><textarea rows={2} maxLength={800} value={item.answer} disabled={disabled} onChange={(e) => patch(i, { answer: e.target.value })} /></Field>
          </div>
        ))}
      </div>
      <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press justify-self-start" disabled={disabled || items.length >= SITE_MAX_FAQ_ITEMS}
        onClick={() => set({ items: [...items, { id: itemId("q", items), question: "", answer: "" }] }, true)}>
        <PlusIcon aria-hidden="true" className="size-4" />Añadir pregunta
      </button>
    </>
  );
}

function TransportFields({ scene, disabled, onChange }: FieldsProps<"transport">) {
  const { title, intro, stops, returnNote, ask } = scene.props;
  const set = (props: Partial<typeof scene.props>, now = false) => onChange({ ...scene, props: { ...scene.props, ...props } }, now);
  const patch = (i: number, p: Partial<(typeof stops)[number]>) => set({ stops: stops.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  return (
    <>
      <div className="pn-fields-2">
        <Field label="Título de la sección"><input type="text" maxLength={80} value={title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Frase de entrada" hint="Opcional."><input type="text" maxLength={200} value={intro} disabled={disabled} placeholder="Ponemos autobuses para que nadie tenga que conducir." onChange={(e) => set({ intro: e.target.value })} /></Field>
      </div>
      <div className="pn-items">
        {stops.map((stop, i) => (
          <div key={stop.id} className="pn-item">
            <ItemHead label="Parada" index={i} total={stops.length} disabled={disabled} onMove={(dir) => set({ stops: move(stops, i, i + dir) }, true)} onRemove={() => set({ stops: stops.filter((_, k) => k !== i) }, true)} />
            <div className="pn-fields-2">
              <Field label="Parada"><input type="text" maxLength={80} value={stop.name} disabled={disabled} placeholder="Madrid, Plaza de Castilla" required onChange={(e) => patch(i, { name: e.target.value })} /></Field>
              <Field label="Hora de salida"><input type="time" value={stop.time} disabled={disabled} onChange={(e) => patch(i, { time: e.target.value })} /></Field>
            </div>
            <Field label="Punto exacto" hint="Opcional."><input type="text" maxLength={160} value={stop.place} disabled={disabled} placeholder="Frente a la salida 3 del metro" onChange={(e) => patch(i, { place: e.target.value })} /></Field>
          </div>
        ))}
      </div>
      <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press justify-self-start" disabled={disabled || stops.length >= SITE_MAX_BUS_STOPS}
        onClick={() => set({ stops: [...stops, { id: itemId("p", stops), name: "", time: "", place: "" }] }, true)}>
        <PlusIcon aria-hidden="true" className="size-4" />Añadir parada de ida
      </button>
      <Field label="Vuelta" hint="Horarios y desde dónde salen."><input type="text" maxLength={200} value={returnNote} disabled={disabled} placeholder="A la 01:00 y a las 03:30 desde la finca" onChange={(e) => set({ returnNote: e.target.value })} /></Field>
      <label className="pn-optrow">
        <input type="checkbox" checked={ask} disabled={disabled} onChange={(e) => set({ ask: e.target.checked }, true)} />
        <span>Preguntar a cada invitado si usará el autobús (ida, vuelta o los dos, y desde qué parada)</span>
      </label>
    </>
  );
}

function StayFields({ scene, disabled, onChange }: FieldsProps<"stay">) {
  const { title, intro, hotels, ask } = scene.props;
  const set = (props: Partial<typeof scene.props>, now = false) => onChange({ ...scene, props: { ...scene.props, ...props } }, now);
  const patch = (i: number, p: Partial<(typeof hotels)[number]>) => set({ hotels: hotels.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  return (
    <>
      <div className="pn-fields-2">
        <Field label="Título de la sección"><input type="text" maxLength={80} value={title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Frase de entrada" hint="Opcional."><input type="text" maxLength={200} value={intro} disabled={disabled} placeholder="Hemos hablado con estos hoteles para que os salga mejor." onChange={(e) => set({ intro: e.target.value })} /></Field>
      </div>
      <div className="pn-items">
        {hotels.map((hotel, i) => (
          <div key={hotel.id} className="pn-item">
            <ItemHead label="Hotel" index={i} total={hotels.length} disabled={disabled} onMove={(dir) => set({ hotels: move(hotels, i, i + dir) }, true)} onRemove={() => set({ hotels: hotels.filter((_, k) => k !== i) }, true)} />
            <Field label="Hotel"><input type="text" maxLength={80} value={hotel.name} disabled={disabled} placeholder="Hotel Los Olivos" required onChange={(e) => patch(i, { name: e.target.value })} /></Field>
            <Field label="Nota" hint="Opcional: distancia, precio, cómo reservar…"><textarea rows={2} maxLength={300} value={hotel.note} disabled={disabled} placeholder="A 5 minutos de la finca. Llamad y decid que venís a la boda." onChange={(e) => patch(i, { note: e.target.value })} /></Field>
            <div className="pn-fields-2">
              <Field label="Código de descuento" hint="Opcional."><input type="text" maxLength={40} value={hotel.code} disabled={disabled} placeholder="BODALYJ" onChange={(e) => patch(i, { code: e.target.value })} /></Field>
              <Field label="Reservar antes del" hint="Opcional."><input type="date" value={hotel.bookBy} disabled={disabled} onChange={(e) => patch(i, { bookBy: e.target.value })} /></Field>
            </div>
            <Field label="Enlace a su web" hint="Opcional, empieza por https://"><input type="url" maxLength={2048} value={hotel.link ?? ""} disabled={disabled} placeholder="https://" onChange={(e) => set({ hotels: hotels.map((c, k) => (k === i ? withLink(c, e.target.value) : c)) })} /></Field>
          </div>
        ))}
      </div>
      <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press justify-self-start" disabled={disabled || hotels.length >= SITE_MAX_HOTELS}
        onClick={() => set({ hotels: [...hotels, { id: itemId("h", hotels), name: "", note: "", code: "", bookBy: "" }] }, true)}>
        <PlusIcon aria-hidden="true" className="size-4" />Añadir hotel
      </button>
      <label className="pn-optrow">
        <input type="checkbox" checked={ask} disabled={disabled} onChange={(e) => set({ ask: e.target.checked }, true)} />
        <span>Preguntar a cada invitado dónde se aloja (en uno de vuestros hoteles, en otro sitio o en ninguno)</span>
      </label>
    </>
  );
}

/** Preguntas extra del formulario de asistencia (viven en la escena rsvp). */
function RsvpQuestions({ doc, disabled, onChange, onBlur }: { doc: SiteDocument; disabled?: boolean; onChange(next: SiteDocument, immediate: boolean): void; onBlur(): void }) {
  const rsvp = doc.scenes.find((s): s is SceneOf<"rsvp"> => s.type === "rsvp");
  if (!rsvp) return null;
  const menu = rsvp.props.menuOptions ?? [];
  const setProps = (props: Partial<typeof rsvp.props>, now = false) => {
    const nextProps = { ...rsvp.props, ...props };
    // Apagado = sin la clave: el JSON de las webs sin preguntas no cambia.
    for (const key of ["song", "kids"] as const) if (!nextProps[key]) delete nextProps[key];
    if (nextProps.menuOptions && nextProps.menuOptions.length === 0) delete nextProps.menuOptions;
    onChange({ ...doc, scenes: doc.scenes.map((s) => (s.id === rsvp.id ? { ...rsvp, props: nextProps } : s)) }, now);
  };
  return (
    <section className="pn-section-card pn-rsvp-questions" aria-labelledby="pn-rsvp-q" onBlur={onBlur}>
      <div className="pn-section-head">
        <span className="pn-section-icon"><ListChecksIcon aria-hidden="true" /></span>
        <span className="pn-section-title">
          <b id="pn-rsvp-q">Preguntas del formulario</b>
          <small>Además de asistencia, acompañantes y alergias</small>
        </span>
      </div>
      <div className="pn-section-body">
        <label className="pn-optrow">
          <input type="checkbox" checked={Boolean(rsvp.props.song)} disabled={disabled} onChange={(e) => setProps({ song: e.target.checked }, true)} />
          <span>Una canción que no puede faltar</span>
        </label>
        <label className="pn-optrow">
          <input type="checkbox" checked={Boolean(rsvp.props.kids)} disabled={disabled} onChange={(e) => setProps({ kids: e.target.checked }, true)} />
          <span>Cuántos niños vienen</span>
        </label>
        <label className="pn-optrow">
          <input type="checkbox" checked={menu.length > 0} disabled={disabled}
            onChange={(e) => setProps({ menuOptions: e.target.checked ? [{ id: "m-1", label: "Carne" }, { id: "m-2", label: "Pescado" }, { id: "m-3", label: "Vegetariano" }] : [] }, true)} />
          <span>Elegir menú (cada invitado dice cuántos de cada)</span>
        </label>
        {menu.length > 0 && (
          <div className="pn-items">
            {menu.map((option, i) => (
              <div key={option.id} className="pn-item pn-item--row">
                <Field label={`Opción ${i + 1}`}><input type="text" maxLength={60} value={option.label} disabled={disabled} required onChange={(e) => setProps({ menuOptions: menu.map((o, k) => (k === i ? { ...o, label: e.target.value } : o)) })} /></Field>
                <button type="button" className="pn-icon-btn pn-icon-btn--danger pn-press" disabled={disabled || menu.length <= 1} onClick={() => setProps({ menuOptions: menu.filter((_, k) => k !== i) }, true)} aria-label={`Quitar la opción ${i + 1}`}><Trash2Icon aria-hidden="true" /></button>
              </div>
            ))}
            <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press justify-self-start" disabled={disabled || menu.length >= SITE_MAX_MENU_OPTIONS}
              onClick={() => setProps({ menuOptions: [...menu, { id: itemId("m", menu), label: "" }] }, true)}>
              <PlusIcon aria-hidden="true" className="size-4" />Añadir opción de menú
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * WhatsApp de la pareja para «Pedir mi invitación» (vive en la escena rsvp).
 * Se guarda al salir del campo y solo si es válido o está vacío (vacío = sin
 * la clave: el JSON de las webs sin número no cambia).
 */
function RsvpContact({ doc, disabled, onChange, onBlur }: { doc: SiteDocument; disabled?: boolean; onChange(next: SiteDocument, immediate: boolean): void; onBlur(): void }) {
  const rsvp = doc.scenes.find((s): s is SceneOf<"rsvp"> => s.type === "rsvp");
  const stored = rsvp?.props.whatsapp ?? "";
  const [draft, setDraft] = useState(stored);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  if (!rsvp) return null;
  function commit() {
    const value = draft.trim();
    if (value && !whatsappNumber(value)) { setInvalid(true); return; }
    setInvalid(false);
    if (value === stored) return;
    const nextProps: SceneOf<"rsvp">["props"] = { ...rsvp!.props };
    if (value) nextProps.whatsapp = value;
    else delete nextProps.whatsapp;
    onChange({ ...doc, scenes: doc.scenes.map((s) => (s.id === rsvp!.id ? { ...rsvp!, props: nextProps } : s)) }, true);
  }
  return (
    <section className="pn-section-card pn-rsvp-questions" aria-labelledby="pn-rsvp-contact" onBlur={onBlur}>
      <div className="pn-section-head">
        <span className="pn-section-icon"><MessageCircleIcon aria-hidden="true" /></span>
        <span className="pn-section-title">
          <b id="pn-rsvp-contact">Pedir la invitación por WhatsApp</b>
          <small>Opcional</small>
        </span>
      </div>
      <div className="pn-section-body">
        <Field label="Vuestro móvil" hint="Mientras se pueda responder, quien abra vuestra web sin su enlace personal verá «Pedir mi invitación» y os escribirá por WhatsApp a este número. Lo verá cualquiera que abra la web.">
          <input type="tel" inputMode="tel" autoComplete="tel" maxLength={RSVP_WHATSAPP_MAX} placeholder="612 345 678" value={draft} disabled={disabled}
            aria-invalid={invalid ? true : undefined} aria-describedby={invalid ? errorId : undefined}
            onChange={(e) => { setDraft(e.target.value); if (invalid) setInvalid(false); }} onBlur={commit} />
        </Field>
        {invalid && <p id={errorId} role="alert" className="pn-row-error">{RSVP_WHATSAPP_INVALID}</p>}
      </div>
    </section>
  );
}
