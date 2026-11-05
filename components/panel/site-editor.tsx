"use client";

/**
 * Editor de la web en «Vuestra web» (panel › Ajustes).
 *
 * Una vista previa de móvil con el MISMO renderer que la web pública
 * (`InvitationRenderer mode="preview"`) junto a tres controles que escriben
 * en el borrador (`saveSiteDraft`, optimistic locking con `draftVersion`):
 *  - la foto de la pareja (`uploadCouplePhoto` → `cover.props.image`). Es
 *    una referencia al bucket PRIVADO de borradores (H05, lib/photo-ref.ts):
 *    no se puede pintar tal cual, así que el preview y la miniatura usan una
 *    URL firmada de 1 h (`getCouplePhotoPreview`), renovada antes de caducar,
 *    vía `previewCoverImage` del renderer (sin optimizar: next/image no ve
 *    URLs firmadas). Al publicar, `publishSite` la copia al bucket público.
 *  - la paleta (`document.palette`, todas las de `SITE_PALETTES`),
 *  - la maqueta (`document.layout`: «Como una Story» o «Como una web»).
 *    Desde el 13-oct-2026 la Story es Premium y aún no se vende: sin plan
 *    Premium se ve bloqueada («Premium · Próximamente»); quien ya la tiene
 *    guardada la conserva (y su ritmo, `storySeconds`, se elige aquí).
 *    La apertura ya no se elige (13-oct-2026): las invitaciones abren con
 *    el sobre; las que guardaron otra («Directa», sobre liso) la conservan,
 *  - «Pedid cambios» como un chat (como Lovable, `SiteChat`): cada petición
 *    se APLICA al momento al borrador (con la versión leída al pedirla) y la
 *    vista previa cambia; cada cambio es una versión que se puede restaurar
 *    o deshacer (historial en `wedding_site_drafts_history`; sin la
 *    migración, solo en memoria). «Seleccionar» centra la petición en una
 *    sección o un texto de la vista previa y permite editarlo a mano.
 * Nada llega a los invitados hasta publicar: eso sigue siendo `PublishCard`.
 * En el móvil (como /crear), la invitación va a sangre y la hoja abre
 * recogida en una barra de una línea con las herramientas; tocar una la
 * despliega.
 *
 * Las acciones se inyectan (por defecto, las server actions reales) para
 * que /borrador/panel pueda montarlo con datos y una IA de mentira.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronLeftIcon, ImageIcon, MousePointerClickIcon } from "lucide-react";
import Link from "next/link";
import { useFitPreview, useKeyboardAwareShell } from "@/components/creator/native";
import { InvitationRenderer, type InvitationPlan, type InvitationRsvpContext } from "@/components/invitation/renderer";
import type { RsvpWindowState } from "@/lib/rsvp-window";
import { ContentEditor, type ContentUploadResult } from "@/components/panel/content-editor";
import { PHOTO_ACCEPT, preparePhoto } from "@/components/creator/photo-prepare";
import { draftChipLabel, hasPendingPublish, shortChipLabel } from "@/components/panel/publish-pending";
import type { SiteVisibility } from "@/components/panel/site-visibility";
import { getCouplePhotoPreview, uploadCouplePhoto, type CouplePhotoPreviewResult, type UploadCouplePhotoResult } from "@/lib/actions/photo";
import { referencesDraftPhoto } from "@/lib/photo-ref";
import { listSiteDraftHistory, saveSiteDraft, type SaveDraftResult, type SiteEditorState, type SiteHistoryResult } from "@/lib/actions/site";
import { proposeSiteEdit } from "@/lib/ai/actions";
import { AI_TARGETS } from "@/lib/ai/messages";
import type { ProposeSiteEditResult } from "@/lib/ai/site-editor";
import { DEFAULT_STORY_SECONDS, SITE_PALETTES, collectImages, findScene, mapImages, resolvePalette, resolveStorySeconds, storyLayoutAvailable, withSiteLayout, type SceneImage, type SiteLayoutId, type SitePaletteId, type SiteDocument } from "@/lib/site-document";
import { SiteChat } from "@/components/site-chat/site-chat";
import { useSiteChat, type SiteChatHost } from "@/components/site-chat/use-site-chat";
import { panelChatStorageKey } from "@/lib/site-chat/persist";
import { usePreviewSelection } from "@/components/site-chat/preview-select";
import { describeEditTarget, writeEditText } from "@/lib/site-chat/edit-focus";
import { LiveEditLayer, useFinePointer } from "@/components/site-chat/live-edit";
import { panelLiveRoute, type LiveEditRoute } from "@/lib/site-chat/live-edit";
import { saveOutcome, type SaveOutcome } from "@/lib/site-chat/restore";
import { suggestNextPrompts } from "@/lib/site-chat/suggestions";
import type { VersionKind } from "@/lib/site-chat/thread";
import { prefersReducedMotion, useMediaQuery } from "@/lib/hooks/use-media-query";

type HistoryEntry = { kind: VersionKind; prompt: string; summary: string; changes: string[] };

export interface SiteEditorActions {
  upload(formData: FormData): Promise<UploadCouplePhotoResult>;
  propose(input: { instruction: string; document: SiteDocument; focus?: string }): Promise<ProposeSiteEditResult>;
  /** `history`: además del borrador, apunta la versión en el historial del chat. */
  save(input: { document: SiteDocument; baseVersion: number; history?: HistoryEntry }): Promise<SaveDraftResult>;
  /** URL firmada de una foto de borrador (bucket privado). Opcional: por defecto, la server action real. */
  preview?(url: string): Promise<CouplePhotoPreviewResult>;
  /** Versiones guardadas (chat). Opcional: por defecto, la server action real. */
  history?(): Promise<SiteHistoryResult>;
}

