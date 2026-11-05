import type { SceneOf, SiteDocument } from "@/lib/site-document";
import { editPath, editScene } from "../edit-targets";
import { RsvpReadError } from "@/components/guest/rsvp-read-error";
import { RsvpForm } from "@/components/guest/rsvp-form";
import { formatRsvpDate } from "@/lib/rsvp-window";
import { hasModules, NO_MODULES, type RsvpModules } from "@/lib/rsvp-answers";
import { whatsappChatUrl } from "@/lib/whatsapp-number";
import type { InvitationMode, InvitationRsvpContext, RsvpWindowState } from "../types";
import type { WeddingActionsData } from "./wedding-actions";

export interface RsvpSceneProps {
  scene: SceneOf<"rsvp">;
  mode: InvitationMode;
  rsvp?: InvitationRsvpContext;
  /** Reloj inyectable (tests): decide si la fecha lleva año. */
  now?: Date;
  /** Módulos de la web que el formulario pregunta (autobús, alojamiento…). */
  modules?: RsvpModules;
  /** «Lucía y Juan», de la portada: el aviso de privacidad dice quién lee las respuestas. */
  coupleNames?: string;
  /** Solo en el editor: marcas de «Seleccionar». */
  edit?: boolean;
  /** Solo /demo (mode="preview"): el formulario de verdad, enviado en local. */
  demo?: boolean;
  /** Calendario y mapa para el justificante tras confirmar (ítem 12). */
  actions?: WeddingActionsData | null;
}

/** Nombres de la portada para el aviso de privacidad; vacío si no hay. */
export function coupleNamesFromDocument(document: SiteDocument): string {
  const cover = document.scenes.find((scene) => scene.type === "cover");
  if (!cover || cover.type !== "cover") return "";
  return [cover.props.partnerName1, cover.props.partnerName2].map((name) => name.trim()).filter(Boolean).join(" y ");
}

const NOTE_CLASS = "sp-rule border-y py-5 text-[0.9375rem] leading-relaxed text-tinta/75";

/**
 * Asistencia: antetítulo en versalitas, título a escala de revista (un
 * escalón por debajo de agenda y lugar: el formulario manda), texto y el
 * formulario directamente sobre el papel (sin tarjeta). En la Story la
 * escena baja a la zona del pulgar (CSS).
 * Con el plazo cerrado (fecha límite de la pareja o boda pasada) el
 * formulario no se pinta: se explica con calma y se remite a la pareja.
 */
export function RsvpScene({ scene, mode, rsvp, now, modules = NO_MODULES, coupleNames = "", edit, demo, actions = null }: RsvpSceneProps) {
  const { title } = scene.props;
  // Texto por defecto anterior (en tercera persona): las webs ya guardadas lo
  // llevan escrito; se muestra el nuevo, en boca de la pareja.
  const body = scene.props.body === "Les hace la vida mucho más fácil saber cuántos seréis." ? "Nos ayuda mucho saber cuántos seréis." : scene.props.body;
  const titleId = `${scene.id}-title`;
  const rsvpWindow = rsvp?.window;
  // Cerrado: el título y el texto de la pareja invitan a confirmar; se sustituyen por uno neutro.
  const closed = rsvpWindow?.status === "closed";
  return (
    <section aria-labelledby={titleId} className="sp-rsvp mx-auto w-full max-w-[44rem]" {...editScene(edit, scene.id)}>
      <p aria-hidden="true" className="sp-eyebrow font-mono text-[11px] font-medium text-cava-texto uppercase">
        Asistencia
      </p>
      <h2 id={titleId} className="sp-h2 font-display mt-4 text-tinta" {...(closed ? {} : editPath(edit, `${scene.id}/title`))}>
        {closed ? "Confirmaciones cerradas" : title}
      </h2>
      {body && !closed && <p className="mt-4 max-w-[28rem] text-[0.9375rem] leading-relaxed text-tinta/75" {...editPath(edit, `${scene.id}/body`)}>{body}</p>}
      {rsvpWindow?.status === "open" && rsvpWindow.deadline && (
        <p className="sp-rsvp-deadline mt-4 text-sm font-medium text-tinta" data-rsvp-deadline={rsvpWindow.deadline}>
          Puedes responder hasta el {formatRsvpDate(rsvpWindow.deadline, now)}.
        </p>
      )}
      <div className="mt-7 max-w-[34rem]">
        <RsvpSlot mode={mode} rsvp={rsvp} state={rsvpWindow} now={now} modules={modules} coupleNames={coupleNames} demo={demo} actions={actions} whatsapp={scene.props.whatsapp} />
      </div>
    </section>
  );
}

function ClosedNote({ state, now }: { state: Extract<RsvpWindowState, { status: "closed" }>; now?: Date }) {
  const text =
    state.reason === "deadline"
      ? `El plazo para confirmar terminó el ${formatRsvpDate(state.deadline, now)}. Si necesitas cambiar algo, escribe directamente a la pareja.`
      : "La boda ya se celebró y la invitación ya no acepta respuestas. Si quieres decirles algo, escribe directamente a la pareja.";
  return (
    <p className={NOTE_CLASS} data-rsvp-closed={state.reason}>
      {text}
    </p>
  );
}

