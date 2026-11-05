/**
 * Renderer compartido de la web de boda.
 *
 * Pinta un `SiteDocument` tanto en /b/[slug] (mode="public") como en el
 * preview del wizard y la landing (mode="preview") con la MISMA
 * implementación de cada bloque. Es client-safe: solo React, next/image,
 * next/link, el contrato y utilidades puras. Nada de Supabase, server-only,
 * after(), IP ni tracking: eso pertenece a la página.
 *
 * Fase 2: cada escena habilitada es una pantalla del reproductor Story
 * (`story-player.tsx`). El servidor emite TODAS las escenas apiladas; el
 * reproductor se activa al hidratar. El renderer no toca el contrato
 * (`lib/site-document.ts`): solo decide qué escenas tienen contenido.
 *
 * Maqueta «web» (`document.layout === "web"`, decisión 2026-10-05): las
 * mismas escenas como una página de scroll largo (`web-layout.tsx`). La
 * apertura «sobre» va delante de las dos maquetas.
 */
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";
import { initialInvitePhase, inviteThemeColor } from "@/lib/invite-theme-color";
import { enabledScenes, findScene, guestVisibleScene, resolveLayout, resolveOpening, resolvePalette, resolveStorySeconds, sceneHasContent, type Scene, type SceneImage, type SiteDocument } from "@/lib/site-document";
import { AgendaScene } from "./scenes/agenda";
import { CoverScene } from "./scenes/cover";
import { rsvpModulesFromDocument } from "@/lib/rsvp-answers";
import { DetailsScene, FaqScene, GalleryScene, StayScene, StoryScene, TransportScene } from "./scenes/content";
import { coupleNamesFromDocument, RsvpScene } from "./scenes/rsvp";
import { VenueScene, venueHasContent } from "./scenes/venue";
import { WeddingActions } from "./scenes/wedding-actions";
import { calendarEventFromDocument, calendarPath, programTimesFromDocument } from "./calendar-event";
import type { WeddingActionsData } from "./scenes/wedding-actions";
import { coupleInitials } from "./format";
import { ceremonyTime } from "@/lib/countdown";
import { SealedEnvelope } from "./sealed-envelope";
import { StoryPlayer, type StoryPanel } from "./story-player";
import { WebAgenda, WebBlock, WebDatePoster, WebHero, WebLayout, WebVenue, WebWelcome, type WebNavLink } from "./web-layout";
import { WebDetails, WebFaq, WebGallery, WebStay, WebStory, WebTransport } from "./web-scenes";
import type { InvitationMode, InvitationPlan, InvitationRsvpContext } from "./types";
import { EditTargetsProvider } from "./edit-context";

export type { InvitationMode, InvitationPlan, InvitationRsvpContext } from "./types";

export interface InvitationRendererProps {
  document: SiteDocument;
  mode: InvitationMode;
  /**
   * Contexto del formulario de asistencia. En mode="preview" solo se usa
   * `window` (plazo), para que la pareja vea el mismo estado que el invitado.
   */
  rsvp?: InvitationRsvpContext;
  /** Plan de la pareja: el pie de marca aparece en "free". */
  plan: InvitationPlan;
  /** Reloj inyectable para la cuenta atrás (tests). */
  now?: Date;
  /**
   * Hueco justo detrás de la portada (y del lugar si la sigue). La página
   * pública lo usa para «el sobre» mientras RSVP_MVP lo mantenga apagado.
   * En la Story es una pantalla más.
   */
  afterCover?: ReactNode;
  /**
   * Solo mode="preview": foto de portada que aún no está en el documento
   * (p. ej. el `blob:` local del paso de foto del creador, que el contrato
   * rechaza). `null` fuerza el monograma; sin la prop manda el documento.
   */
  previewCoverImage?: SceneImage | null;
  /**
   * Opcional: id de la escena (`scene.id`) que la Story debe mostrar. Abre
   * en ella y pasa a ella cada vez que cambia; entre cambios se navega libre.
   * Sin la prop, la Story empieza en la portada como siempre.
   */
  activeSceneId?: string;
  /**
   * Solo mode="preview": el preview ocupa toda la pantalla (/demo). Activa
   * los efectos que en un marco pequeño no tienen recorrido (la transición
   * portada → mosaico).
   */
  fullPage?: boolean;
  /**
   * Solo mode="preview" del editor (panel y creador): marca secciones y
   * textos con `data-edit-scene` / `data-edit-path` para «Seleccionar». La
   * web pública, /demo y la landing no lo pasan: su HTML no cambia.
   */
  editTargets?: boolean;
  /**
   * Solo mode="preview" de /demo: la asistencia pinta el formulario de
   * verdad, pero envía en local (sin red ni BD). El editor de la pareja no
   * lo pasa y conserva la nota «Aquí vuestros invitados confirmarán…».
   */
  demoRsvp?: boolean;
}

