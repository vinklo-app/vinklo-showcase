/** Tipos compartidos por el renderer y sus escenas (sin dependencias de servidor). */
import type { RsvpPrevious } from "@/lib/rsvp-previous";
import type { RsvpWindowState } from "@/lib/rsvp-window";

export type { RsvpWindowState } from "@/lib/rsvp-window";

export type InvitationMode = "public" | "preview";

export interface InvitationRsvpContext {
  slug: string;
  invitationToken?: string;
  /** Alcance RSVP_MVP: lo decide la página, no el renderer. */
  rsvpMvp: boolean;
  /**
   * Plazo para responder, calculado por la página (servidor, hora de Madrid).
   * Abierta con fecha → «Puedes responder hasta el…»; cerrada → sin formulario.
   * Sin la prop se trata como abierta sin fecha (la RPC sigue mandando).
   * También lo usa mode="preview" para que la pareja vea lo mismo.
   */
  window?: RsvpWindowState;
  /**
   * Lo que el invitado ya respondió con su enlace personal (§2.5): estado
   * inicial del formulario. Solo lo pasa la página pública (no-store).
   */
  previous?: RsvpPrevious | null;
  /** Tope de acompañantes de la invitación (§4.2); null o ausente = libre hasta 10. */
  maxCompanions?: number | null;
  /**
   * El enlace personal ya no vale (revocado, de otra boda o mal copiado): en
   * lugar del formulario, un aviso amable. Solo lo pasa la página pública.
   */
  linkInvalid?: boolean;
  /**
   * El enlace es válido pero la RPC dice que ya no acepta respuestas
   * (`{"closed": true}`: plazo, boda pasada o enlace caducado). Sin formulario.
   */
  linkClosed?: boolean;
  /** Lectura de la respuesta previa fallida: reintentar antes de poder editar. */
  readError?: boolean;
  /**
   * Nombre de pila del titular del enlace personal («Carmen»), ya reducido en
   * el servidor (firstName): el sobre dice «Para Carmen» y el formulario la
   * saluda. Nunca el nombre completo ni el de otros. Solo la página pública.
   */
  guestName?: string | null;
}

export type InvitationPlan = "free" | "premium";
