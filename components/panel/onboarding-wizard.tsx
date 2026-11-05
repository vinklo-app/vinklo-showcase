"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ProposeSiteEditResult } from "@/lib/ai/site-editor";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, Maximize2Icon, MessageCircleIcon, PaletteIcon, PlusIcon, TypeIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createWeddingFromCreator } from "@/lib/actions/wedding";
import { clearStashedDraft } from "@/lib/actions/builder-stash";
import { uploadCouplePhoto } from "@/lib/actions/photo";
import { publishSite, saveSiteDraft } from "@/lib/actions/site";
import { proposeDraftSiteEdit, proposeSiteEdit, readBuilderIdea } from "@/lib/ai/actions";
import { mergeIdeaSuggestion, IDEA_MIN_LENGTH } from "@/lib/ai/idea-merge";
import { BUILDER_IDEA_MAX, BUILDER_MODULE_IDS, BUILDER_MODULE_LABELS, BUILDER_STORAGE_KEY, EMPTY_DRAFT, adoptChecked, adoptProposal, applyBuilderTemplate, composeBuilderDocument, pickBuilderDraft, restoreBuilderDraft, selectedPalette, suggestWeddingStyle, type BuilderDraft, type BuilderModuleId, type BuilderTemplate } from "@/lib/wedding-builder";
import { DATE_GAP_FIELD, composerRoute, creatorExtras, draftStep, essentialIssue, hasNames, fieldForEditPath, gapPaths, guestEstimate, missingEssentials, nextCreatorStep, planLandingIdea, replaceIdea, understoodChips, withIdeaText, type CreatorField, type DesignSection } from "@/lib/creator-compose";
import { LEGACY_SCENE_IDS, findScene, sceneHasContent, type SceneImage, type SiteDocument } from "@/lib/site-document";
import { coupleInitials } from "@/components/invitation/format";
import { InvitationRenderer } from "@/components/invitation/renderer";
import { LazoIcon } from "@/components/brand/icons";
import { PalettePicker } from "@/components/creator/palette-picker";
import { PhotoStep } from "@/components/creator/photo-step";
import { BusDetails, HotelDetails } from "@/components/creator/module-details";
import { DayStep } from "@/components/creator/day-step";
import { PlaceCombobox } from "@/components/places/place-combobox";
import { pickedIntoAddress, pickedIntoVenue, type PickedFields } from "@/lib/places/places";
import { StoryStep } from "@/components/creator/story-step";
import { FullscreenPreview } from "@/components/creator/fullscreen-preview";
import { CreatorSheet } from "@/components/creator/creator-sheet";
import { useGapTargets } from "@/components/creator/gap-targets";
import { withTemplatePreview, type TemplateGapKind } from "@/lib/template-preview";
import { ChatComposer, ChatTurns, useComposerText, useFollowLastTurn } from "@/components/site-chat/site-chat";
import { useSiteChat, type SiteChatHost } from "@/components/site-chat/use-site-chat";
import { usePreviewSelection } from "@/components/site-chat/preview-select";
import { LiveEditLayer, useFinePointer } from "@/components/site-chat/live-edit";
import { creatorLiveRoute, type LiveEditRoute } from "@/lib/site-chat/live-edit";
import { DESIGN_CHANGE_PROMPT, SECTION_CHANGE_PROMPTS, creatorEditTarget, describeEditTarget, writeEditText, type EditTarget } from "@/lib/site-chat/edit-focus";
import type { SceneType } from "@/lib/site-document";
import { suggestNextPrompts } from "@/lib/site-chat/suggestions";
import { CREATOR_CHAT_DRAFT_KEY, CREATOR_CHAT_STORAGE_KEY } from "@/lib/site-chat/persist";
import { haptic, useFitPreview, useIsMobile, useKeyboardAwareShell } from "@/components/creator/native";
import { preparePhoto, type PreparedPhoto } from "@/components/creator/photo-prepare";
import { clearStoredPhoto, loadStoredPhoto, saveStoredPhoto } from "@/components/creator/photo-store";
import { finishCreatedWedding, finishNotice, type FinishStage } from "@/components/creator/finish-wedding";
import { GalleryPicker, useCreatorGallery } from "@/components/creator/gallery-picker";
import { withCreatorGallery } from "@/components/creator/creator-gallery";
import { browserStorage, createAutoPublishGate, markPublishIntent } from "@/components/creator/publish-intent";
import { prefersReducedMotion } from "@/lib/hooks/use-media-query";
import "./wedding-builder.css";

/** Avisos mientras se lee la idea: escrita aquí o traída de la landing (`?idea=`). */
const READING_IDEA = "Leyendo vuestra idea…";
const READING_LANDING = "Preparando vuestra invitación con lo que nos habéis contado…";

/** Bodas enteras (no estilos): al enviarlas, la idea se lee y la invitación se rellena. */
const ideaChips = [
  "Somos Marta y Jaime, nos casamos el 12 de septiembre de 2027 en una finca de Toledo",
  "Nos casamos en Sevilla el 23 de mayo de 2027, unas 150 personas, una gran fiesta",
  "Boda íntima en la sierra, 60 personas, el 4 de octubre de 2027",
] as const;
/** Lo que dice el botón mientras se crea la web: cada fase, cuando ocurre. */
/** Antes de publicar solo: se esperan el borrador, la foto y las fotos guardadas en este navegador. */
const AUTO_WAIT_LABEL = "Preparando vuestra web…";
const STAGE_LABEL: Record<"create" | FinishStage, string> = { create: "Creando vuestra web…", photo: "Subiendo vuestra foto…", gallery: "Subiendo vuestras fotos…", save: "Guardando vuestro diseño…", publish: "Publicando vuestra web…" };

/** Título y frase de cada editor (la hoja en el móvil, la columna en escritorio). */
const FIELD_COPY: Record<Exclude<CreatorField, "design">, { title: string; lead: string }> = {
  names: { title: "Vuestros nombres", lead: "Tal como queréis que aparezcan en la invitación." },
  date: { title: "La fecha", lead: "Si cambia, podréis actualizarla después." },
  venue: { title: "El lugar", lead: "El sitio, la dirección y la hora. Si aún lo estáis decidiendo, dejadlo para después." },
  guests: { title: "Invitados y extras", lead: "Una estimación basta: a cada invitado lo añadiréis desde vuestro panel." },
  day: { title: "El programa del día", lead: "La hora y el sitio de cada momento. Pueden ser sitios distintos; lo que dejéis en blanco no se enseña." },
  story: { title: "Vuestra historia", lead: "Escribid como lo contaríais en una cena. Lo que dejéis en blanco no aparece." },
  welcome: { title: "La bienvenida", lead: "Decidles por qué los queréis allí. Una frase vuestra vale más que un texto de compromiso." },
  photo: { title: "Vuestra foto", lead: "Es lo primero que verá vuestra gente al abrir la invitación." },
};
const DESIGN_COPY: Record<DesignSection, { title: string; lead: string }> = {
  colores: { title: "Colores", lead: "Se aplican al momento en vuestra invitación." },
  letra: { title: "Letra", lead: "La letra de vuestros nombres en la portada." },
};
const DOCK: ReadonlyArray<{ section: DesignSection; label: string; Icon: typeof PaletteIcon }> = [
  { section: "colores", label: "Colores", Icon: PaletteIcon },
  { section: "letra", label: "Letra", Icon: TypeIcon },
];
/**
 * «Pedid cambios» con un editor abierto: la sugerencia de su sección (en el
 * escritorio el compositor sigue a la vista bajo el editor).
 */
const FIELD_SCENE: Record<Exclude<CreatorField, "design">, SceneType> = { names: "cover", date: "cover", photo: "cover", welcome: "cover", venue: "venue", day: "agenda", story: "story", guests: "rsvp" };
/** Móvil sin foto: distancia (px) del titular pequeño de la portada a la franja blanca. */
const COVER_TOP_GAP = 100;
/** Campo que recibe el foco al abrir cada editor (los ids también los usa `fail`). */
const FIRST_INPUT: Partial<Record<CreatorField, string>> = { names: "wb-name-1", date: "wb-date", venue: "wb-venue", welcome: "wb-welcome", guests: "wb-guests" };

type Panel = { kind: "field"; field: CreatorField; section?: DesignSection } | { kind: "extras" } | { kind: "thread" };

/** Iniciales de la vista previa: primera letra real de cada nombre, «V·S» si aún no hay ninguna. */
const initialsOf = (name1: string, name2: string) => coupleInitials(name1, name2, { lettersOnly: true, fallback: "V·S" });

/**
 * Cambios que se ven en el móvil (colores, foto): fundido del marco con View
 * Transitions donde existen (solo opacidad, también con reduced-motion). Sin
 * soporte, el cambio es directo y el CSS funde el color.
 */
function crossfade(update: () => void) {
  const doc = typeof document !== "undefined" ? (document as Document & { startViewTransition?: (callback: () => void) => unknown }) : null;
  if (!doc?.startViewTransition) { update(); return; }
  doc.startViewTransition(() => flushSync(update));
}

/** Huecos de la plantilla (lib/template-preview.ts): nombre accesible y petición de partida. */
const TEMPLATE_GAP_LABEL: Record<TemplateGapKind, string> = { photo: "Elegir vuestra foto", gallery: "Añadir vuestras fotos", story: "Contar vuestra historia", details: "Rellenar los detalles", faq: "Responder las preguntas" };
const TEMPLATE_GAP_PROMPT = { details: "Detalles para los invitados: ", faq: "Respuestas a las preguntas: " } as const;