// El texto mide 15 px de alto: un ::after invisible amplía el toque a 44 px
// sin cambiar cómo se ve el pie.
const BRAND_LINK_CLASS =
  "relative font-medium text-tinta/70 underline-offset-2 outline-none after:absolute after:-inset-x-2 after:-inset-y-4 hover:underline focus-visible:ring-3 focus-visible:ring-cava/50";

export function InvitationRenderer({ document, mode, rsvp, plan, now, afterCover, previewCoverImage, activeSceneId, fullPage, editTargets, demoRsvp }: InvitationRendererProps) {
  // Paleta efectiva: `palette` si la pareja la eligió; si no, la del tema
  // (idéntica a WEDDING_PAGE_THEMES para editorial/clasico/natural).
  const theme = resolvePalette(document);
  const themeStyle = {
    "--papel": theme.paper,
    "--tinta": theme.ink,
    "--cava": theme.accent,
    "--cava-texto": theme.accent,
    "--rubor": theme.surface,
    backgroundColor: theme.paper,
    color: theme.ink,
  } as CSSProperties;

  // Lo que ve el invitado: sin plantillas por rellenar (preguntas sin respuesta, tarjetas solo con título).
  const scenes = enabledScenes(document).map(guestVisibleScene);
  const coverScene = findScene(document, "cover");
  // Monograma de margen en escritorio (decorativo, CSS ::before). Solo sin
  // foto: con foto, la portada ya es la imagen de la pareja.
  const coverPhoto = coverScene ? Boolean(mode === "preview" && previewCoverImage !== undefined ? previewCoverImage : coverScene.props.image) : false;
  const initials = coverScene && !coverPhoto ? coupleInitials(coverScene.props.partnerName1, coverScene.props.partnerName2) : "";
  const ctx: RenderContext = {
    document,
    mode,
    rsvp,
    now,
    coverImage: mode === "preview" && previewCoverImage !== undefined ? previewCoverImage : undefined,
    venueShown: scenes.some((s) => s.type === "venue" && venueHasContent(s)),
    fullPage: Boolean(fullPage),
    edit: mode === "preview" && Boolean(editTargets),
    demoRsvp: mode === "preview" && Boolean(demoRsvp),
    ceremonyTime: ceremonyTime(document),
    calendar: {
      programTimes: programTimesFromDocument(document),
      // Solo la web pública tiene ruta .ics (el preview no navega).
      calendarHref: mode === "public" && rsvp?.slug ? calendarPath(rsvp.slug) : undefined,
    },
  };
  const layout = resolveLayout(document);
  // Sin `opening` = sobre floral (la landing lo promete); "ninguno" = directa.
  const opening = resolveOpening(document);
  const footer = plan === "free" ? <BrandFooter mode={mode} /> : undefined;

  const panels: StoryPanel[] = [];
  for (let i = 0; layout === "historia" && i < scenes.length; i++) {
    const scene = scenes[i];
    const node = renderScene(scene, ctx);
    if (node) panels.push({ id: scene.id, kind: scene.type, node, tone: sceneTone(scene, ctx) });
    if (scene.type === "cover" && afterCover) {
      // «El sobre» va detrás de la portada y, si el lugar la sigue, detrás del lugar.
      const next = scenes[i + 1];
      if (next?.type === "venue") {
        const venueNode = renderScene(next, ctx);
        if (venueNode) panels.push({ id: next.id, kind: next.type, node: venueNode });
        i++;
      }
      panels.push({ id: `${scene.id}-after`, kind: "extra", node: afterCover });
    }
  }

  // En el wizard el preview vive dentro de un <main>: no anidamos otro.
  const Root = mode === "public" ? "main" : "div";
  const rootClass = mode === "public" ? "sp-shell bg-papel text-tinta" : "sp-shell sp-shell-preview bg-papel text-tinta";

  // Franja del iPhone: solo en la web pública (el preview vive dentro del panel).
  const themeColors = mode === "public" ? { sealed: inviteThemeColor(document, "sealed"), cover: inviteThemeColor(document, "cover"), scene: inviteThemeColor(document, "scene") } : undefined;

  const layoutNode =
    layout === "web" ? (
      renderWeb(scenes, ctx, afterCover, footer)
    ) : (
      // Autoavance solo en la web pública: en el creador y el editor la escena la manda quien edita.
      <StoryPlayer panels={panels} mode={mode} activeSceneId={activeSceneId} footer={footer} themeColors={themeColors} autoAdvanceSeconds={mode === "public" ? resolveStorySeconds(document) : null} />
    );
  // La maqueta web lee las marcas por contexto (componentes cliente).
  const player = ctx.edit && coverScene ? <EditTargetsProvider coverId={coverScene.id}>{layoutNode}</EditTargetsProvider> : layoutNode;

  return (
    <Root className={rootClass} style={themeStyle} data-wedding-style={document.themeId} data-invitation-mode={mode} data-palette={theme.id} data-layout={layout} data-initials={initials || undefined}>
      {themeColors ? (
        // iOS 26 pinta la franja superior con el fondo de html/body (ignora
        // theme-color): se fija ya en el HTML del servidor; el cliente lo
        // ajusta al abrir el sobre o cambiar de escena (useThemeColor).
        <style>{`html,body{background-color:${inviteThemeColor(document, initialInvitePhase(document))}}`}</style>
      ) : null}
      {opening !== "ninguno" && coverScene ? (
        <SealedEnvelope
          variant={opening === "sobre-liso" ? "liso" : "floral"}
          partnerName1={coverScene.props.partnerName1}
          partnerName2={coverScene.props.partnerName2}
          initials={coupleInitials(coverScene.props.partnerName1, coverScene.props.partnerName2)}
          mode={mode}
          sealedThemeColor={themeColors?.sealed}
          guestName={mode === "public" ? rsvp?.guestName : null}
        >
          {player}
        </SealedEnvelope>
      ) : (
        player
      )}
    </Root>
  );
}