const DEFAULT_ACTIONS: SiteEditorActions = { upload: uploadCouplePhoto, propose: proposeSiteEdit, save: saveSiteDraft, preview: getCouplePhotoPreview, history: listSiteDraftHistory };
/** Se renueva la URL firmada cuando le quedan menos de 5 minutos. */
const PREVIEW_REFRESH_MARGIN_MS = 5 * 60 * 1000;
type SignedPreview = { url: string; expiresAt: number };

/** Lo que el editor guarda va al borrador; en "live" el enlace sigue sirviendo los datos de ajustes hasta publicar. */
const EDITOR_SAVED: Record<SiteVisibility, string> = {
  live: "Guardado en el borrador. Vuestros invitados lo verán cuando publiquéis la web.",
  published: "Guardado en borrador. Vuestros invitados siguen viendo la versión publicada.",
  withdrawn: "Guardado en el borrador. Se verá cuando volváis a publicar la web.",
};
const SAVE_FAILED = "No hemos podido guardar los cambios. Revisad la conexión y probad de nuevo.";
const UPLOAD_FAILED = "No hemos podido subir la foto. Probad de nuevo.";

/** Herramientas de la hoja en el móvil (en escritorio se ven todas, una debajo de otra). */
type EditorTool = "chat" | "photo" | "palette" | "style" | "content" | "publish" | "settings";
const EDITOR_TOOLS: ReadonlyArray<readonly [EditorTool, string]> = [
  ["chat", "Pedid cambios"], ["photo", "Foto"], ["palette", "Colores"], ["style", "Forma"], ["content", "Contenido"], ["publish", "Publicar"], ["settings", "Datos y ajustes"],
];

const PUBLISH_ANCHOR = "publicar-web";

type Source = "photo" | "palette" | "layout" | "content" | "ai";
type Notice = { source: Source; kind: "ok" | "error" | "conflict"; text: string } | null;
type PhotoStage = "preparing" | "uploading" | "saving";

/** Ritmos que se ofrecen para la Story (segundos por pantalla; el contrato admite 3–15). */
const STORY_PACES = [4, 5, 6, 8, 10, 12] as const;

function withCoverImage(doc: SiteDocument, image: SceneImage | null): SiteDocument {
  return { ...doc, scenes: doc.scenes.map((scene) => (scene.type === "cover" ? { ...scene, props: { ...scene.props, image } } : scene)) };
}

/**
 * La foto se prepara igual que en el creador (`preparePhoto`): orientación
 * aplicada, ≤ 2000 px, JPEG ≤ 900 KB y sin EXIF/GPS (el canvas no copia
 * metadatos). Pesa poco, así que sube rápido por datos móviles; el servidor
 * vuelve a validar y recodificar (lib/actions/photo.ts).
 */
async function prepareForUpload(file: File): Promise<{ ok: true; data: FormData } | { ok: false; error: string }> {
  const prepared = await preparePhoto(file);
  if (!prepared.ok) return prepared;
  const data = new FormData();
  data.append("file", new File([prepared.photo.blob], "foto.jpg", { type: "image/jpeg" }));
  return { ok: true, data };
}

const DESKTOP_QUERY = "(min-width: 1024px)";
function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

/** Botón principal de la cabecera: lleva a la tarjeta de publicación (la misma acción que el chip «Publicar»). */
function PublishShortcut({ onClick, className }: { onClick: () => void; className: string }) {
  return <button type="button" className={className} onClick={onClick}>Publicar</button>;
}

function PhonePreview({ document, plan, draftLabel, saving, rsvp, coverImage, screenRef, selecting, onToggleSelect, full = false, layer, publish }: { document: SiteDocument; plan: InvitationPlan; draftLabel: string; saving: boolean; rsvp?: InvitationRsvpContext; coverImage?: SceneImage | null; screenRef: RefObject<HTMLDivElement | null>; selecting: boolean; onToggleSelect: () => void; full?: boolean; /** Edición desde la vista previa (escritorio con ratón). */ layer?: ReactNode; /** Atajo «Publicar» (escritorio): solo si hay cambios por publicar. */ publish?: ReactNode }) {
  return (
    <figure className="pn-phone-wrap" data-full={full ? "" : undefined}>
      <figcaption className="pn-phone-caption">
        <button type="button" className="pn-select-toggle" aria-pressed={selecting} onClick={onToggleSelect}>
          <MousePointerClickIcon aria-hidden="true" className="size-4" />Seleccionar
        </button>
        <span className="pn-phone-chip" data-variant={saving ? "saving" : "draft"} role="status">{saving ? "Guardando…" : draftLabel}</span>
        {publish}
      </figcaption>
      <div className="pn-phone">
        {/* El mismo renderer que la web pública, con las marcas de «Seleccionar» (solo aquí). */}
        <div ref={screenRef} className="pn-phone-screen" tabIndex={0} aria-label="Vista previa del borrador">
          <InvitationRenderer document={document} mode="preview" plan={plan} rsvp={rsvp} previewCoverImage={coverImage} editTargets />
          {layer}
        </div>
      </div>
    </figure>
  );
}