/** La foto local (blob:) entra solo en el documento del preview; nunca se guarda ni se envía. */
function withLocalImage(doc: SiteDocument, image: SceneImage | null): SiteDocument {
  if (!image) return doc;
  return { ...doc, scenes: doc.scenes.map((scene) => (scene.type === "cover" ? { ...scene, props: { ...scene.props, image } } : scene)) };
}

/** Altura de la caja de texto: de una a cuatro líneas, según lo escrito (sin animar). */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 22;
    const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    el.style.height = "0px";
    el.style.height = `${Math.max(line + pad, Math.min(el.scrollHeight, line * 4 + pad))}px`;
  }, [ref, value, enabled]);
}

/** Marco de móvil. La barra Story la pinta el reproductor del renderer (`.sp-progress`). */
function PhoneFrame({ busy, namesMissing, phoneRef, screenRef, children }: { busy: boolean; namesMissing: boolean; phoneRef: React.Ref<HTMLDivElement>; screenRef?: React.Ref<HTMLDivElement>; children: React.ReactNode }) {
  return <figure className="wb-phone-wrap">
    {/* Sin nombres, el monograma derivado («U·Y») no significa nada: el CSS del creador lo oculta. */}
    <div className="wb-phone" ref={phoneRef} data-busy={busy ? "true" : "false"} data-names-missing={namesMissing ? "" : undefined}>
      <div ref={screenRef} className="wb-phone-screen" role="region" aria-label="Vista previa de vuestra invitación" tabIndex={0}>{children}</div>
    </div>
  </figure>;
}

/**
 * `stashedDraft`: copia que el servidor guardó al pedir el enlace; solo se usa si este navegador no trae borrador (el enlace se abrió en otro).
 * `accountEmail`: correo de la sesión (la publicación automática solo vale para ese correo, publish-intent.ts).
 * `pendingInvite`: /onboarding avisa de una invitación de pareja pendiente: nunca se publica solo.
 */