interface RenderContext {
  document: SiteDocument;
  mode: InvitationMode;
  rsvp: InvitationRsvpContext | undefined;
  now: Date | undefined;
  /** undefined = la del documento. */
  coverImage: SceneImage | null | undefined;
  /** ¿Hay escena de lugar visible? Si no, el calendario va en la portada. */
  venueShown: boolean;
  fullPage: boolean;
  /** Marcas de «Seleccionar» (solo en el editor). */
  edit: boolean;
  /** Formulario de asistencia local (solo /demo). */
  demoRsvp: boolean;
  /** Hora de la ceremonia (lugar o programa) para la cuenta atrás; null = solo días. */
  ceremonyTime: string | null;
  /** Para «Añadir al calendario»: horas del programa y ruta .ics de la web pública. */
  calendar: { programTimes: string[]; calendarHref?: string };
}

function coverHasPhoto(scene: Extract<Scene, { type: "cover" }>, ctx: RenderContext): boolean {
  return Boolean(ctx.coverImage !== undefined ? ctx.coverImage : scene.props.image);
}

function sceneTone(scene: Scene, ctx: RenderContext): "photo" | undefined {
  return scene.type === "cover" && coverHasPhoto(scene, ctx) ? "photo" : undefined;
}

function renderScene(scene: Scene, ctx: RenderContext): ReactNode {
  const { document, mode, rsvp, now } = ctx;
  switch (scene.type) {
    case "cover": {
      const { partnerName1, partnerName2, weddingDate } = scene.props;
      // Sin escena de lugar, «Añadir al calendario» vive en la portada.
      const actions =
        !ctx.venueShown && weddingDate ? (
          <WeddingActions
            mode={mode}
            tone={coverHasPhoto(scene, ctx) ? "photo" : "paper"}
            data={{ partnerName1, partnerName2, weddingDate, time: "", venue: "", address: "", ...ctx.calendar }}
          />
        ) : null;
      return (
        <CoverScene key={scene.id} scene={scene} themeId={document.themeId} now={now} ceremonyTime={ctx.ceremonyTime} imageOverride={ctx.coverImage} headingLevel={mode === "public" ? 1 : 2} edit={ctx.edit}>
          {actions}
        </CoverScene>
      );
    }
    case "venue": {
      const cover = findScene(document, "cover");
      const actions = cover
        ? { partnerName1: cover.props.partnerName1, partnerName2: cover.props.partnerName2, weddingDate: cover.props.weddingDate, ...ctx.calendar }
        : undefined;
      return venueHasContent(scene) ? <VenueScene key={scene.id} scene={scene} mode={mode} actions={actions} edit={ctx.edit} /> : null;
    }
    case "rsvp":
      return <RsvpScene key={scene.id} scene={scene} mode={mode} rsvp={rsvp} now={now} modules={rsvpModulesFromDocument(document)} coupleNames={coupleNamesFromDocument(document)} edit={ctx.edit} demo={ctx.demoRsvp} actions={rsvpActions(ctx)} />;
    case "agenda":
      return scene.props.items.length > 0 ? <AgendaScene key={scene.id} scene={scene} mode={mode} edit={ctx.edit} /> : null;
    // Escenas v2 (6-oct-2026): en la Story, una pantalla con desplazamiento interno.
    case "story":
      return sceneHasContent(scene) ? <StoryScene key={scene.id} scene={scene} edit={ctx.edit} /> : null;
    case "gallery":
      return sceneHasContent(scene) ? <GalleryScene key={scene.id} scene={scene} edit={ctx.edit} /> : null;
    case "details":
      return sceneHasContent(scene) ? <DetailsScene key={scene.id} scene={scene} mode={mode} edit={ctx.edit} /> : null;
    case "faq":
      return sceneHasContent(scene) ? <FaqScene key={scene.id} scene={scene} edit={ctx.edit} /> : null;
    case "transport":
      return sceneHasContent(scene) ? <TransportScene key={scene.id} scene={scene} edit={ctx.edit} /> : null;
    case "stay":
      return sceneHasContent(scene) ? <StayScene key={scene.id} scene={scene} mode={mode} now={now} edit={ctx.edit} /> : null;
    default: {
      // Si el contrato crece sin actualizar el renderer, TypeScript avisa aquí.
      const exhaustive: never = scene;
      return exhaustive;
    }
  }
}