function RsvpSlot({ mode, rsvp, state, now, modules, coupleNames, demo, actions, whatsapp }: { mode: InvitationMode; rsvp?: InvitationRsvpContext; state?: RsvpWindowState; now?: Date; modules: RsvpModules; coupleNames: string; demo?: boolean; actions: WeddingActionsData | null; whatsapp?: string }) {
  const deadline = state?.status === "open" ? state.deadline ?? null : null;
  // Cerrado manda sobre todo lo demás (también en el preview de la pareja).
  if (state?.status === "closed") return <ClosedNote state={state} now={now} />;
  // /demo: el momento que vende es el formulario; no hay boda detrás, así que no envía nada.
  if (mode === "preview" && demo) return <RsvpForm slug="demo" demo modules={modules} coupleNames={coupleNames} actions={actions} now={now} />;
  if (mode === "preview") {
    return <p className={NOTE_CLASS}>Aquí vuestros invitados confirmarán su asistencia, con acompañantes y alergias{previewExtras(modules)}.</p>;
  }
  // Enlace revocado o mal copiado: se dice antes de que rellene nada.
  if (rsvp?.linkInvalid) {
    return (
      <>
        <p className={NOTE_CLASS} data-rsvp-link-invalid="">
          Este enlace ya no es válido; pide a los novios uno nuevo.
        </p>
        <AskInvitation whatsapp={whatsapp} />
      </>
    );
  }
  // La RPC dice que el enlace ya no acepta respuestas (plazo, boda pasada o
  // enlace caducado) aunque las fechas de la página no lo digan: sin formulario.
  if (rsvp?.linkClosed) {
    return (
      <p className={NOTE_CLASS} data-rsvp-closed="link_expired">
        Este enlace ya no acepta respuestas. Si necesitas cambiar algo, escribe directamente a la pareja.
      </p>
    );
  }
  // Un estado desconocido no equivale a una respuesta nueva: enviar valores
  // vacíos borraría notas privadas y nombres que el invitado ya guardó.
  if (rsvp?.readError) return <RsvpReadError />;
  // Sin contexto RSVP (no debería ocurrir en público) se trata como sin token.
  if (rsvp && (!rsvp.rsvpMvp || rsvp.invitationToken)) {
    return <RsvpForm slug={rsvp.slug} invitationToken={rsvp.invitationToken} modules={modules} coupleNames={coupleNames} previous={rsvp.invitationToken ? rsvp.previous : null} maxCompanions={rsvp.invitationToken ? rsvp.maxCompanions : null} guestName={rsvp.invitationToken ? rsvp.guestName : null} deadline={deadline} actions={actions} now={now} />;
  }
  return <GeneralLinkNote coupleNames={coupleNames} whatsapp={whatsapp} />;
}

/**
 * Enlace general (sin token, el que se reenvía al grupo de la familia): aquí
 * no se puede responder (RSVP_MVP) y se dice tal cual, con la salida real:
 * pedir el enlace personal. Si la pareja puso su WhatsApp en la web, con
 * «Pedir mi invitación».
 */
function GeneralLinkNote({ coupleNames, whatsapp }: { coupleNames: string; whatsapp?: string }) {
  return (
    <>
      <p className={NOTE_CLASS} data-rsvp-general-link="">
        Para confirmar tu asistencia necesitas tu enlace personal. Este es el enlace general de la boda: sirve para ver los
        detalles, pero no para responder. Si no tienes el tuyo, pídeselo a {coupleNames || "los novios"}.
      </p>
      <AskInvitation whatsapp={whatsapp} />
    </>
  );
}

/** Texto que el invitado lleva escrito al abrir WhatsApp; termina en «Soy » para que ponga su nombre. */
export const ASK_INVITATION_TEXT = "Hola, ¿me enviáis mi enlace personal para confirmar la asistencia a vuestra boda? Soy ";

/**
 * «Pedir mi invitación»: abre WhatsApp con el número que la pareja puso en
 * la web y el texto ya escrito. No envía nada: lo envía el invitado. Sin
 * número válido no se pinta.
 */
function AskInvitation({ whatsapp }: { whatsapp?: string }) {
  const href = whatsappChatUrl(whatsapp ?? null, ASK_INVITATION_TEXT);
  if (!href) return null;
  return (
    <div className="sp-actions sp-actions--start" data-rsvp-ask="">
      <a className="sp-action" data-action="whatsapp" href={href} target="_blank" rel="noopener noreferrer">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z" />
        </svg>
        <span>Pedir mi invitación</span>
      </a>
    </div>
  );
}

/** En el preview de la pareja: qué más preguntará el formulario. */
function previewExtras(m: RsvpModules): string {
  if (!hasModules(m)) return "";
  const parts = [m.bus && "si usarán el autobús", m.lodging && "dónde se alojan", m.menu.length > 0 && "el menú", m.kids && "cuántos niños", m.song && "una canción"].filter(Boolean) as string[];
  const last = parts.pop();
  return parts.length ? `, y además ${parts.join(", ")} y ${last}` : `, y además ${last}`;
}