export function SiteEditor({ state, plan, visibility, rsvpWindow, actions = DEFAULT_ACTIONS, before, after }: {
  state: SiteEditorState;
  plan: InvitationPlan;
  visibility: SiteVisibility;
  /** Plazo de respuesta (servidor): el preview muestra lo mismo que el invitado. */
  rsvpWindow?: RsvpWindowState;
  actions?: SiteEditorActions;
  /** Bloques del servidor encima y debajo de los controles (publicación, ajustes). */
  before?: ReactNode;
  after?: ReactNode;
}) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const finePointer = useFinePointer();
  // En preview el renderer solo usa `window` del contexto RSVP.
  const previewRsvp: InvitationRsvpContext | undefined = rsvpWindow ? { slug: state.slug, rsvpMvp: true, window: rsvpWindow } : undefined;
  const ids = { photo: useId(), palette: useId(), layout: useId(), ai: useId() };

  // Borrador conocido. Las props mandan cuando cambia su versión (otro
  // guardado: ajustes, agenda, otra pestaña) y no hay nada en vuelo.
  const [busy, setBusy] = useState(0);
  const [base, setBase] = useState({ propVersion: state.draftVersion, doc: state.draft, version: state.draftVersion });
  if (state.draftVersion !== base.propVersion && busy === 0) {
    // Las versiones solo crecen: una respuesta del servidor más antigua que lo
    // que ya guardamos aquí no debe pisar el borrador local.
    setBase(state.draftVersion > base.version
      ? { propVersion: state.draftVersion, doc: state.draft, version: state.draftVersion }
      : { ...base, propVersion: state.draftVersion });
  }
  const latest = useRef({ doc: base.doc, version: base.version });
  useEffect(() => { latest.current = { doc: base.doc, version: base.version }; }, [base]);

  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((job: () => Promise<void>) => {
    setBusy((count) => count + 1);
    queue.current = queue.current.then(job).catch(() => undefined).finally(() => setBusy((count) => count - 1));
  }, []);

  const [notice, setNotice] = useState<Notice>(null);
  const [wantedPalette, setWantedPalette] = useState<SitePaletteId | null>(null);
  const wantedRef = useRef<SitePaletteId | null>(null);
  const [wantedLayout, setWantedLayout] = useState<SiteLayoutId | null>(null);
  const [localPhoto, setLocalPhoto] = useState<{ url: string; stage: PhotoStage } | null>(null);
  /** Cambios de contenido aún sin guardar (vista previa al momento). */
  const [liveContent, setLiveContent] = useState<SiteDocument | null>(null);
  /** Documento que la IA acaba de cambiar mientras se guarda: la vista previa lo enseña ya. */
  const [applying, setApplying] = useState<SiteDocument | null>(null);
  /** Móvil: herramienta abierta en la hoja y si la hoja está recogida (invitación en grande). */
  const [tool, setTool] = useState<EditorTool>("chat");
  // Recogida al abrir (como /crear): la invitación a sangre y una barra de una línea con las herramientas.
  const [sheetDown, setSheetDown] = useState(true);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useKeyboardAwareShell(shellRef, !isDesktop);
  // Compacto: a sangre, de borde a borde, como el creador (DESIGN §9.1). "fill"
  // y no "width": aquí no hay anclaje (--wb-shift) y con "width" la Story
  // quedaba más alta que el hueco y sus controles de abajo, cortados bajo la hoja.
  const fit = useFitPreview(stageRef, !isDesktop, "fill");
  const [selecting, setSelecting] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  // Fotos de borrador (bucket privado) → URL firmada. Clave: la referencia
  // estable del documento. `failed`: no se reintenta hasta que cambie la foto.
  const [previews, setPreviews] = useState<Record<string, SignedPreview>>({});
  const failedPreviews = useRef(new Set<string>());
  const [previewClock, setPreviewClock] = useState(0);

  const objectUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrls.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); };
  }, []);

  /** Aplica el resultado de un guardado al borrador conocido. */
  function adopt(next: SiteDocument, draftVersion: number) {
    latest.current = { doc: next, version: draftVersion };
    setBase((current) => ({ ...current, doc: next, version: draftVersion }));
  }

  // --- Chat (como Lovable) ---------------------------------------------------
  const historyAction = actions.history ?? listSiteDraftHistory;
  const reloadHistory = useRef<() => void>(() => undefined);
  const host: SiteChatHost = {
    async snapshot() {
      // Espera a guardados en vuelo (p. ej. una paleta): la petición se calcula
      // sobre el borrador ya guardado y con su versión.
      await queue.current;
      return { document: latest.current.doc, base: latest.current.version };
    },
    propose: (input) => actions.propose(input),
    async commit(document, baseVersion, entry) {
      setApplying(document);
      setSavedNote(null);
      const outcome = await saveOutcome(() => actions.save({ document, baseVersion: baseVersion ?? latest.current.version, history: entry }));
      setApplying(null);
      if (outcome.ok) {
        adopt(document, outcome.draftVersion);
        setSavedNote(EDITOR_SAVED[visibility]);
      }
      return outcome;
    },
    onConflict() {
      // Lo último del servidor: borrador (props) y conversación.
      router.refresh();
      reloadHistory.current();
    },
  };
  // Lo aplicado vuelve del historial del servidor; lo que no se pudo aplicar
  // (con su motivo) se guarda en este navegador para que siga en el hilo al recargar.
  const chat = useSiteChat(host, { storageKey: panelChatStorageKey(state.weddingId), mode: "errors" });
  const { seed, load } = chat;
  useEffect(() => {
    let cancelled = false;
    seed(state.draft, state.draftVersion);
    const fetchHistory = () => {
      historyAction()
        .then((result) => { if (!cancelled && result.ok && result.available) load(result.rows); })
        .catch(() => undefined);
    };
    reloadHistory.current = fetchHistory;
    fetchHistory();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez al abrir; las recargas van por reloadHistory.
  }, []);

  /** Guarda `next` sobre la última versión conocida. true si se guardó. Con `history`, además apunta la versión en el chat. */
  async function persist(next: SiteDocument, source: Source, baseVersion = latest.current.version, history?: { summary: string; changes: string[] }): Promise<boolean> {
    let result: SaveDraftResult;
    try {
      result = await actions.save({ document: next, baseVersion, ...(history ? { history: { kind: "manual" as const, prompt: "", ...history } } : {}) });
    } catch {
      setNotice({ source, kind: "error", text: SAVE_FAILED });
      return false;
    }
    if (result.ok) {
      adopt(next, result.draftVersion);
      setNotice({ source, kind: "ok", text: EDITOR_SAVED[visibility] });
      if (history) {
        chat.push({ id: result.history?.id ?? `m-${result.draftVersion}-${Date.now().toString(36)}`, kind: "manual", createdAt: result.history?.createdAt ?? new Date().toISOString(), prompt: "", summary: history.summary, changes: history.changes, document: next, draftVersion: result.draftVersion });
      }
      return true;
    }
    setNotice({ source, kind: result.code === "conflict" ? "conflict" : "error", text: result.error || SAVE_FAILED });
    return false;
  }

  // --- Foto ----------------------------------------------------------------
  const cover = findScene(base.doc, "cover");
  const savedImage = cover?.props.image ?? null;
  const coupleAlt = `Foto de ${cover?.props.partnerName1 || "la pareja"} y ${cover?.props.partnerName2 || ""}`.trim().slice(0, 160);

  function onPhotoChosen(file: File | undefined) {
    if (!file) return;
    setNotice(null);
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    setLocalPhoto({ url, stage: "preparing" });
    enqueue(async () => {
      try {
        const prepared = await prepareForUpload(file);
        if (!prepared.ok) { setNotice({ source: "photo", kind: "error", text: prepared.error }); return; }
        setLocalPhoto({ url, stage: "uploading" });
        let uploaded: UploadCouplePhotoResult;
        try { uploaded = await actions.upload(prepared.data); } catch { uploaded = { ok: false, error: UPLOAD_FAILED }; }
        if (!uploaded.ok) { setNotice({ source: "photo", kind: "error", text: uploaded.error }); return; }
        if (uploaded.previewUrl && uploaded.previewExpiresAt) {
          const signed = { url: uploaded.previewUrl, expiresAt: uploaded.previewExpiresAt };
          setPreviews((current) => ({ ...current, [uploaded.url]: signed }));
        }
        setLocalPhoto({ url, stage: "saving" });
        const image: SceneImage = { url: uploaded.url, alt: coupleAlt, width: uploaded.width, height: uploaded.height };
        await persist(withCoverImage(latest.current.doc, image), "photo");
      } catch {
        setNotice({ source: "photo", kind: "error", text: UPLOAD_FAILED });
      } finally {
        setLocalPhoto(null);
        // La miniatura y el móvil ya enseñan la URL de Storage; libera la local.
        window.setTimeout(() => { URL.revokeObjectURL(url); objectUrls.current.delete(url); }, 1500);
      }
    });
  }

  function removePhoto() {
    const previous = savedImage;
    if (!previous) return;
    setNotice(null);
    enqueue(async () => {
      const ok = await persist(withCoverImage(latest.current.doc, null), "photo");
      if (!ok) return;
      setNotice(null);
      toast("Foto quitada de la portada", {
        duration: 5000,
        action: { label: "Deshacer", onClick: () => enqueue(async () => { await persist(withCoverImage(latest.current.doc, previous), "photo"); }) },
      });
    });
  }

  /**
   * Foto de historia o galería: prepara, sube al bucket privado y devuelve la
   * referencia o el motivo del fallo. Puede haber dos a la vez (PhotoRow): el
   * error se enseña junto a SU foto, no en el aviso común de la sección.
   */
  async function uploadContentPhoto(file: File): Promise<ContentUploadResult> {
    try {
      const prepared = await prepareForUpload(file);
      if (!prepared.ok) return prepared;
      const uploaded = await actions.upload(prepared.data);
      if (!uploaded.ok) return { ok: false, error: uploaded.error };
      if (uploaded.previewUrl && uploaded.previewExpiresAt) {
        const signed = { url: uploaded.previewUrl, expiresAt: uploaded.previewExpiresAt };
        setPreviews((current) => ({ ...current, [uploaded.url]: signed }));
      }
      return { ok: true, image: { url: uploaded.url, alt: coupleAlt, width: uploaded.width, height: uploaded.height } };
    } catch {
      return { ok: false, error: UPLOAD_FAILED };
    }
  }

  // --- Paleta (último toque gana: los guardados se encadenan) ---------------
  const currentPalette = wantedPalette ?? resolvePalette(base.doc).id;
  function choosePalette(id: SitePaletteId) {
    setNotice(null);
    setWantedPalette(id);
    wantedRef.current = id;
    enqueue(async () => {
      const target = wantedRef.current;
      if (!target) return;
      if (resolvePalette(latest.current.doc).id === target && latest.current.doc.palette === target) return;
      const label = SITE_PALETTES.find((p) => p.id === target)?.label ?? target;
      const ok = await persist({ ...latest.current.doc, palette: target }, "palette", undefined, { summary: `Colores cambiados a mano: ${label}.`, changes: [`los colores (${label})`] });
      if (wantedRef.current === target) { wantedRef.current = null; setWantedPalette(null); }
      if (!ok && wantedRef.current === null) setWantedPalette(null);
    });
  }

  // --- Maqueta ---------------------------------------------------------------
  const currentLayout = wantedLayout ?? base.doc.layout ?? "historia";
  // La Story es Premium y aún no se vende (13-oct-2026): sin plan Premium solo
  // la conserva quien ya la tiene guardada; una web no puede pasar a Story.
  const storyLocked = !storyLayoutAvailable(plan === "premium", base.doc);
  function chooseLayout(value: SiteLayoutId) {
    if (value === "historia" && storyLocked) return;
    setNotice(null);
    setWantedLayout(value);
    enqueue(async () => {
      const label = value === "web" ? "como una web" : "como una Story";
      if ((latest.current.doc.layout ?? "historia") !== value) await persist(withSiteLayout(latest.current.doc, value), "layout", undefined, { summary: `Forma cambiada a mano: ${label}.`, changes: [`la forma (${label})`] });
      setWantedLayout(null);
    });
  }

  // Ritmo del autoavance de la Story (segundos por pantalla). 6 s se guarda sin la clave.
  const [wantedSeconds, setWantedSeconds] = useState<number | null>(null);
  const currentSeconds = wantedSeconds ?? resolveStorySeconds(base.doc);
  function chooseStorySeconds(seconds: number) {
    setNotice(null);
    setWantedSeconds(seconds);
    enqueue(async () => {
      if (resolveStorySeconds(latest.current.doc) !== seconds) {
        const next = { ...latest.current.doc };
        delete next.storySeconds;
        await persist(seconds === DEFAULT_STORY_SECONDS ? next : { ...next, storySeconds: seconds }, "layout", undefined, { summary: `Story: ${seconds} segundos por pantalla.`, changes: [`el tiempo de cada pantalla (${seconds} s)`] });
      }
      setWantedSeconds(null);
    });
  }

  // --- URLs firmadas de las fotos de borrador -------------------------------
  // Todas las fotos del borrador y de lo que se está guardando (portada, capítulos, galería).
  const draftRefs = [...collectImages(base.doc), ...(applying ? collectImages(applying) : [])]
    .map((image) => image.url)
    .filter((url) => referencesDraftPhoto(url));
  const refsKey = Array.from(new Set(draftRefs)).sort().join("\n");
  const expiryKey = refsKey ? refsKey.split("\n").map((ref) => previews[ref]?.expiresAt ?? 0).join(",") : "";
  const previewAction = actions.preview ?? getCouplePhotoPreview;
  useEffect(() => {
    if (!refsKey) return;
    let cancelled = false;
    const now = Date.now();
    const due = refsKey.split("\n").filter((ref) => !failedPreviews.current.has(ref) && !(previews[ref] && previews[ref].expiresAt - now > PREVIEW_REFRESH_MARGIN_MS));
    for (const ref of due) {
      previewAction(ref)
        .then((result) => {
          if (cancelled) return;
          if (result.ok) setPreviews((current) => ({ ...current, [ref]: { url: result.url, expiresAt: result.expiresAt } }));
          else failedPreviews.current.add(ref);
        })
        .catch(() => { if (!cancelled) failedPreviews.current.add(ref); });
    }
    // Siguiente renovación: la primera que vaya a caducar.
    const next = refsKey.split("\n")
      .filter((ref) => !failedPreviews.current.has(ref) && !due.includes(ref))
      .map((ref) => previews[ref]?.expiresAt)
      .filter((t): t is number => typeof t === "number");
    const timer = next.length > 0 ? window.setTimeout(() => setPreviewClock((tick) => tick + 1), Math.max(1000, Math.min(...next) - PREVIEW_REFRESH_MARGIN_MS - now)) : undefined;
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `previews` se lee vía `expiryKey`; se re-evalúa al cambiar las fotos, al renovar y con el reloj.
  }, [refsKey, expiryKey, previewClock]);

  /** Imagen pintable: la de borrador se sustituye por su URL firmada (null mientras llega). */
  function displayable(image: SceneImage | null): SceneImage | null {
    if (!image || !referencesDraftPhoto(image.url)) return image;
    const signed = previews[image.url];
    return signed ? { ...image, url: signed.url } : null;
  }

  // Documento que enseña el móvil: lo que se está guardando > foto local en curso > paleta elegida > borrador.
  let shown = applying ?? liveContent ?? base.doc;
  if (localPhoto) shown = withCoverImage(shown, { url: localPhoto.url, alt: coupleAlt });
  if (wantedPalette) shown = { ...shown, palette: wantedPalette };
  if (wantedLayout) shown = withSiteLayout(shown, wantedLayout);
  // El móvil recibe un documento «pintable»: cada referencia privada se
  // sustituye por su URL firmada (o se quita mientras llega). Las públicas y
  // el `blob:` local se pintan tal cual. Nunca se guarda este documento.
  const displayDoc = mapImages(shown, (image) => (referencesDraftPhoto(image.url) ? displayable(image) : image));
  const previewCoverImage = undefined;
  // Mientras la IA trabaja, los controles a mano esperan: el cambio se guarda
  // con la versión leída al pedirlo y un guardado a medias lo haría chocar.
  const locked = chat.busy;

  // --- Seleccionar ------------------------------------------------------------
  const target = selectedPath ? describeEditTarget(base.doc, selectedPath) : null;
  const pick = useCallback((path: string) => {
    setSelectedPath(path);
    setSelecting(false);
    setTool("chat");
    setSheetDown(false);
  }, []);
  usePreviewSelection({ container: screenRef, active: selecting, selected: target ? selectedPath : null, refreshKey: displayDoc, onPick: pick });
  const toggleSelect = () => {
    setSelecting((on) => !on);
    // En el móvil se selecciona sobre la invitación en grande.
    if (!isDesktop) setSheetDown(true);
  };

  async function editText(path: string, value: string): Promise<SaveOutcome | { ok: false; error: string }> {
    const label = describeEditTarget(latest.current.doc, path)?.label ?? "el texto";
    const check = writeEditText(latest.current.doc, path, value);
    if (!check.ok) return check;
    return chat.record((current) => {
      const written = writeEditText(current, path, value);
      return written.ok ? written.document : current;
    }, { kind: "manual", summary: `Cambiado a mano: ${label}.`, changes: [label] });
  }

  // Escritorio con ratón: tocar un texto de la vista previa lo edita ahí mismo;
  // nombres, fecha y foto llevan a su control; lo demás queda seleccionado
  // para «Pedid cambios» (punto 6 del backlog).
  function openLive(route: Exclude<LiveEditRoute, { kind: "text" }>, path: string) {
    if (route.kind === "focus") {
      const control = window.document.querySelector<HTMLElement>(route.selector);
      if (!control) return;
      control.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      control.focus({ preventScroll: true });
      return;
    }
    pick(path);
    requestAnimationFrame(() => {
      const input = window.document.querySelector<HTMLElement>(".pn-chat-section .sc-box textarea");
      input?.scrollIntoView({ block: "nearest" });
      input?.focus({ preventScroll: true });
    });
  }
  const liveLayer = isDesktop && finePointer ? (
    <LiveEditLayer container={screenRef} enabled={!selecting && !locked} refreshKey={displayDoc} resolve={(path) => panelLiveRoute(base.doc, path)} onEditText={editText} onOpen={openLive} />
  ) : null;

  const pastPrompts = useMemo(() => chat.state.turns.flatMap((t) => (t.kind === "ai" ? [t.prompt] : [])), [chat.state.turns]);
  const suggestions = useMemo(() => suggestNextPrompts(base.doc, { exclude: pastPrompts }), [base.doc, pastPrompts]);

  const noticeFor = (source: Source) => (notice && notice.source === source ? (
    <div role={notice.kind === "ok" ? "status" : "alert"} className={`pn-note ${notice.kind === "ok" ? "pn-note--ok" : "pn-note--warn"}`}>
      <p>{notice.text}</p>
      {notice.kind === "conflict" && <button type="button" onClick={() => router.refresh()} className="pn-link pn-press">Recargar</button>}
    </div>
  ) : null);

  const stageIndex = localPhoto ? ["preparing", "uploading", "saving"].indexOf(localPhoto.stage) : -1;
  const stageLabel = localPhoto ? { preparing: "Preparando la foto…", uploading: "Subiendo la foto…", saving: "Guardando en el borrador…" }[localPhoto.stage] : "";
  const thumb = localPhoto?.url ?? displayable(savedImage)?.url ?? null;
  const draftLabel = draftChipLabel(state, base.version);
  const saving = applying !== null || busy > 0;
  const show = (name: EditorTool) => isDesktop || tool === name;
  const pendingPublish = hasPendingPublish(state, base.version);
  // Mismo gesto que el chip «Publicar» de la barra: abre la tarjeta de publicación (la publicación en sí, con sus avisos, sigue siendo `PublishCard`).
  const goPublish = () => { setTool("publish"); setSelecting(false); setSheetDown(false); };
  const goPublishDesktop = () => {
    const card = window.document.getElementById(PUBLISH_ANCHOR);
    card?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    // El botón de publicar de la tarjeta (no el primero que haya: tras un conflicto es «Recargar»); si está desactivado, el primero que se pueda pulsar.
    (card?.querySelector<HTMLElement>("[data-publish-primary]:not(:disabled)") ?? card?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
  };

  const preview = (full: boolean) => (
    <PhonePreview document={displayDoc} plan={plan} draftLabel={draftLabel} saving={saving} rsvp={previewRsvp} coverImage={previewCoverImage} screenRef={screenRef} selecting={selecting} onToggleSelect={toggleSelect} full={full} layer={liveLayer}
      publish={pendingPublish ? <PublishShortcut className="pn-btn pn-btn--sm pn-press pn-phone-publish" onClick={goPublishDesktop} /> : undefined} />
  );

  const controls = (
    <>
        {isDesktop ? <div id={PUBLISH_ANCHOR}>{before}</div> : <div className="pn-me-publish" hidden={!show("publish")}>{before}</div>}

        <section aria-labelledby={ids.ai} className="pn-chat-section" hidden={!show("chat")}>
          <div className="pn-editor-intro">
            <h2 id={ids.ai} className="pn-display pn-h2">Pedid cambios</h2>
            <p className="pn-muted mt-2 text-sm leading-relaxed">Lo que pidáis se aplica al momento en el borrador y lo veis en la vista previa. Vuestros invitados no ven nada hasta que publiquéis.</p>
          </div>
          <SiteChat
            chat={chat}
            suggestions={suggestions}
            intro={<>
              <p>Contadnos qué queréis cambiar: colores, textos, preguntas, programa, autobuses, hoteles… Lo aplicamos al momento y podéis deshacerlo.</p>
              <p className="sc-meta">Los nombres, la fecha y las fotos se cambian a mano, más abajo.</p>
            </>}
            target={target}
            onClearTarget={() => setSelectedPath(null)}
            selecting={selecting}
            onToggleSelect={toggleSelect}
            onEditText={editText}
            savedNote={savedNote ?? undefined}
            placeholder="Poned colores más verdes y una bienvenida más cercana"
          />
        </section>

        <div className="pn-manual">
          <fieldset id={AI_TARGETS.photo} className="pn-ed-section" disabled={locked} hidden={!show("photo")}>
            <legend id={ids.photo} className="pn-display pn-h3">La foto</legend>
            <p className="pn-muted text-sm leading-relaxed">Aparece en la portada de vuestra invitación. JPG, PNG o WebP (en iPhone, también HEIC). La reducimos antes de subirla y le quitamos la ubicación y los datos de la cámara.</p>
            <div className="pn-photo">
              <div className="pn-photo-thumb" data-empty={thumb ? undefined : "true"}>
                {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:) o de Storage, sin optimizar */}
                {thumb ? <img src={thumb} alt="" /> : <ImageIcon aria-hidden="true" className="size-6" />}
              </div>
              <div className="pn-photo-actions">
                <input ref={fileInput} id={`${ids.photo}-file`} type="file" accept={PHOTO_ACCEPT} className="sr-only" tabIndex={-1}
                  onChange={(event) => { onPhotoChosen(event.target.files?.[0]); event.target.value = ""; }} />
                <button type="button" onClick={() => fileInput.current?.click()} disabled={localPhoto !== null} className="pn-btn pn-btn--ghost pn-btn--sm pn-press">
                  {savedImage ? "Cambiar la foto" : "Subir una foto"}
                </button>
                {savedImage && !localPhoto && (
                  <button type="button" onClick={removePhoto} className="pn-link pn-press">Quitar la foto</button>
                )}
              </div>
            </div>
            {localPhoto && (
              <div role="status" className="pn-steps-progress">
                <span className="pn-help">{stageLabel}</span>
                <span className="pn-stepbar" aria-hidden="true"><span style={{ transform: `scaleX(${(stageIndex + 1) / 3})` }} /></span>
              </div>
            )}
            {noticeFor("photo")}
            {!savedImage && !localPhoto && <p className="pn-help">Sin foto, la portada muestra vuestras iniciales.</p>}
          </fieldset>

          <fieldset className="pn-ed-section" disabled={locked} hidden={!show("palette")}>
            <legend id={ids.palette} className="pn-display pn-h3">Los colores</legend>
            <p className="pn-muted text-sm leading-relaxed">Cambian los colores de toda la invitación. La tipografía sigue el estilo que elegisteis.</p>
            <div role="radiogroup" aria-labelledby={ids.palette} className="pn-swatches">
              {SITE_PALETTES.map((palette) => (
                <label key={palette.id} className="pn-swatch pn-press">
                  <input type="radio" name={`${ids.palette}-palette`} value={palette.id} checked={currentPalette === palette.id} onChange={() => choosePalette(palette.id)} className="sr-only" />
                  <span aria-hidden="true" className="pn-swatch-chip" style={{ backgroundColor: palette.paper, color: palette.ink }}>
                    <span style={{ backgroundColor: palette.accent }} />
                  </span>
                  <span className="pn-swatch-label">{palette.label}</span>
                </label>
              ))}
            </div>
            {noticeFor("palette")}
          </fieldset>

          <fieldset className="pn-ed-section" disabled={locked} hidden={!show("style")}>
            <legend id={ids.layout} className="pn-display pn-h3">La forma</legend>
            <p className="pn-muted text-sm leading-relaxed">Cómo recorren vuestros invitados la invitación. El contenido es el mismo.</p>
            <div role="radiogroup" aria-labelledby={ids.layout} className="pn-openings">
              {([
                ["historia", "Como una Story", "Una pantalla tras otra que pasa sola, con pausa al mantener pulsado."],
                ["web", "Como una web", "Una página que se recorre hacia abajo, con movimiento al desplazarse."],
              ] as const).map(([value, label, help]) => {
                const premiumLocked = value === "historia" && storyLocked;
                return (
                  <label key={value} className={premiumLocked ? "pn-opening" : "pn-opening pn-press"} data-locked={premiumLocked ? "" : undefined}>
                    <input type="radio" name={`${ids.layout}-layout`} value={value} checked={currentLayout === value} disabled={premiumLocked} aria-describedby={premiumLocked ? `${ids.layout}-premium` : undefined} onChange={() => chooseLayout(value)} className="sr-only" />
                    <span className="pn-opening-label">{label}</span>
                    {value === "historia" && <span className="pn-premium" id={`${ids.layout}-premium`}>{plan === "premium" ? "Premium" : "Premium · Próximamente"}</span>}
                    <span className="pn-opening-help">{help}</span>
                  </label>
                );
              })}
            </div>
            {plan !== "premium" && currentLayout === "historia" && (
              <p className="pn-muted text-sm leading-relaxed">Vuestra invitación sigue como una Story. La Story pasa a ser Premium: si cambiáis a «Como una web», no podréis volver a ella hasta que esté disponible.</p>
            )}
            {currentLayout === "historia" && (
              <label className="pn-field pn-story-pace">
                <span>Tiempo en cada pantalla</span>
                <select value={currentSeconds} onChange={(event) => chooseStorySeconds(Number(event.target.value))}>
                  {STORY_PACES.map((seconds) => (
                    <option key={seconds} value={seconds}>{seconds} segundos{seconds === DEFAULT_STORY_SECONDS ? " (recomendado)" : ""}</option>
                  ))}
                </select>
              </label>
            )}
            {noticeFor("layout")}
          </fieldset>

          <fieldset id={AI_TARGETS.content} className="pn-ed-section" disabled={locked} hidden={!show("content")}>
            <legend className="pn-display pn-h3">Vuestro contenido</legend>
            <p className="pn-muted text-sm leading-relaxed">Vuestra historia por capítulos, fotos, los detalles prácticos y las preguntas de siempre. En «Como una web» cobran vida al bajar; en la Story, cada sección es una pantalla.</p>
            <ContentEditor
              document={base.doc}
              disabled={locked}
              onChange={(next) => enqueue(async () => { await persist(next, "content"); })}
              onLive={setLiveContent}
              upload={uploadContentPhoto}
              thumb={(url) => displayable({ url, alt: "" })?.url ?? null}
            />
            {noticeFor("content")}
          </fieldset>

          {isDesktop ? after : <div hidden={!show("settings")}>{after}</div>}
        </div>
    </>
  );

  if (isDesktop) {
    return (
      <div className="pn-editor pn-editor--chat">
        <div className="pn-editor-controls">{controls}</div>
        <aside className="pn-editor-preview" aria-label="Vista previa de vuestra web">{preview(false)}</aside>
      </div>
    );
  }

  // Móvil (mobile first): la invitación a sangre, de borde a borde, bajo la
  // franja de la isla; las herramientas en una hoja abajo, recogida al abrir.
  const toolLabel = EDITOR_TOOLS.find(([name]) => name === tool)?.[1] ?? "";
  return (
    <div ref={shellRef} className="pn-me">
      <div ref={stageRef} className="pn-me-stage" data-fit={fit ? (fit.hidden ? "hidden" : "on") : undefined} style={fit ? ({ "--me-w": `${fit.w}px`, "--me-h": `${fit.h}px`, "--me-scale": fit.scale } as React.CSSProperties) : undefined}>
        <div className="pn-me-bar">
          <Link href="/panel" className="pn-me-pill pn-press"><ChevronLeftIcon aria-hidden="true" className="size-4" />Panel</Link>
          {/* Arriba, en la franja: abajo tapaba los controles de la Story, ahora a sangre. */}
          <button type="button" className="pn-me-pill pn-me-select pn-press" aria-pressed={selecting} onClick={toggleSelect}><MousePointerClickIcon aria-hidden="true" className="size-4" />{selecting ? "Cancelar" : "Seleccionar"}</button>
          <span className="pn-me-pill pn-me-status" data-variant={saving ? "saving" : "draft"} role="status">{saving ? "Guardando…" : pendingPublish
            // A 390 px no cabe la etiqueta entera junto a «Publicar»: se ve la corta («Borrador» o «Retirada») y la frase completa la leen los lectores de pantalla y sale al mantener el puntero.
            ? <><span aria-hidden="true" title={draftLabel}>{shortChipLabel(state)}</span><span className="sr-only">{draftLabel}</span></>
            : draftLabel}</span>
          {pendingPublish && <PublishShortcut className="pn-me-pill pn-me-publish-btn pn-press" onClick={goPublish} />}
        </div>
        {selecting && <p className="pn-me-note">Tocad una sección o un texto para centrar ahí el cambio.</p>}
        <div className="pn-me-phone-wrap">
          <div className="pn-me-phone">
            <div ref={screenRef} className="pn-me-screen" tabIndex={0} aria-label="Vista previa del borrador">
              <InvitationRenderer document={displayDoc} mode="preview" plan={plan} rsvp={previewRsvp} previewCoverImage={previewCoverImage} editTargets />
            </div>
          </div>
        </div>
      </div>
      <section className="pn-me-sheet" data-sheet={sheetDown ? "down" : "up"} aria-label="Editar vuestra web">
        <div className="pn-me-sheet-top">
          {/* Recogida, la hoja es solo el dock en una línea: tocar una herramienta la abre. */}
          {!sheetDown && (
            <button type="button" className="pn-me-handle" aria-expanded="true" onClick={() => { setSheetDown(true); setSelecting(false); }}>
              <span className="pn-me-grab" aria-hidden="true" />
              <span className="pn-me-row"><strong>{toolLabel}</strong><span className="pn-me-toggle">Ver la invitación<ChevronDownIcon aria-hidden="true" className="size-4" /></span></span>
            </button>
          )}
          <div className="pn-me-tools" role="group" aria-label="Qué queréis cambiar">
            {EDITOR_TOOLS.map(([name, label]) => (
              <button key={name} type="button" aria-pressed={!sheetDown && tool === name} onClick={() => { setTool(name); setSelecting(false); setSheetDown(false); }} className="pn-press">{label}</button>
            ))}
          </div>
        </div>
        <div className="pn-me-body" hidden={sheetDown}>{controls}</div>
      </section>
    </div>
  );
}