/**
 * Maqueta «web»: las mismas escenas, en este orden: portada (a sangre),
 * bienvenida, y después las escenas en el orden del documento — galería,
 * historia, la fecha como cartel (justo antes del lugar), lugar, programa,
 * detalles, preguntas —, «el sobre» (si la página lo pasa) y la asistencia
 * al final. Si no hay lugar, la fecha va tras la bienvenida. Los datos salen
 * del documento; ningún texto de pareja se inventa.
 */
function renderWeb(scenes: Scene[], ctx: RenderContext, afterCover: ReactNode, footer: ReactNode): ReactNode {
  const { document, mode, rsvp, now } = ctx;
  const cover = findScene(document, "cover");
  if (!cover) return null;
  const { partnerName1, partnerName2, weddingDate, eyebrow, welcomeMessage, showCountdown } = cover.props;
  const image = ctx.coverImage !== undefined ? ctx.coverImage : cover.props.image;
  const initials = coupleInitials(partnerName1, partnerName2);
  const links: WebNavLink[] = [];
  const body: ReactNode[] = [];
  // Transición «portada → mosaico»: con foto de portada y una galería de 4+
  // fotos como primera sección, sus 4 primeras fotos entran alrededor de la
  // portada (la galería sigue con el resto).
  const firstContent = scenes.find((s) => s.type !== "cover" && sceneHasContent(s));
  // Solo en la web pública: en los móviles de muestra no hay recorrido que hacer.
  const orbitGallery = (mode === "public" || ctx.fullPage) && document.themeId !== "clasico" && image && firstContent?.type === "gallery" && firstContent.props.images.length >= 4 ? firstContent : null;

  if (welcomeMessage) body.push(<WebWelcome key="bienvenida" text={welcomeMessage} />);
  let datePlaced = false;
  const placeDate = () => {
    if (datePlaced || !weddingDate) return;
    datePlaced = true;
    const dateId = `${cover.id}-fecha`;
    links.push({ id: dateId, label: "La fecha" });
    // Sin escena de lugar, «Añadir al calendario» vive junto a la fecha.
    body.push(
      <WebDatePoster key="fecha" id={dateId} weddingDate={weddingDate} showCountdown={showCountdown} ceremonyTime={ctx.ceremonyTime} initialNow={(now ?? new Date()).getTime()}>
        {!ctx.venueShown ? (
          <WeddingActions mode={mode} data={{ partnerName1, partnerName2, weddingDate, time: "", venue: "", address: "", ...ctx.calendar }} />
        ) : null}
      </WebDatePoster>,
    );
  };
  // La fecha va justo antes del lugar (la historia y la galería la preceden); sin lugar, tras la bienvenida.
  if (!ctx.venueShown) placeDate();

  let rsvpNode: ReactNode = null;
  let rsvpId: string | undefined;
  let afterPlaced = false;
  for (const scene of scenes) {
    switch (scene.type) {
      case "cover":
        break;
      case "story":
        if (!sceneHasContent(scene)) break;
        links.push({ id: scene.id, label: "Nuestra historia" });
        body.push(<WebStory key={scene.id} id={scene.id} title={scene.props.title} intro={scene.props.intro} chapters={scene.props.chapters} />);
        break;
      case "gallery":
        if (!sceneHasContent(scene)) break;
        body.push(<WebGallery key={scene.id} id={scene.id} title={scene.props.title} images={scene.props.images} consumed={scene === orbitGallery ? 4 : 0} />);
        break;
      case "details":
        if (!sceneHasContent(scene)) break;
        links.push({ id: scene.id, label: "Detalles" });
        body.push(<WebDetails key={scene.id} id={scene.id} title={scene.props.title} intro={scene.props.intro} cards={scene.props.cards} />);
        break;
      case "faq":
        if (!sceneHasContent(scene)) break;
        links.push({ id: scene.id, label: "Preguntas" });
        body.push(<WebFaq key={scene.id} id={scene.id} title={scene.props.title} contact={scene.props.contact} items={scene.props.items} />);
        break;
      case "transport":
        if (!sceneHasContent(scene)) break;
        links.push({ id: scene.id, label: "Autobuses" });
        body.push(<WebTransport key={scene.id} id={scene.id} title={scene.props.title} intro={scene.props.intro} stops={scene.props.stops} returnNote={scene.props.returnNote} />);
        break;
      case "stay":
        if (!sceneHasContent(scene)) break;
        links.push({ id: scene.id, label: "Alojamiento" });
        body.push(<WebStay key={scene.id} id={scene.id} title={scene.props.title} intro={scene.props.intro} hotels={scene.props.hotels} mode={mode} now={now} />);
        break;
      case "venue": {
        if (!venueHasContent(scene)) break;
        placeDate();
        const { venue, address, time, placeId } = scene.props;
        links.push({ id: scene.id, label: "Lugar" });
        body.push(
          <WebVenue key={scene.id} id={scene.id} venue={venue} address={address} time={time}>
            <WeddingActions mode={mode} data={{ partnerName1, partnerName2, weddingDate, time, venue, address, placeId, ...ctx.calendar }} />
          </WebVenue>,
        );
        if (afterCover && !afterPlaced) {
          body.push(<WebBlock key="after-cover" id={`${cover.id}-after`} tone="paper">{afterCover}</WebBlock>);
          afterPlaced = true;
        }
        break;
      }
      case "agenda":
        if (scene.props.items.length === 0) break;
        links.push({ id: scene.id, label: "Programa" });
        body.push(<WebAgenda key={scene.id} id={scene.id} title={scene.props.title} items={scene.props.items} />);
        break;
      case "rsvp":
        rsvpId = scene.id;
        rsvpNode = (
          <WebBlock key={scene.id} id={scene.id} tone="paper" scene={scene.id}>
            <RsvpScene scene={scene} mode={mode} rsvp={rsvp} now={now} modules={rsvpModulesFromDocument(document)} coupleNames={coupleNamesFromDocument(document)} edit={ctx.edit} demo={ctx.demoRsvp} actions={rsvpActions(ctx)} />
          </WebBlock>
        );
        break;
      default: {
        const exhaustive: never = scene;
        return exhaustive;
      }
    }
  }
  placeDate();
  if (afterCover && !afterPlaced) body.push(<WebBlock key="after-cover" id={`${cover.id}-after`} tone="paper">{afterCover}</WebBlock>);

  return (
    <WebLayout mode={mode} initials={initials} links={links} rsvpId={rsvpId} rsvpCanConfirm={rsvpCanConfirm(mode, rsvp)} footer={footer}>
      <WebHero
        partnerName1={partnerName1}
        partnerName2={partnerName2}
        eyebrow={eyebrow}
        themeId={document.themeId}
        image={image}
        initials={initials}
        headingLevel={mode === "public" ? 1 : 2}
        orbit={orbitGallery ? orbitGallery.props.images.slice(0, 4) : undefined}
        dateMissing={ctx.edit && !weddingDate}
      />
      {body}
      {rsvpNode}
    </WebLayout>
  );
}