export function OnboardingWizard({ authenticated = true, initialIdea, initialTemplate, stashedDraft = null, accountEmail = null, pendingInvite = false }: { authenticated?: boolean; initialIdea?: string; initialTemplate?: BuilderTemplate & { name: string }; stashedDraft?: BuilderDraft | null; accountEmail?: string | null; pendingInvite?: boolean }) {
  const [draft, setDraft] = useState<BuilderDraft>(EMPTY_DRAFT);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Campo que provocó el error (aria-invalid + foco): el aviso dice qué falta y
  // el cursor ya está donde hay que corregirlo.
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoLost, setPhotoLost] = useState(false);
  // La foto del borrador ya se buscó en este navegador (esté o no): hasta
  // entonces no se publica solo (se publicaría sin ella y sin avisar).
  const [photoResolved, setPhotoResolved] = useState(false);
  // La foto está en pantalla pero el navegador no la ha podido guardar: se avisa (al volver o recargar no estaría).
  const [photoUnsaved, setPhotoUnsaved] = useState(false);
  const gallery = useCreatorGallery();
  const [selecting, setSelecting] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const [stage, setStage] = useState<"create" | FinishStage>("create");
  const [saveFailed, setSaveFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // El borrador abierto no es de este navegador: es la copia guardada con
  // el correo al pedir el enlace. Se dice y se puede descartar, nunca se
  // adopta en silencio (cualquiera puede pedir un enlace para un correo).
  const [recovered, setRecovered] = useState(false);
  const [templateNote, setTemplateNote] = useState(true);
  // Lectura de la idea con IA: qué se tomó de lo que contaron. Una lectura por texto.
  const [ideaNote, setIdeaNote] = useState<string | null>(null);
  // Texto del aviso mientras se lee (null: no se está leyendo).
  const [readingLabel, setReadingLabel] = useState<string | null>(null);
  const readingIdea = readingLabel !== null;
  const lastIdeaRead = useRef<string | null>(null);
  // Frase de la landing (`?idea=`): se lee al abrir; si choca con otra idea
  // guardada, se pregunta antes de usarla.
  const [landingRead, setLandingRead] = useState<string | null>(null);
  const [ideaConflict, setIdeaConflict] = useState<string | null>(null);
  const [landingShort, setLandingShort] = useState<string | null>(null);
  // Qué editor está abierto (hoja en el móvil, columna en escritorio).
  const [panel, setPanel] = useState<Panel | null>(null);
  const [threadOpen, setThreadOpen] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const composer = useComposerText();
  const shellRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const compact = useIsMobile();
  const finePointer = useFinePointer();
  useKeyboardAwareShell(shellRef, compact);
  // El móvil de la vista previa con sus proporciones reales, escalado para caber entero.
  const phoneSlotRef = useRef<HTMLDivElement>(null);
  // Móvil con nombres y fecha: la invitación mide lo visible sobre la barra (su
  // barra superior, los nombres y la fecha a la vista; lo demás se desplaza
  // dentro). Con huecos, más alta que lo visible y anclada a los huecos.
  // Solo la maqueta web cabe sin apretar (su portada mide la pantalla); la
  // Story conserva su alto natural y se ancla (nunca se comprime una escena).
  const readyLayout = missingEssentials(draft).length === 0;
  const webLayout = (draft.layout ?? "historia") === "web";
  const fillLayout = readyLayout && webLayout;
  const fit = useFitPreview(phoneSlotRef, true, compact ? (fillLayout ? "fill" : "width") : "contain");

  // El object URL se crea en el mismo lote que la foto (así el fundido del
  // móvil ya la incluye) y se revoca al cambiarla o al salir.
  const photoUrlRef = useRef<string | null>(null);
  const showPhoto = useCallback((next: PreparedPhoto | null) => {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = next ? URL.createObjectURL(next.blob) : null;
    setPhoto(next);
    setPhotoUrl(photoUrlRef.current);
  }, []);
  useEffect(() => () => { if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current); }, []);
  useEffect(() => {
    let saved: BuilderDraft | null = null;
    try { saved = restoreBuilderDraft(localStorage.getItem(BUILDER_STORAGE_KEY)); } catch { /* Private browsing may disable storage. */ }
    const picked = pickBuilderDraft(saved, stashedDraft);
    if (picked !== null && picked === stashedDraft && picked !== saved) setRecovered(true);
    const landing = planLandingIdea(picked, initialIdea);
    const prefilled = landing.draft;
    setLandingRead(landing.read);
    setIdeaConflict(landing.conflict);
    if (landing.short) setLandingShort(landing.short);
    // Plantilla elegida en su demo: manda sobre el diseño (no sobre lo escrito).
    const templated = initialTemplate ? applyBuilderTemplate(prefilled, initialTemplate) : prefilled;
    // Sin selector de sobre (13-oct-2026): toda invitación nueva abre con el sobre.
    const next = templated.opening !== "sobre" ? { ...templated, opening: "sobre" as const } : templated;
    // La conversación guardada es de otro borrador: fuera (antes de recuperarla).
    try {
      if (localStorage.getItem(CREATOR_CHAT_DRAFT_KEY) !== (next.updatedAt ?? "")) localStorage.removeItem(CREATOR_CHAT_STORAGE_KEY);
    } catch { /* Sin almacenamiento. */ }
    if (next !== EMPTY_DRAFT) setDraft(next);
    setReady(true);
    // La foto vive en IndexedDB (sobrevive al paso por /login). Si el
    // borrador dice que había foto y este navegador no la tiene, se avisa.
    if (next.photo === "photo") {
      void loadStoredPhoto().catch(() => null).then((stored) => {
        if (stored) showPhoto(stored);
        else {
          setPhotoLost(true);
          setDraft((old) => ({ ...old, photo: "pending" }));
        }
        // Al final: la publicación automática espera a esto.
        setPhotoResolved(true);
      });
    } else setPhotoResolved(true);
  }, [initialIdea, initialTemplate, showPhoto, stashedDraft]);
  // Fecha de la última edición (P2-4): la primera escritura tras abrir guarda el
  // borrador recuperado con su fecha; solo los cambios posteriores la renuevan.
  // Así abrir /crear en otro navegador no vuelve «nuevo» un borrador viejo.
  const editedAtRef = useRef<{ saved: boolean; at: string | undefined }>({ saved: false, at: undefined });
  useEffect(() => {
    if (!ready) return;
    const edited = editedAtRef.current;
    edited.at = edited.saved ? new Date().toISOString() : draft.updatedAt;
    edited.saved = true;
    // `step` ya no gobierna la interfaz; se guarda coherente con lo escrito para
    // que los borradores antiguos y la copia del servidor sigan entendiéndose.
    // El estado de la cabecera dice la verdad: si el navegador no deja guardar, se ve.
    try {
      localStorage.setItem(BUILDER_STORAGE_KEY, JSON.stringify({ ...draft, step: draftStep(draft), updatedAt: edited.at }));
      // La conversación sigue a este borrador (ver CREATOR_CHAT_DRAFT_KEY).
      localStorage.setItem(CREATOR_CHAT_DRAFT_KEY, edited.at ?? "");
      setSaveFailed(false);
    } catch { setSaveFailed(true); }
  }, [draft, ready]);

  const missing = missingEssentials(draft);
  const route = composerRoute(draft);
  // Cuando la invitación recibe lo que faltaba (nombres, fecha), ese bloque de
  // la portada sube y aparece (280 ms, transform/opacity): la única animación
  // de autor. Con reduced-motion, solo el fundido. No al cargar ni al recuperar.
  const settled = draftStep(draft);
  const lastSettled = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    const previous = lastSettled.current;
    lastSettled.current = settled;
    if (previous === null || settled <= previous) return;
    const reduce = prefersReducedMotion();
    const frames = reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }];
    screenRef.current?.querySelectorAll<HTMLElement>('[data-edit-path$="/names"], .sp-date').forEach((element) => {
      element.animate(frames, { duration: 280, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    });
  }, [settled, ready]);

  function patch(values: Partial<BuilderDraft>) { setError(null); setInvalidField(null); setDraft((old) => ({ ...old, ...values })); }
  /** Sugerencia de lugar elegida: lugar/dirección y el place_id de Google (si lo hay). */
  function pickPlace({ placeId, ...fields }: PickedFields) { patch({ ...fields, venuePlaceId: placeId }); }
  function fail(message: string, field?: string) {
    setError(message);
    setInvalidField(field ?? null);
    if (field) requestAnimationFrame(() => document.getElementById(field)?.focus({ preventScroll: true }));
  }

  /**
   * Abre un editor. Se pinta en el mismo toque (flushSync) para poder darle
   * el foco al campo dentro del gesto: en iOS, el teclado solo se abre así.
   */
  function openPanel(next: Panel, trigger?: HTMLElement | null) {
    triggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    haptic("select");
    flushSync(() => {
      setPanel(next);
      setSelecting(false);
      setRecovered(false);
    });
    if (next.kind === "thread") return;
    const inputId = next.kind === "field" ? FIRST_INPUT[next.field] : undefined;
    const id = next.kind === "field" && next.field === "names" && draft.partnerName1.trim().length >= 2 && draft.partnerName2.trim().length < 2 ? "wb-name-2" : inputId;
    const target = (id && document.getElementById(id)) || document.querySelector<HTMLElement>(compact ? ".wb-sheet-head h2" : ".wb-editor-head h2");
    target?.focus({ preventScroll: true });
  }
  function openField(field: CreatorField, section?: DesignSection, trigger?: HTMLElement | null) {
    openPanel({ kind: "field", field, section }, trigger);
  }
  function closePanel() {
    setPanel(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && trigger.isConnected && !trigger.closest("[inert]")) requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
  }
  /**
   * «Siguiente»: el editor del paso que sigue (orden del asistente, ver
   * `nextCreatorStep`); en el último, cierra. El foco vuelve al final al
   * control que abrió el primero.
   */
  function goNext(current: Panel) {
    const next = current.kind === "field" ? nextCreatorStep({ field: current.field, section: current.section }) : null;
    if (!next) { closePanel(); return; }
    setError(null);
    setInvalidField(null);
    openPanel({ kind: "field", field: next.field, section: next.section }, triggerRef.current);
    // El editor nuevo empieza arriba: la hoja (móvil) y la columna (escritorio) conservaban el desplazamiento del anterior.
    sheetRef.current?.querySelector<HTMLElement>(".wb-sheet-body")?.scrollTo({ top: 0 });
    shellRef.current?.querySelector<HTMLElement>(".wb-side-scroll")?.scrollTo({ top: 0 });
  }
  // Escritorio: Escape cierra el editor de la columna (la hoja lo hace sola).
  useEffect(() => {
    if (compact || !panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest("[aria-expanded='true'], .wb-fullscreen")) return;
      setPanel(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [compact, panel]);

  async function choosePhoto(file: File) {
    setError(null);
    setPhotoBusy(true);
    const prepared = await preparePhoto(file);
    setPhotoBusy(false);
    if (!prepared.ok) { setError(prepared.error); return; }
    setPhotoLost(false);
    crossfade(() => { showPhoto(prepared.photo); setDraft((old) => ({ ...old, photo: "photo" })); });
    // Si el navegador no deja guardarla, la foto sigue en memoria para esta sesión y se avisa.
    setPhotoUnsaved(false);
    void saveStoredPhoto(prepared.photo).then((saved) => setPhotoUnsaved(!saved));
  }
  function removePhoto() {
    setPhotoUnsaved(false);
    crossfade(() => { showPhoto(null); patch({ photo: "pending" }); });
    void clearStoredPhoto();
  }
  function chooseInitials() {
    setPhotoUnsaved(false);
    showPhoto(null);
    void clearStoredPhoto();
    setPhotoLost(false);
    patch({ photo: "initials" });
  }
  /**
   * Lee lo que contaron con IA en segundo plano y rellena SOLO lo que siga
   * vacío (nombres, fecha, invitados, lugar, hora; estilo y paleta si no los
   * han tocado; bienvenida si sigue la de partida). Si falla, no pasa nada.
   */
  const { setText: setComposerText } = composer;
  // Deja la frase en el compositor sin pisar lo que ya estén escribiendo.
  const offerInComposer = useCallback((text: string) => setComposerText((old) => (old.trim() ? old : text)), [setComposerText]);
  const readIdea = useCallback((idea: string, label: string = READING_IDEA) => {
    if (idea.length < IDEA_MIN_LENGTH || lastIdeaRead.current === idea) return;
    lastIdeaRead.current = idea;
    setReadingLabel(label);
    setIdeaNote(null);
    // Si no se ha podido leer, la frase vuelve al compositor: a la vista,
    // editable y lista para reenviar. Nunca se bloquea el creador.
    const unread = () => {
      setReadingLabel(null);
      lastIdeaRead.current = null;
      offerInComposer(idea);
      setIdeaNote("No hemos podido leer vuestra idea ahora. Os la dejamos abajo para reenviarla, o tocad lo que falta en la invitación y seguimos.");
    };
    void readBuilderIdea(idea).then((result) => {
      if (!result.ok) { unread(); return; }
      setReadingLabel(null);
      const { style, ...rest } = result.suggestion;
      setDraft((old) => {
        // Con plantilla, la idea no toca el diseño (estilo ni colores).
        if (old.template) return mergeIdeaSuggestion(old, { ...rest, palette: undefined });
        const styled = style && old.style === suggestWeddingStyle(old.idea) ? { ...old, style } : old;
        return mergeIdeaSuggestion(styled, rest);
      });
      const proposed = [style ? "estilo" : null, rest.palette ? "colores" : null, rest.welcomeMessage ? "bienvenida" : null].filter(Boolean) as string[];
      const joinEs = (items: string[]) => (items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`);
      const parts = [
        result.taken.length > 0 ? `De vuestra idea hemos tomado ${joinEs(result.taken)}.` : "Hemos tenido en cuenta vuestra idea.",
        proposed.length > 0 ? `Os proponemos ${joinEs(proposed)} a partir de lo que contáis.` : "",
        "Podéis cambiarlo todo.",
      ];
      setIdeaNote(parts.filter(Boolean).join(" "));
    }, unread); // Error de red o del servidor: se dice y la idea queda guardada.
  }, [offerInComposer]);
  // Llegada desde la landing: la frase se lee en cuanto el creador está listo
  // (la misma lectura y los mismos límites que al escribirla aquí).
  useEffect(() => {
    if (!ready) return;
    if (landingRead) { setLandingRead(null); readIdea(landingRead, READING_LANDING); }
    if (landingShort) {
      setLandingShort(null);
      offerInComposer(landingShort);
      setIdeaNote("Contadnos un poco más: quiénes sois, cuándo y dónde lo celebráis.");
    }
  }, [ready, landingRead, landingShort, readIdea, offerInComposer]);
  /** «Usar la nueva»: la frase de la landing sustituye a la idea guardada y se lee (solo rellena huecos). */
  function adoptLandingIdea() {
    const text = ideaConflict;
    setIdeaConflict(null);
    if (!text) return;
    setRecovered(false);
    setDraft((old) => replaceIdea(old, text));
    readIdea(text, READING_LANDING);
  }
  /** «Contadnos vuestra boda» sin nombres o sin fecha: es la idea. */
  function sendIdea() {
    const text = composer.text.trim();
    if (!text || pending) return;
    haptic("tap");
    setRecovered(false);
    setTemplateNote(false);
    setDraft((old) => {
      const next = withIdeaText(old, text, BUILDER_IDEA_MAX);
      if (next === old || next.template) return next;
      return { ...next, style: suggestWeddingStyle(next.idea) };
    });
    composer.setText("");
    // Con los nombres ya puestos, la píldora «Os falta: …» basta: dos pistas para el mismo hueco sobran.
    if (text.length < IDEA_MIN_LENGTH) { if (!hasNames(draft)) setIdeaNote("Contadnos un poco más: quiénes sois, cuándo y dónde lo celebráis."); return; }
    readIdea(text.slice(0, BUILDER_IDEA_MAX));
  }
  function discardRecovered() {
    setRecovered(false);
    showPhoto(null);
    setPhotoLost(false);
    void clearStoredPhoto();
    gallery.clear();
    void clearStashedDraft();
    setDraft(EMPTY_DRAFT);
    chat.reset();
    setPanel(null);
  }

  // --- «Pedid cambios» como chat (como Lovable) -------------------------------
  // Cada petición se aplica al momento al borrador local (`adoptProposal`,
  // también el contenido de las secciones) y es una versión que se puede
  // restaurar o deshacer. La conversación se guarda en este navegador junto
  // al borrador (lib/site-chat/persist.ts): sobrevive a recargar.
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const chatHost: SiteChatHost = {
    async snapshot() {
      // El servidor valida el documento: sin blob: (la foto local no viaja).
      const current = draftRef.current;
      return { document: composeBuilderDocument({ ...current, partnerName1: current.partnerName1.trim(), partnerName2: current.partnerName2.trim() }), base: null };
    },
    async propose({ instruction, document, focus }): Promise<ProposeSiteEditResult> {
      if (process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("ia") === "demo") {
        const { mockProposeSiteEdit } = await import("@/components/creator/dev-ai-mock");
        return mockProposeSiteEdit(instruction, document, focus);
      }
      // "creator": todo (también programa, historia, preguntas…), con los textos de ayuda del creador.
      return (authenticated ? proposeSiteEdit : proposeDraftSiteEdit)({ instruction, document, scope: "creator", ...(focus ? { focus } : {}) });
    },
    async commit(document) {
      // Nunca «Aplicado» sin que se vea: si el borrador no puede recomponer
      // lo propuesto, no se cambia nada y se dice qué no se ha podido.
      const current = draftRef.current;
      const checked = adoptChecked(current, document);
      if (!checked.ok) return { ok: false, conflict: false, error: checked.error, retryable: false };
      crossfade(() => setDraft((old) => (old === current ? checked.draft : adoptProposal(old, document))));
      haptic("success");
      return { ok: true, draftVersion: 0, historyId: null, createdAt: null };
    },
  };
  const chat = useSiteChat(chatHost, { storageKey: ready ? CREATOR_CHAT_STORAGE_KEY : null, mode: "all" });
  useFollowLastTurn(chat, threadRef);
  // Móvil: al pedir un cambio, la conversación sube en su hoja (sobre el compositor).
  const turnCount = chat.state.turns.length;
  const lastTurns = useRef(turnCount);
  useEffect(() => {
    const previous = lastTurns.current;
    lastTurns.current = turnCount;
    // Solo al pedir algo (turno en marcha): la conversación recuperada al abrir no abre la hoja.
    if (turnCount > previous && chat.busy) { if (compact) setPanel({ kind: "thread" }); else setThreadOpen(true); }
  }, [turnCount, compact, chat.busy]);
  function toggleSelect() {
    setSelecting((on) => !on);
    // Para señalar, la invitación se ve entera.
    if (compact) setPanel(null);
  }
  const pickTarget = useCallback((path: string) => {
    setSelectedPath(path);
    setSelecting(false);
  }, []);
  async function editText(path: string, value: string) {
    const check = writeEditText((await chatHost.snapshot()).document, path, value);
    if (!check.ok) return check;
    const label = describeEditTarget(check.document, path)?.label ?? "el texto";
    return chat.record((current) => {
      const written = writeEditText(current, path, value);
      return written.ok ? written.document : current;
    }, { kind: "manual", summary: `Cambiado a mano: ${label}.`, changes: [label] });
  }

  // «Una sola vez» (publish-intent.ts): lo comparten el botón y la publicación automática.
  const autoPublishGate = useRef<ReturnType<typeof createAutoPublishGate> | null>(null);
  autoPublishGate.current ??= createAutoPublishGate(browserStorage);
  // Hay intención de publicar y se espera a la foto o a las fotos: el botón lo dice y no se pulsa dos veces.
  const [autoWaiting, setAutoWaiting] = useState(false);

  function create() {
    if (!authenticated) {
      try { localStorage.setItem(BUILDER_STORAGE_KEY, JSON.stringify({ ...draft, step: draftStep(draft), updatedAt: editedAtRef.current.at ?? draft.updatedAt })); } catch { setError("El navegador no puede guardar el borrador. Permitid el almacenamiento local antes de continuar para conservarlo al iniciar sesión."); return; }
      // «Crear cuenta y publicar»: al volver con la cuenta lista, /onboarding
      // publica solo (publish-intent.ts). Si no se puede guardar la marca,
      // se publica con un toque, como antes.
      markPublishIntent(browserStorage());
      router.push("/login?registro=1"); return;
    }
    // Ya hay una creación en marcha (un toque mientras arrancaba la automática, o al revés): nada.
    if (!autoPublishGate.current?.claim()) return;
    setAutoWaiting(false);
    setError(null);
    setStage("create");
    haptic("tap");
    startTransition(async () => {
      const partnerName1 = draft.partnerName1.trim();
      const partnerName2 = draft.partnerName2.trim();
      // La acción NO redirige (regresión del sobre, 8-oct-2026): crea el borrador
      // con el documento que la pareja ve aquí (sin la foto local) y devuelve el
      // resultado; la foto, la publicación única y la navegación las hace el
      // creador después.
      let result: Awaited<ReturnType<typeof createWeddingFromCreator>>;
      try {
        // Invitados: opcional en el creador. Vacío → 100 (`guestEstimate`); la
        // pareja ajusta la cifra en su panel, donde añade a cada invitado.
        result = await createWeddingFromCreator({ partnerName1, partnerName2, weddingDate: draft.weddingDate, guestCountEst: guestEstimate(draft.guestCount), pageConfig: { style: draft.style, welcomeMessage: draft.welcomeMessage, venue: draft.venue, address: draft.address, time: draft.time, ...(draft.venuePlaceId ? { placeId: draft.venuePlaceId } : {}) }, site: composeBuilderDocument({ ...draft, partnerName1, partnerName2 }) });
      } catch {
        autoPublishGate.current?.release();
        setError("No hemos podido crear la web. Vuestro borrador sigue aquí; probad de nuevo.");
        return;
      }
      if (!result.ok) {
        if ("redirect" in result) router.replace(result.redirect);
        else { autoPublishGate.current?.release(); setError(result.error); }
        return;
      }
      const finished = await finishCreatedWedding(draft, draft.photo === "photo" ? photo : null, { upload: uploadCouplePhoto, save: saveSiteDraft, publish: publishSite, onStage: setStage }, result.site, draft.photo === "photo" ? gallery.photos : []);
      if (finished.photo === "ok" || finished.photo === "none") void clearStoredPhoto();
      if (!finished.gallery || finished.gallery.failed === 0) gallery.forget();
      router.replace(finishNotice(finished));
    });
  }
  /** «Guardar y publicar»: si falta algo imprescindible, abre ese campo con su aviso; si no, crea. */
  function publish(trigger: HTMLElement | null) {
    if (pending) return;
    const issue = essentialIssue(draft);
    if (issue) {
      openField(issue.field, undefined, trigger);
      fail(issue.message, issue.inputId);
      return;
    }
    create();
  }

  // «Crear cuenta y publicar» (publish-intent.ts): con la cuenta ya creada,
  // el asistente publica solo UNA vez, y solo si la marca es de este correo
  // y no hay invitación de pareja pendiente. La marca se borra al decidir,
  // así que recargar o volver atrás no repite nada (y, con la boda ya creada,
  // /onboarding lleva al panel). Sin sesión, abrir /crear la borra.
  useEffect(() => {
    const decision = autoPublishGate.current?.step({
      authenticated,
      email: accountEmail,
      pendingInvite,
      resolved: ready && photoResolved && gallery.restored,
      recovered,
      photoLost,
      incomplete: essentialIssue(draft) !== null,
    }) ?? null;
    if (decision === null) return;
    setAutoWaiting(decision === "wait");
    if (decision === "publish") { create(); return; }
    if (decision === "missing") {
      // Como al pulsar «Guardar y publicar»: se abre lo que falta con su aviso.
      const issue = essentialIssue(draft);
      // Fuera del efecto: el editor se abre con flushSync.
      if (issue) requestAnimationFrame(() => { openField(issue.field); fail(issue.message, issue.inputId); });
    }
    // «review»: el asistente de siempre (el borrador recuperado o la foto perdida ya tienen su aviso); publican con un toque.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, accountEmail, pendingInvite, ready, photoResolved, gallery.restored, recovered, photoLost, draft]);

  const hasPhoto = Boolean(photo && photoUrl);
  // Preview = la misma implementación que /b/[slug]; los nombres vacíos se
  // sustituyen por un texto de relleno para que la portada no quede en blanco
  // (y para que la pareja vea dónde van: es un hueco que se puede tocar).
  const baseDocument = useMemo(() => composeBuilderDocument({ ...draft, partnerName1: draft.partnerName1.trim() || "Un nombre", partnerName2: draft.partnerName2.trim() || "Otro nombre" }), [draft]);
  const localWidth = photo?.width;
  const localHeight = photo?.height;
  const localAlt = `Foto de ${draft.partnerName1.trim()} y ${draft.partnerName2.trim()}`;
  const shownDocument = useMemo(() => {
    const image: SceneImage | null = photoUrl && localWidth && localHeight ? { url: photoUrl, alt: localAlt, width: localWidth, height: localHeight } : null;
    return withCreatorGallery(withLocalImage(baseDocument, image), image ? gallery.localImages : []);
  }, [baseDocument, photoUrl, localWidth, localHeight, localAlt, gallery.localImages]);
  // El sobre no se enseña en la vista previa (taparía la portada y lo recién
  // escrito): se ve en «Ampliar» y al publicar.
  // Con plantilla, el móvil enseña su estructura entera: lo que aún falta va
  // como hueco (lib/template-preview.ts). Solo aquí: «Ampliar» y la web
  // publicada enseñan lo que la pareja ha puesto.
  const templatePreview = useMemo(() => withTemplatePreview({ ...shownDocument, opening: "ninguno" }, { template: draft.template, photo: draft.photo }), [shownDocument, draft.template, draft.photo]);
  const previewDocument = templatePreview.document;
  const cover = findScene(shownDocument, "cover");
  const coverId = cover?.id ?? LEGACY_SCENE_IDS.cover;
  const venueId = findScene(shownDocument, "venue")?.id ?? LEGACY_SCENE_IDS.venue;
  // El móvil enseña la escena del editor abierto (en la Story), si tiene algo que enseñar.
  const withContent = (scene: SiteDocument["scenes"][number] | undefined) => (scene && sceneHasContent(scene) ? scene : undefined);
  const editing = panel?.kind === "field" ? panel.field : null;
  const activeSceneId = (editing === "venue" ? withContent(findScene(shownDocument, "venue")) : editing === "day" ? withContent(findScene(shownDocument, "agenda")) : editing === "story" ? withContent(findScene(shownDocument, "story")) : undefined)?.id ?? cover?.id;

  // Huecos: lo que falta, marcado y tocable en la propia invitación.
  // Detalles y preguntas se rellenan pidiéndolo («Pedid cambios»): solo son
  // hueco cuando el compositor ya pide cambios (con nombres y fecha).
  const chatRoute = composerRoute(draft) === "chat";
  const templateGaps = templatePreview.gaps.filter((gap) => chatRoute || (gap.kind !== "details" && gap.kind !== "faq"));
  const gaps = selecting ? [] : [...gapPaths(draft, coverId), ...templateGaps.map((gap) => gap.path)];
  const pickGap = (path: string) => {
    const gap = templateGaps.find((item) => item.path === path);
    if (gap) {
      if (gap.kind === "details" || gap.kind === "faq") composer.fill(TEMPLATE_GAP_PROMPT[gap.kind]);
      else openField(gap.kind === "story" ? "story" : "photo", undefined, screenRef.current);
      return;
    }
    const field = fieldForEditPath(path, { cover: coverId, venue: venueId });
    if (field) openField(field, undefined, screenRef.current);
  };
  const gapLabel = (path: string) => {
    const gap = templateGaps.find((item) => item.path === path);
    if (gap) return TEMPLATE_GAP_LABEL[gap.kind];
    return path.endsWith("/names") ? "Escribir vuestros nombres" : "Elegir la fecha";
  };
  useGapTargets({ container: screenRef, paths: gaps, refreshKey: previewDocument, onPick: pickGap, label: gapLabel });

  // En el creador solo se editan a mano los textos que guarda el borrador local.
  const target: EditTarget | null = creatorEditTarget(selectedPath ? describeEditTarget(baseDocument, selectedPath) : null);
  usePreviewSelection({ container: screenRef, active: selecting, selected: target ? selectedPath : null, refreshKey: previewDocument, onPick: pickTarget });
  // Escritorio con ratón: tocar la invitación edita ahí mismo o abre su editor
  // (punto 6 del backlog). Nunca en compacto ni con «Seleccionar».
  const liveEdit = ready && !compact && finePointer && !selecting && !pending && !chat.busy;
  const resolveLive = (path: string) => (gaps.includes(path) ? null : creatorLiveRoute(baseDocument, path, { cover: coverId, venue: venueId, chat: chatRoute }));
  function openLive(route: Exclude<LiveEditRoute, { kind: "text" }>, path: string, element: HTMLElement) {
    if (route.kind === "field") {
      openField(route.field, undefined, element);
      const inputId = route.inputId;
      if (!inputId) return;
      // Las filas de «Vuestro día» pueden aparecer un instante después (materializeDay): se reintenta unos fotogramas.
      let tries = 0;
      const focusInput = () => {
        const input = document.getElementById(inputId);
        if (input) { input.focus({ preventScroll: true }); input.scrollIntoView({ block: "nearest" }); return; }
        if (++tries < 6) requestAnimationFrame(focusInput);
      };
      requestAnimationFrame(focusInput);
      return;
    }
    // Sin editor propio: queda seleccionado para «Pedid cambios», con el cursor en el compositor.
    pickTarget(path);
    requestAnimationFrame(() => composer.inputRef.current?.focus({ preventScroll: true }));
  }

  const pastPrompts = chat.state.turns.flatMap((t) => (t.kind === "ai" ? [t.prompt] : []));
  // El creador ya cambia contenido (13-oct-2026): también se sugiere.
  const suggestions = suggestNextPrompts(baseDocument, { exclude: pastPrompts });
  const chips = understoodChips(draft);
  const extras = creatorExtras(draft, hasPhoto);
  const empty = !draft.idea.trim() && chips.length === 0 && !composer.text;
  useAutoGrow(composer.inputRef, composer.text, ready);

  // La hoja tapa parte de la invitación: el hueco de la vista previa se
  // recorta a lo que queda por encima (el móvil se reescala y sigue entero).
  const panelOpen = compact && panel !== null;
  const sheetKind = panel?.kind === "thread" ? "thread" : "field";
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      const barH = barRef.current?.offsetHeight ?? 0;
      shell.style.setProperty("--wb-bar-h", `${Math.round(barH)}px`);
      if (!panelOpen) { shell.style.removeProperty("--wb-cover"); return; }
      const sheetH = sheetRef.current?.offsetHeight ?? 0;
      const cover = sheetKind === "thread" ? sheetH + 8 : Math.max(0, sheetH - barH);
      shell.style.setProperty("--wb-cover", `${Math.round(cover)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (sheetRef.current) observer.observe(sheetRef.current);
    if (barRef.current) observer.observe(barRef.current);
    return () => observer.disconnect();
  }, [panelOpen, sheetKind]);

  // Móvil: la invitación va a lo ancho, más alta que lo visible, y la barra
  // (y la hoja) se apoyan encima. Se desplaza hacia arriba lo justo para que
  // los nombres y la fecha queden a la vista sobre la barra, sin perder su
  // parte de arriba (se recorta la banda vacía de la portada).
  useEffect(() => {
    const phone = phoneRef.current;
    if (!compact || !phone) { phone?.style.removeProperty("--wb-shift"); return; }
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const slot = phoneSlotRef.current;
        const screen = screenRef.current;
        const shell = shellRef.current;
        if (!slot || !screen || !shell) return;
        // Lista para publicar (sin editor abierto): también la bienvenida y la
        // cuenta atrás de la portada; solo dentro de la portada (la web las
        // tiene en otras secciones, más abajo).
        const names = screen.querySelector<HTMLElement>('[data-edit-path$="/names"]');
        const cover = names?.closest<HTMLElement>("header") ?? screen;
        const selector = `[data-edit-path$="/names"], [data-edit-path$="/${DATE_GAP_FIELD}"], .sp-date${readyLayout && !panel ? ', [data-edit-path$="/welcomeMessage"], .sp-countdown' : ""}`;
        const blocks = Array.from(cover.querySelectorAll<HTMLElement>(selector)).filter((el) => el.offsetParent !== null);
        phone.style.removeProperty("--wb-chrome-top");
        phone.style.removeProperty("--wb-chrome-bottom");
        if (blocks.length === 0) { phone.style.setProperty("--wb-shift", "0px"); return; }
        const phoneTop = phone.getBoundingClientRect().top;
        const slotTop = slot.getBoundingClientRect().top;
        const rel = blocks.map((el) => { const rect = el.getBoundingClientRect(); return { top: rect.top - phoneTop, bottom: rect.bottom - phoneTop }; });
        const top = Math.min(...rel.map((r) => r.top));
        const bottom = Math.max(...rel.map((r) => r.bottom));
        const barTop = barRef.current?.getBoundingClientRect().top ?? shell.getBoundingClientRect().bottom;
        const sheetH = panel ? sheetRef.current?.offsetHeight ?? 0 : 0;
        const coverTop = panel ? (panel.kind === "thread" ? barTop - sheetH - 8 : shell.getBoundingClientRect().bottom - sheetH) : barTop;
        // La barra funde la invitación justo encima de su borde: lo que importa, por encima
        // (los primeros ~16 px del fundido apenas tapan; el resto, sí).
        const readyStory = readyLayout && !panel && !webLayout;
        const visibleBottom = readyStory ? barTop - 38 : Math.min(barTop - 44, coverTop) - (panel ? 12 : 16);
        // Story lista, sin editor: su cromo (progreso arriba; ‹ «Ver todos los
        // detalles» › abajo) se queda fijo en lo visible aunque la escena suba.
        const storyChrome = readyLayout && !panel ? screen.querySelector<HTMLElement>(".sp:not([data-view='all']) .sp-top") : null;
        const chromeTop = storyChrome && storyChrome.offsetParent !== null ? storyChrome.querySelector<HTMLElement>(".sp-progress")?.getBoundingClientRect().bottom ?? null : null;
        const topReserve = chromeTop !== null ? chromeTop - phoneTop + 6 : 0;
        const need = slotTop + bottom - visibleBottom;
        // Editando, se puede recortar lo de encima de los nombres (el titular
        // pequeño): el campo que se escribe queda entero sobre la hoja.
        // Lista y sin editor: tampoco se corta el monograma de la portada (Story).
        const mono = readyLayout && !panel ? cover.querySelector<HTMLElement>(".sp-monogram") : null;
        const ceiling = mono && mono.offsetParent !== null ? Math.min(top, mono.getBoundingClientRect().top - phoneTop) : top;
        const room = Math.max(0, panel ? top - 2 : ceiling - Math.max(12, topReserve));
        // Si caben, se sube también lo justo para dejar sitio a los controles de la Story.
        const controlsEl = storyChrome ? screen.querySelector<HTMLElement>(".sp:not([data-view='all']) .sp-bottom") : null;
        const controlsH = controlsEl && controlsEl.offsetParent !== null ? controlsEl.getBoundingClientRect().height : 0;
        const withControls = controlsH > 0 ? need + controlsH + 8 : Infinity;
        const base = Math.round(Math.max(0, withControls <= room ? withControls : Math.min(need, room)));
        // Sin foto, sin editor y aún con huecos (P2-10): en pantallas altas, bastaba con subir
        // lo justo y quedaba una banda vacía arriba. Se sube más para que el
        // titular pequeño quede a ~100 px de la franja blanca…
        let shift = base;
        const eyebrow = !panel && !readyLayout && !cover.hasAttribute("data-photo") ? cover.querySelector<HTMLElement>('[data-edit-path$="/eyebrow"]') : null;
        if (eyebrow && eyebrow.offsetParent !== null) {
          const eyebrowTop = eyebrow.getBoundingClientRect().top - phoneTop;
          // Tope: el borde inferior de la invitación sube como mucho hasta el
          // fundido de la barra (44 px sobre ella); más arriba se vería una banda vacía abajo.
          const floor = slotTop + phone.getBoundingClientRect().height - (barTop - 44);
          shift = Math.max(base, Math.min(Math.round(room), Math.round(floor), Math.round(eyebrowTop - COVER_TOP_GAP)));
          // …sin dejar la bienvenida a medias en el fundido: o entera a la
          // vista o escondida bajo la barra.
          const welcome = cover.querySelector<HTMLElement>('[data-edit-path$="/welcomeMessage"]');
          if (welcome && welcome.offsetParent !== null) {
            const rect = welcome.getBoundingClientRect();
            const wTop = slotTop + rect.top - phoneTop - shift;
            const wBottom = slotTop + rect.bottom - phoneTop - shift;
            if (shift > base && wTop < barTop && wBottom > visibleBottom) shift = Math.max(base, Math.min(shift, Math.round(slotTop + rect.top - phoneTop - barTop)));
          }
        }
        phone.style.setProperty("--wb-shift", `${-shift}px`);
        if (storyChrome && chromeTop !== null) {
          const scale = phone.getBoundingClientRect().width / phone.offsetWidth || 1;
          phone.style.setProperty("--wb-chrome-top", `${(shift / scale).toFixed(1)}px`);
          // Abajo, solo si cabe sin pisar la portada (encima del fundido).
          const controls = screen.querySelector<HTMLElement>(".sp:not([data-view='all']) .sp-bottom");
          if (controls && controls.offsetParent !== null) {
            const rect = controls.getBoundingClientRect();
            const naturalBottom = rect.bottom - phoneTop + slotTop - shift;
            const lift = Math.max(0, naturalBottom - visibleBottom);
            const newTop = rect.top - phoneTop + slotTop - shift - lift;
            if (newTop >= slotTop + bottom - shift + 4) phone.style.setProperty("--wb-chrome-bottom", `${(-lift / scale).toFixed(1)}px`);
          }
        }
      });
    };
    run();
    const observer = new ResizeObserver(run);
    if (phoneSlotRef.current) observer.observe(phoneSlotRef.current);
    if (barRef.current) observer.observe(barRef.current);
    if (sheetRef.current) observer.observe(sheetRef.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [compact, panel, previewDocument, fit, readyLayout, webLayout]);

  const primaryLabel = pending ? STAGE_LABEL[stage] : autoWaiting ? AUTO_WAIT_LABEL : authenticated ? "Guardar y publicar" : "Crear cuenta y publicar";
  const saveLabel = !ready ? "Abriendo vuestro borrador…" : saveFailed ? "Este navegador no deja guardar el borrador" : "Guardado en este navegador";
  const missingLabel = missing.map((field) => (field === "names" ? "nombres" : "fecha")).join(" · ");
  const designLocked = chat.busy || pending;

  const designPicker = (only?: DesignSection) => <PalettePicker
    only={only}
    selected={selectedPalette(draft)}
    style={draft.style}
    disabled={designLocked}
    onPalette={(palette) => { haptic("select"); crossfade(() => patch({ palette })); }}
    onStyle={(style) => { haptic("select"); crossfade(() => patch({ style })); }}
  />;

  const errorNote = error ? <p role="alert" id="wb-error" className="wb-error">{error}</p> : null;

  /** Editor de cada campo (dentro de la hoja o de la columna). */
  function fieldEditor(field: CreatorField, section?: DesignSection) {
    switch (field) {
      case "names":
        return <div className="wb-field-pair">
          <label>Un nombre<input id="wb-name-1" aria-invalid={invalidField === "wb-name-1" || undefined} aria-describedby={invalidField === "wb-name-1" ? "wb-error" : undefined} autoComplete="given-name" autoCapitalize="words" enterKeyHint="next" required minLength={2} maxLength={80} value={draft.partnerName1} onChange={(event) => patch({ partnerName1: event.target.value })} placeholder="Marta" /></label>
          <label>Y el otro<input id="wb-name-2" aria-invalid={invalidField === "wb-name-2" || undefined} aria-describedby={invalidField === "wb-name-2" ? "wb-error" : undefined} autoComplete="off" autoCapitalize="words" enterKeyHint="done" required minLength={2} maxLength={80} value={draft.partnerName2} onChange={(event) => patch({ partnerName2: event.target.value })} placeholder="Jaime" /></label>
        </div>;
      case "date":
        return <label>La fecha de vuestra boda<input id="wb-date" aria-invalid={invalidField === "wb-date" || undefined} aria-describedby={invalidField === "wb-date" ? "wb-error" : undefined} required type="date" value={draft.weddingDate} onChange={(event) => patch({ weddingDate: event.target.value })} /></label>;
      case "venue":
        return <>
          <PlaceCombobox id="wb-venue" label="Lugar de la celebración" maxLength={160} enterKeyHint="next" value={draft.venue} onChange={(venue) => patch({ venue, venuePlaceId: undefined })} onPick={(place) => pickPlace(pickedIntoVenue(place))} placeholder="Finca Los Olivos" />
          <div className="wb-field-pair">
            <PlaceCombobox id="wb-address" label="Dirección (opcional)" maxLength={240} enterKeyHint="next" value={draft.address} onChange={(address) => patch({ address, venuePlaceId: undefined })} onPick={(place) => pickPlace(pickedIntoAddress(place, draft.venue))} placeholder="Municipio o dirección" />
            <label>Hora (opcional)<input type="time" value={draft.time} onChange={(event) => patch({ time: event.target.value })} /></label>
          </div>
        </>;
      case "guests":
        return <>
          <label>Personas, aproximadamente (opcional)<input id="wb-guests" aria-invalid={invalidField === "wb-guests" || undefined} aria-describedby={invalidField === "wb-guests" ? "wb-error" : undefined} type="number" inputMode="numeric" enterKeyHint="done" min={1} max={2000} step={1} value={draft.guestCount} onChange={(event) => patch({ guestCount: event.target.value })} placeholder="Por ejemplo, 120" /></label>
          <p className="wb-help">Esta cifra no crea invitados. Si la dejáis vacía, contamos con unas 100 personas y la ajustáis en vuestro panel.</p>
          <ModulePicker draft={draft} onChange={(modules) => patch({ modules })} onPatch={patch} />
        </>;
      case "day":
        return <DayStep draft={draft} onPatch={patch} />;
      case "story":
        return <StoryStep draft={draft} onPatch={patch} />;
      case "welcome":
        return <>
          <label>Vuestro mensaje de bienvenida<textarea id="wb-welcome" rows={4} maxLength={400} value={draft.welcomeMessage} onChange={(event) => patch({ welcomeMessage: event.target.value })} /></label>
          <p className="wb-help">Escribid como habláis con vuestra gente. El lugar y la fecha tienen su propio espacio.</p>
        </>;
      case "photo":
        return <>
          <PhotoStep photoUrl={photoUrl} initials={initialsOf(draft.partnerName1, draft.partnerName2)} busy={photoBusy} chosenInitials={draft.photo === "initials"} onFile={(file) => void choosePhoto(file)} onRemove={removePhoto} onInitials={chooseInitials} />
          {photoUrl && <GalleryPicker gallery={gallery} disabled={photoBusy} />}
        </>;
      case "design":
        return designPicker(section);
    }
  }
  function panelCopy(current: Panel): { title: string; lead?: string } {
    if (current.kind === "extras") return { title: "Añadir más", lead: "Todo es opcional. Lo que completéis aparece en la invitación al momento." };
    if (current.kind === "thread") return { title: "Pedid cambios" };
    if (current.field === "design") return DESIGN_COPY[current.section ?? "colores"];
    return FIELD_COPY[current.field];
  }

  const extrasList = <ul className="wb-extras" aria-label="Añadir más">
    {extras.map((extra) => <li key={extra.label}>
      <button type="button" className="wb-extra" data-done={extra.done ? "true" : undefined} onClick={(event) => openField(extra.field, undefined, event.currentTarget)} disabled={pending}>
        <span className="wb-extra-mark" aria-hidden="true">{extra.done ? <CheckIcon size={14} strokeWidth={2.25} /> : <PlusIcon size={14} strokeWidth={2} />}</span>
        <span className="wb-extra-label">{extra.label}</span>
        <span className="sr-only">{extra.done ? "(hecho)" : "(sin completar)"}</span>
      </button>
    </li>)}
  </ul>;

  const chipRow = chips.length > 0 && <div className="wb-understood" role="group" aria-label="Lo que hemos entendido (tocad para cambiarlo)">
    {chips.map((chip) => <button key={chip.field} type="button" className="wb-fact" onClick={(event) => openField(chip.field, chip.field === "design" ? "colores" : undefined, event.currentTarget)} disabled={pending} aria-label={`${chip.label}: ${chip.value}. Cambiar`}>
      <CheckIcon aria-hidden="true" size={14} strokeWidth={2.25} />
      <span>{chip.value}</span>
    </button>)}
  </div>;

  const notes = <div className="wb-notes" aria-live="polite">
    {draft.template && templateNote && <p className="wb-note">Empezáis con {initialTemplate?.id === draft.template ? <>la plantilla <strong>«{initialTemplate.name}»</strong></> : "la plantilla que elegisteis"}: el mismo estilo, colores y sobre que habéis visto. Los cambiáis cuando queráis en Colores y Letra.<button type="button" className="wb-note-close" aria-label="Cerrar el aviso" onClick={() => setTemplateNote(false)}><XIcon aria-hidden="true" size={14} strokeWidth={2} /></button></p>}
    {recovered && <p className="wb-note">Hemos recuperado lo que preparasteis con este correo{draft.partnerName1.trim() && draft.partnerName2.trim() ? <> (<strong>{draft.partnerName1.trim()} y {draft.partnerName2.trim()}</strong>)</> : null}. Seguís donde lo dejasteis{authenticated ? ": cuando esté a vuestro gusto, pulsad «Guardar y publicar»" : ""}. <button type="button" className="wb-note-link" onClick={discardRecovered}>No es nuestro: empezar de cero</button></p>}
    {photoLost && <p className="wb-note">No encontramos aquí la foto que elegisteis (se quedó en otro navegador o este no pudo guardarla). Elegidla de nuevo en Añadir más › Vuestra foto, o seguid con vuestras iniciales.</p>}
    {photoUnsaved && hasPhoto && <p className="wb-note wb-note-warn">Este navegador no deja guardar vuestra foto: si recargáis o volvéis atrás, tendréis que elegirla otra vez.</p>}
    {ideaConflict && <p className="wb-note">Ya teníais una invitación empezada con otra idea. ¿Usamos la que acabáis de escribir («{ideaConflict.length > 80 ? `${ideaConflict.slice(0, 80).trimEnd()}…` : ideaConflict}»)? Solo rellena lo que aún esté vacío. <button type="button" className="wb-note-link" onClick={adoptLandingIdea}>Usar la nueva</button> <button type="button" className="wb-note-link" onClick={() => setIdeaConflict(null)}>Seguir con la de antes</button></p>}
    {readingIdea && <p className="wb-note wb-reading" role="status"><span className="wb-thinking-dots" aria-hidden="true"><span /><span /><span /></span>{readingLabel}</p>}
    {ideaNote && !readingIdea && <p className="wb-note" role="status">{ideaNote}<button type="button" className="wb-note-close" aria-label="Cerrar el aviso" onClick={() => setIdeaNote(null)}><XIcon aria-hidden="true" size={14} strokeWidth={2} /></button></p>}
    {saveFailed && <p className="wb-note wb-note-warn">Este navegador no deja guardar el borrador: si cerráis la pestaña, se pierde.</p>}
    {!panel && errorNote}
  </div>;

  // Compositor: idea mientras falten nombres o fecha; después, «Pedid cambios».
  const ideaComposer = <div className="sc-composer wb-say-idea">
    <label htmlFor="wb-idea" className="sc-ai-label">Cread vuestra invitación con IA</label>
    <form className="sc-box" onSubmit={(event) => { event.preventDefault(); sendIdea(); }}>
      <textarea
        id="wb-idea"
        ref={composer.inputRef}
        rows={1}
        maxLength={BUILDER_IDEA_MAX}
        value={composer.text}
        disabled={pending || !ready}
        enterKeyHint="send"
        placeholder={draft.idea.trim() ? "Contadnos algo más: quiénes sois, cuándo, dónde…" : "Contadnos vuestra boda: quiénes sois, cuándo y dónde…"}
        onChange={(event) => composer.setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendIdea(); } }}
      />
      <button type="submit" className="sc-send" disabled={pending || !ready || !composer.text.trim() || readingIdea} aria-label="Enviar">
        <ArrowUpIcon aria-hidden="true" size={18} strokeWidth={1.75} />
      </button>
    </form>
  </div>;
  // Con un editor abierto, «Pedid cambios» sugiere lo propio de esa sección.
  const changePrompt = panel?.kind === "field" ? (panel.field === "design" ? DESIGN_CHANGE_PROMPT : SECTION_CHANGE_PROMPTS[FIELD_SCENE[panel.field]]) : "Pedid cambios: un verde más suave, otra bienvenida…";
  const chatComposer = <ChatComposer chat={chat} composer={composer} target={target} onClearTarget={() => setSelectedPath(null)} selecting={selecting} onToggleSelect={toggleSelect} onEditText={editText} notice={chatNotice} disabled={pending} placeholder={changePrompt} />;
  const threadList = <ol className="wb-turns" aria-label="Conversación">
    <ChatTurns chat={chat} suggestions={suggestions} composer={composer} disabled={pending} onNotice={setChatNotice} appliedLabel="Aplicado en vuestra invitación" />
  </ol>;

  // Escritorio: la conversación (también con un paso abierto). En el móvil va en su hoja.
  const threadSection = turnCount > 0 && <section className="wb-thread" aria-labelledby="wb-thread-title">
    <h2 id="wb-thread-title"><button type="button" className="wb-thread-toggle" aria-expanded={threadOpen} aria-controls="wb-thread-list" onClick={() => setThreadOpen((on) => !on)}>
      Pedid cambios<ChevronDownIcon aria-hidden="true" size={16} strokeWidth={1.75} />
    </button></h2>
    <div id="wb-thread-list" hidden={!threadOpen}>{threadList}</div>
  </section>;

  const dockButtons = (withAdd: boolean) => <>
    {withAdd && <button type="button" className="wb-dock-btn wb-only-compact" aria-haspopup="dialog" aria-expanded={panel?.kind === "extras"} onClick={(event) => openPanel({ kind: "extras" }, event.currentTarget)} disabled={pending}>
      <PlusIcon aria-hidden="true" size={18} strokeWidth={1.75} /><span>Añadir</span>
    </button>}
    {DOCK.map(({ section, label, Icon }) => <button key={section} type="button" className="wb-dock-btn" aria-pressed={panel?.kind === "field" && panel.field === "design" && panel.section === section} onClick={(event) => openField("design", section, event.currentTarget)} disabled={pending}>
      <Icon aria-hidden="true" size={18} strokeWidth={1.75} /><span>{label}</span>
    </button>)}
    <button type="button" className="wb-dock-btn" onClick={() => setFullscreen(true)}>
      <Maximize2Icon aria-hidden="true" size={18} strokeWidth={1.75} /><span className="wb-only-wide">Ver en grande</span><span className="wb-only-compact">Ampliar</span>
    </button>
  </>;

  const privacy = <>
    <p className="wb-help wb-after">{authenticated ? "Al publicarla, la web estará disponible para quienes tengan su enlace. Podréis editarla desde vuestro panel." : "Cread vuestra cuenta con vuestro email: si la confirmáis en este navegador, publicamos la web al entrar y estará disponible para quienes tengan su enlace."}</p>
    <p className="wb-privacy">El borrador se guarda en este navegador. Si pedís el correo de acceso, guardamos una copia del texto, sin la foto, hasta 7 días. <Link href="/privacidad">Privacidad</Link></p>
  </>;

  // Sin sesión, bajo el botón: lo que cuesta crear la cuenta. «Guardado en
  // este navegador» sigue arriba, junto a la marca (estado del borrador).
  const accountNote = !authenticated && <p className="wb-save wb-account-note">Gratis · con vuestro correo</p>;
  const primary = (className: string) => <button type="button" className={className} data-quiet={missing.length > 0 && !pending ? "" : undefined} aria-busy={pending || autoWaiting || undefined} disabled={!ready || autoWaiting} onClick={(event) => publish(event.currentTarget)}>
    {primaryLabel}{(pending || autoWaiting) && <span className="wb-spinner" aria-hidden="true" />}
  </button>;

  /** Abajo a la derecha de cada editor: «Siguiente» o, en el último paso, «Hecho». */
  const stepButton = (current: Extract<Panel, { kind: "field" }>) => {
    const next = nextCreatorStep({ field: current.field, section: current.section });
    return <button type="button" className="wb-done-btn wb-next-btn" onClick={() => goNext(current)}>
      {next ? <>Siguiente<ChevronRightIcon aria-hidden="true" size={16} strokeWidth={2} /></> : "Hecho"}
    </button>;
  };
  const sheetPanel = compact ? panel : null;
  const sheetCopy = sheetPanel ? panelCopy(sheetPanel) : { title: "" };
  const inlinePanel = !compact && panel && panel.kind === "field" ? panel : null;

  // Escritorio sin nombres o sin fecha: la columna empieza por «contadnos»
  // (el compositor bajo el título); con los dos, el compositor baja al pie.
  const composerTop = !compact && missing.length > 0 && !inlinePanel;
  const missingPill = missing.length > 0 && !selecting && <button type="button" className="wb-missing-pill" onClick={(event) => openField(missing[0]!, undefined, event.currentTarget)} disabled={pending}>
    <span aria-hidden="true" className="wb-missing-dot" />Os falta: {missingLabel}
  </button>;
  const exampleChips = empty && route === "idea" && <div className="wb-chips" role="group" aria-label="Ejemplos para empezar">{ideaChips.map((idea) => <button key={idea} type="button" className="wb-chip" onClick={() => { haptic("select"); composer.fill(idea); }}>{idea}</button>)}</div>;
  const say = <div className="wb-say">{route === "idea" ? ideaComposer : chatComposer}</div>;

  return <div ref={shellRef} className="wb-shell wb-app" data-panel={panel ? panel.kind : undefined} data-route={route} data-start={composerTop ? "" : undefined} data-ready={fillLayout ? "" : undefined}>
    <aside className="wb-side" aria-label="Vuestra invitación">
      <div className="wb-side-top wb-only-wide">
        <div className="wb-side-brand">
          <Link href="/" className="wb-brand" aria-label="vinklo, inicio"><LazoIcon className="wb-brand-mark" aria-hidden="true" /><span aria-hidden="true">v<span className="wb-brand-i">ı</span>nklo</span></Link>
          <span className="wb-save" data-failed={saveFailed ? "true" : undefined} aria-live="polite">{saveLabel}</span>
        </div>
        <h1 className="wb-title">{missing.length > 0 ? "Contadnos vuestra boda" : <>{draft.partnerName1.trim()} <em>y</em> {draft.partnerName2.trim()}</>}</h1>
        {missing.length === 0 && <>{primary("wb-primary wb-publish")}{accountNote}</>}
      </div>
      <h1 className="sr-only wb-only-compact">Vuestra invitación</h1>

      <div className="wb-side-scroll" ref={compact ? undefined : threadRef}>
        {inlinePanel ? <section className="wb-editor" aria-labelledby="wb-editor-title">
          <header className="wb-editor-head">
            <div><h2 id="wb-editor-title" tabIndex={-1}>{panelCopy(inlinePanel).title}</h2><p>{panelCopy(inlinePanel).lead}</p></div>
            <button type="button" className="wb-close-btn" aria-label="Cerrar" onClick={closePanel}><XIcon aria-hidden="true" size={18} strokeWidth={1.75} /></button>
          </header>
          <form className="wb-composer wb-fields" onSubmit={(event) => { event.preventDefault(); closePanel(); }} noValidate>
            <fieldset disabled={pending}><legend className="sr-only">{panelCopy(inlinePanel).title}</legend>{fieldEditor(inlinePanel.field, inlinePanel.section)}</fieldset>
            {errorNote}
          </form>
          <div className="wb-step-foot">{stepButton(inlinePanel)}</div>
          {/* Con un paso abierto, la respuesta a «Pedid cambios» también se ve (antes quedaba oculta tras el editor). */}
          {threadSection}
        </section> : composerTop ? <>
          <div className="wb-start">
            <p className="wb-start-lead">Quiénes sois, cuándo y dónde lo celebráis: la invitación se rellena con lo que nos contéis.</p>
            {say}
            {exampleChips}
            {notes}
            {chipRow}
          </div>
          {primary("wb-primary wb-publish")}
          {accountNote}
          <section className="wb-missing" aria-labelledby="wb-missing-title">
            <h2 id="wb-missing-title">Os falta</h2>
            <p>Tocadlo en la invitación o aquí. Es lo único imprescindible.</p>
            <div className="wb-missing-list">
              {missing.map((field) => <button key={field} type="button" className="wb-gap-btn" onClick={(event) => openField(field, undefined, event.currentTarget)} disabled={pending}>{field === "names" ? "Vuestros nombres" : "La fecha"}</button>)}
            </div>
          </section>
          <section className="wb-more" aria-labelledby="wb-more-title">
            <h2 id="wb-more-title"><button type="button" className="wb-thread-toggle" aria-expanded={moreOpen} aria-controls="wb-more-list" onClick={() => setMoreOpen((on) => !on)}>
              Añadir más<span className="wb-more-hint">foto, lugar, programa…</span><ChevronDownIcon aria-hidden="true" size={16} strokeWidth={1.75} />
            </button></h2>
            <div id="wb-more-list" hidden={!moreOpen}>{extrasList}</div>
          </section>
          <div className="wb-side-foot">{privacy}</div>
        </> : <>
          {chipRow}
          <section className="wb-more" aria-labelledby="wb-more-title">
            <h2 id="wb-more-title">Añadir más</h2>
            {extrasList}
          </section>
          {threadSection}
          <div className="wb-side-foot">{privacy}</div>
        </>}
      </div>

      <div className="wb-bar" ref={barRef}>
        {compact && !panel && missingPill}
        {!composerTop && notes}
        {compact && chips.length > 0 && chipRow}
        {route === "chat" && compact && turnCount > 0 && <button type="button" className="wb-thread-pill" aria-haspopup="dialog" aria-expanded={panel?.kind === "thread"} onClick={(event) => openPanel({ kind: "thread" }, event.currentTarget)}>
          <MessageCircleIcon aria-hidden="true" size={15} strokeWidth={1.75} />Ver la conversación ({chat.state.turns.filter((turn) => turn.kind === "ai").length})
        </button>}
        <nav className="wb-dock" aria-label="Diseño">{dockButtons(true)}</nav>
        {!composerTop && exampleChips}
        {!composerTop && say}
      </div>
    </aside>

    <main className="wb-stage" aria-label="Vuestra invitación, en vivo" data-proposal={chat.busy ? "loading" : "idle"} data-fit={fit ? (fit.hidden ? "hidden" : "on") : undefined} style={fit ? ({ "--wb-w": `${fit.w}px`, "--wb-h": `${fit.h}px`, "--wb-scale": fit.scale } as React.CSSProperties) : undefined}>
      {selecting && <p className="wb-stage-note" role="status">Tocad una sección o un texto para centrar ahí el cambio.</p>}
      <div ref={phoneSlotRef} className="wb-phone-slot">
        <PhoneFrame busy={chat.busy} namesMissing={!hasNames(draft)} phoneRef={phoneRef} screenRef={screenRef}>
          <InvitationRenderer document={previewDocument} mode="preview" plan="free" activeSceneId={activeSceneId} editTargets />
          <LiveEditLayer container={screenRef} enabled={liveEdit} refreshKey={previewDocument} resolve={resolveLive} onEditText={editText} onOpen={openLive} />
        </PhoneFrame>
      </div>
      <div className="wb-stage-top wb-only-compact">{accountNote}{primary("wb-primary wb-publish-pill")}</div>
    </main>

    {compact && <CreatorSheet open={sheetPanel !== null} kind={sheetKind} title={sheetCopy.title} lead={sheetCopy.lead} onClose={closePanel} sheetRef={sheetRef} bodyRef={sheetPanel?.kind === "thread" ? threadRef : undefined} footer={sheetPanel?.kind === "field" ? stepButton(sheetPanel) : undefined}>
      {sheetPanel?.kind === "field" && <form className="wb-composer wb-fields" onSubmit={(event) => { event.preventDefault(); closePanel(); }} noValidate>
        <fieldset disabled={pending}><legend className="sr-only">{sheetCopy.title}</legend>{fieldEditor(sheetPanel.field, sheetPanel.section)}</fieldset>
        {errorNote}
      </form>}
      {sheetPanel?.kind === "extras" && <>
        {extrasList}
        <p className="wb-save wb-save-sheet" data-failed={saveFailed ? "true" : undefined}>{saveLabel}</p>
        {privacy}
      </>}
      {sheetPanel?.kind === "thread" && threadList}
    </CreatorSheet>}
    <FullscreenPreview document={shownDocument} open={fullscreen} onClose={() => setFullscreen(false)} />
  </div>;
}

/**
 * Módulos (8-oct-2026): lo que la web mostrará y el formulario preguntará
 * además de la asistencia. Vienen marcados si lo contasteis en la idea; se
 * marcan o desmarcan con un toque (después, también desde el editor).
 */
function ModulePicker({ draft, onChange, onPatch }: { draft: BuilderDraft; onChange(modules: BuilderModuleId[]): void; onPatch(values: Partial<BuilderDraft>): void }) {
  const on = new Set(draft.modules ?? []);
  return (
    <fieldset className="wb-modules">
      <legend>¿Qué más necesitáis saber de vuestros invitados?</legend>
      <p className="wb-help">Si lo contasteis en vuestra idea, ya viene marcado. Lo añadimos a vuestra web y a su formulario; podéis cambiarlo cuando queráis.</p>
      <div className="wb-chips">
        {BUILDER_MODULE_IDS.map((id) => (
          <button key={id} type="button" className="wb-chip" aria-pressed={on.has(id)} title={BUILDER_MODULE_LABELS[id].help}
            onClick={() => onChange(BUILDER_MODULE_IDS.filter((m) => (m === id ? !on.has(m) : on.has(m))))}>
            {BUILDER_MODULE_LABELS[id].label}
          </button>
        ))}
      </div>
      {/* Al activarlos, sus datos aquí mismo (todo opcional; vacío no se enseña). */}
      {on.has("bus") && <BusDetails draft={draft} onChange={onPatch} />}
      {on.has("hotels") && <HotelDetails draft={draft} onChange={onPatch} />}
    </fieldset>
  );
}