/**
 * Calendario y mapa del justificante (ítem 12): los mismos datos que los
 * botones del lugar (o de la fecha, sin lugar). null sin fecha de boda.
 */
function rsvpActions(ctx: RenderContext): WeddingActionsData | null {
  const event = calendarEventFromDocument(ctx.document);
  if (!event) return null;
  const venue = ctx.document.scenes.find((scene) => scene.type === "venue" && scene.enabled);
  const placeId = (event.venue || event.address) && venue?.type === "venue" ? venue.props.placeId : undefined;
  return { partnerName1: event.partnerName1, partnerName2: event.partnerName2, weddingDate: event.weddingDate, time: event.time ?? "", venue: event.venue ?? "", address: event.address ?? "", placeId, ...ctx.calendar };
}

/**
 * ¿Puede confirmar quien mira? Decide el texto del botón de la navegación
 * («Confirmar asistencia» o «Asistencia»). En el preview de la pareja, lo que
 * verá un invitado con su enlace (salvo con el plazo cerrado). En la web
 * pública solo con enlace personal válido: el enlace general no tiene
 * formulario (RSVP_MVP) y uno revocado o cerrado tampoco.
 */
export function rsvpCanConfirm(mode: InvitationMode, rsvp: InvitationRsvpContext | undefined): boolean {
  if (rsvp?.window?.status === "closed") return false;
  if (mode === "preview") return true;
  if (!rsvp) return false;
  if (!rsvp.rsvpMvp) return true;
  return Boolean(rsvp.invitationToken) && !rsvp.linkInvalid && !rsvp.linkClosed && !rsvp.readError;
}

/**
 * Marca (plan free): momento de conversión, no firma pasiva (estrategia
 * M1/M2 — cada boda expone el producto a ~100 invitados en el momento de
 * máxima confianza). Fuera del catálogo de escenas: lo coloca el reproductor
 * (bajo los controles en la Story; al final en la vista continua).
 */
function BrandFooter({ mode }: { mode: InvitationMode }) {
  const label = `${BRAND_NAME} · vuestra web de boda`;
  return (
    <footer className="sp-footer pt-6 pb-8 text-center">
      <p className="text-xs text-tinta/60">
        Hecho con{" "}
        {mode === "public" ? (
          <Link href="/?utm_source=guest&utm_medium=invitacion&utm_campaign=loop" className={BRAND_LINK_CLASS}>
            {label}
          </Link>
        ) : (
          <span aria-disabled="true" className={BRAND_LINK_CLASS}>
            {label}
          </span>
        )}
      </p>
    </footer>
  );
}
