/**
 * Transactional email templates (es-ES).
 *
 * Diseño aprobado 2026-10-04 (esquinas redondeadas) con la marca v9
 * «Ciruela y perla» desde el 9-oct-2026 (DESIGN.md): el mismo
 * lenguaje visual que las plantillas de Supabase Auth (Magic Link /
 * Recovery / Confirmation / Invite / Email change / Reauthentication,
 * ver docs/ops/supabase-auth.md) — tarjeta blanca de esquinas
 * redondeadas (16px) sobre perla #F8F7FA, filete #DCD4E1, wordmark con
 * el símbolo + "vınklo", titular serif de dos partes (la segunda en
 * cursiva ciruela #573B62) y CTA ciruela con esquinas redondeadas
 * (10px) en caja alta normal, no mayúsculas.
 * - Inline styles only, table-based layout, mobile-friendly (max-width 480px).
 * - Texto #24212A sobre perla #F8F7FA; texto de cuerpo apagado #655E6B
 *   (5,8:1); el acento es la ciruela #573B62 (cursiva del titular y CTA,
 *   texto perla sobre ciruela 8,9:1). Nothing else.
 * - Warm, celebratory tone for guests; sober for the couple.
 * - Copy rules per PLAN.md §8 apply here too.
 *
 * Amounts arrive pre-formatted server-side (lib/fees.ts formatEurCents).
 */
import { BRAND_TAGLINE } from "@/lib/brand";

const TINTA = "#24212A";
const PAPEL = "#F8F7FA";
const CAVA = "#573B62";
const MUTED = "#655E6B";
const HAIRLINE = "#DCD4E1";

/** Body + CTA text stack (Jakarta es web-only; email cae a sans del sistema). */
const SANS = "'Plus Jakarta Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";
/** Display stack del titular (los clientes de correo caen a Georgia). */
const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";

/**
 * Símbolo de vinklo (components/brand/icons.tsx `LazoIcon`) como PNG alojado:
 * Gmail y Outlook no pintan SVG en línea. Archivo: public/email/vinklo-mark.png (96 px, 2× para retina).
 */
const LOGO_IMG = `<img src="https://vinklo.es/email/vinklo-mark.png" width="22" height="22" alt="" style="display:block;border:0;outline:none;width:22px;height:22px;" />`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Titular de dos partes: la primera en tinta normal, la segunda en
 * cursiva ciruela — calcado del Magic Link/Recovery de Supabase Auth.
 * `roman` y `accent` ya deben venir escapados si incluyen datos del
 * usuario (los llamadores de este módulo siempre pasan HTML seguro).
 */
function headline(roman: string, accent: string): string {
  return `<h1 style="margin:0 0 14px 0;font-family:${SERIF};font-weight:400;font-size:28px;line-height:1.15;letter-spacing:-0.3px;color:${TINTA};text-align:center;">${roman}<br /><em style="font-style:italic;color:${CAVA};">${accent}</em></h1>`;
}

/**
 * CTA: bloque ciruela (acento de la marca v9; antes arcilla, y antes tinta)
 * con esquinas redondeadas (10px), texto perla en caja normal — igual que
 * el botón del Magic Link.
 */
function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                  <tr>
                    <td align="center" style="background-color:${CAVA};border-radius:10px;">
                      <a href="${escapeHtml(url)}" style="display:inline-block;color:${PAPEL};font-family:${SANS};font-size:16px;font-weight:600;line-height:1;text-decoration:none;padding:17px 32px;border-radius:10px;">${label}</a>
                    </td>
                  </tr>
                </table>`;
}

/**
 * Shared shell: idéntico al de las plantillas de Supabase Auth — tarjeta
 * blanca de 480px con esquinas redondeadas (16px) y filete #DCD4E1 sobre
 * perla #F8F7FA, cabecera con el símbolo SVG + wordmark, folio con la
 * tagline de marca bajo la tarjeta.
 */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${PAPEL};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPEL};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border:1px solid ${HAIRLINE};border-radius:16px;">
            <tr>
              <td align="center" style="padding:36px 32px 0 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                  <tr>
                    <td valign="middle" style="padding-right:8px;">${LOGO_IMG}</td>
                    <td valign="middle">
                      <span style="font-family:${SANS};font-size:19px;font-weight:700;letter-spacing:-0.3px;color:${TINTA};">v<span style="color:${CAVA};">ı</span>nklo</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 36px 32px;">
                ${body}
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0 0;font-family:${SANS};font-size:11px;line-height:18px;letter-spacing:0.5px;color:${MUTED};">
            vinklo &middot; ${escapeHtml(BRAND_TAGLINE)}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface GuestReceiptInput {
  guestName: string;
  /** Already joined, e.g. "María y Jorge". */
  partnerNames: string;
  /** Contribution amount, pre-formatted, e.g. "150,00 €". */
  totalFormatted: string;
  /** Service fee, pre-formatted, e.g. "3,80 €". */
  feeFormatted: string;
  nCubiertos: number;
  /** Optional personal message the guest left for the couple. */
  message?: string | null;
}

/** Warm es-ES thank-you receipt for the guest, with the amounts breakdown. */
export function guestReceiptHtml({
  guestName,
  partnerNames,
  totalFormatted,
  feeFormatted,
  nCubiertos,
  message,
}: GuestReceiptInput): string {
  const name = escapeHtml(guestName);
  const partners = escapeHtml(partnerNames);
  const cubiertosLabel =
    nCubiertos === 1 ? "1 cubierto" : `${nCubiertos} cubiertos`;

  const messageBlock =
    message && message.trim().length > 0
      ? `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
                  <tr>
                    <td style="border-left:3px solid ${CAVA};padding:4px 0 4px 16px;">
                      <p style="margin:0 0 4px 0;font-family:${SANS};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${CAVA};">Tu mensaje para los novios</p>
                      <p style="margin:0;font-family:${SERIF};font-style:italic;font-size:17px;line-height:24px;color:${TINTA};">&ldquo;${escapeHtml(message.trim())}&rdquo;</p>
                    </td>
                  </tr>
                </table>`
      : "";

  const body = `
                ${headline("&iexcl;Gracias,", `${name}!`)}
                <p style="margin:0 0 26px 0;font-family:${SANS};font-size:15px;line-height:23px;color:${MUTED};text-align:center;">
                  Tu aportaci&oacute;n ya est&aacute; con <strong style="color:${TINTA};">${partners}</strong>.<br />
                  Les va a hacer much&iacute;sima ilusi&oacute;n. &iexcl;Qu&eacute; ganas de veros!
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPEL};border:1px solid ${HAIRLINE};border-radius:10px;">
                  <tr>
                    <td style="padding:16px 20px 6px 20px;font-family:${SANS};font-size:14px;line-height:22px;color:${TINTA};">Tu aportaci&oacute;n (${cubiertosLabel})</td>
                    <td align="right" style="padding:16px 20px 6px 20px;font-family:${SANS};font-size:14px;line-height:22px;font-weight:600;color:${TINTA};white-space:nowrap;">${escapeHtml(totalFormatted)}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 20px 16px 20px;font-family:${SANS};font-size:14px;line-height:22px;color:${TINTA};">Gastos de gesti&oacute;n</td>
                    <td align="right" style="padding:0 20px 16px 20px;font-family:${SANS};font-size:14px;line-height:22px;color:${TINTA};white-space:nowrap;">${escapeHtml(feeFormatted)}</td>
                  </tr>
                </table>${messageBlock}
                <p style="margin:24px 0 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${MUTED};text-align:center;">
                  Nos vemos en la boda.
                </p>`;

  return layout(`Tu aportación para ${partnerNames}`, body);
}

export interface TrancheReminderInput {
  vendorName: string;
  /** "señal", "prueba de menú"… */
  trancheLabel: string;
  /** Pre-formateado, p. ej. "3.000,00 €". */
  amountFormatted: string;
  /** Fecha bonita es-ES, p. ej. "15 de julio". */
  dueDateFormatted: string;
  panelUrl: string;
}

/** Recordatorio sobrio para la pareja: un pago a proveedor vence pronto. */
export function trancheReminderHtml({
  vendorName,
  trancheLabel,
  amountFormatted,
  dueDateFormatted,
  panelUrl,
}: TrancheReminderInput): string {
  const vendor = escapeHtml(vendorName);
  const body = `
                ${headline("Vence pronto:", `${vendor}.`)}
                <p style="margin:0 0 28px 0;font-family:${SANS};font-size:14px;line-height:22px;color:${MUTED};text-align:center;">
                  ${escapeHtml(trancheLabel)} &middot; ${escapeHtml(amountFormatted)} &middot; vence el ${escapeHtml(dueDateFormatted)}.<br />
                  Un aviso con tiempo para que no os pille el calendario.
                </p>
                ${ctaButton("Ver en el panel", panelUrl)}`;

  return layout(
    `Vence pronto: ${vendorName} (${trancheLabel}) — ${dueDateFormatted}`,
    body,
  );
}

export interface ShareNudgeInput {
  /** Días que faltan para la boda. */
  daysLeft: number;
  /** URL pública /b/[slug] para compartir. */
  guestUrl: string;
  /** Enlace directo al panel (https://vinklo.es/panel): todo correo a la pareja lo lleva. */
  panelUrl: string;
}

/** Empujón cálido: falta un mes y apenas hay aportaciones. */
export function shareNudgeHtml({ daysLeft, guestUrl, panelUrl }: ShareNudgeInput): string {
  const body = `
                ${headline("Buen momento para", "compartir vuestro enlace.")}
                <p style="margin:0 0 28px 0;font-family:${SANS};font-size:14px;line-height:22px;color:${MUTED};text-align:center;">
                  Faltan ${daysLeft} d&iacute;as. A vuestros invitados les encanta
                  aportar con antelaci&oacute;n — as&iacute; os ayudan con los
                  preparativos. Un mensaje por WhatsApp con vuestro enlace basta.
                </p>
                ${ctaButton("Abrir vuestra página", guestUrl)}
                <p style="margin:20px 0 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};text-align:center;">
                  &iquest;Quer&eacute;is ver qui&eacute;n ha respondido? <a href="${escapeHtml(panelUrl)}" style="color:${TINTA};font-weight:600;">Id a vuestro panel</a>.
                </p>`;

  return layout(`Faltan ${daysLeft} días — compartid vuestro enlace`, body);
}

export interface CoupleNotificationInput {
  guestName: string;
  /** Contribution amount, pre-formatted, e.g. "150,00 €". */
  amountFormatted: string;
  method: "card" | "bizum_manual";
  /** Absolute URL to the couple's dashboard, e.g. https://vinklo.es/panel */
  panelUrl: string;
  /**
   * Aportaciones que le quedan al plan básico (solo bodas free); null u
   * omitido = no mostrar la línea (bodas Premium).
   */
  remainingFreeSlots?: number | null;
}

/** Línea sobria de plan básico + enlace a Premium (sin lenguaje de urgencia). */
function freePlanLine(remaining: number, panelUrl: string): string {
  const label =
    remaining === 1
      ? "queda 1 aportación incluida"
      : remaining === 0
        ? "quedan 0 aportaciones incluidas"
        : `quedan ${remaining} aportaciones incluidas`;
  return `
                <p style="margin:20px 0 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};text-align:center;">
                  En vuestro plan b&aacute;sico ${label}.
                  Si vuestra lista es m&aacute;s larga, <a href="${escapeHtml(panelUrl)}" style="color:${TINTA};font-weight:600;">Premium Boda</a> las hace ilimitadas.
                </p>`;
}

const METHOD_LABELS: Record<CoupleNotificationInput["method"], string> = {
  card: "Tarjeta",
  bizum_manual: "Bizum",
};

/** Sober es-ES notification for the couple with a CTA to the panel. */
export function coupleNotificationHtml({
  guestName,
  amountFormatted,
  method,
  panelUrl,
  remainingFreeSlots,
}: CoupleNotificationInput): string {
  const name = escapeHtml(guestName);
  const amount = escapeHtml(amountFormatted);
  const planBlock =
    typeof remainingFreeSlots === "number"
      ? freePlanLine(remainingFreeSlots, panelUrl)
      : "";

  const body = `
                ${headline(`${name} acaba de aportar`, `${amount}.`)}
                <p style="margin:0 0 28px 0;font-family:${SANS};font-size:14px;line-height:22px;color:${MUTED};text-align:center;">
                  M&eacute;todo: ${METHOD_LABELS[method]} &middot; Vuestro bote acaba de crecer.
                </p>
                ${ctaButton("Ver en el panel", panelUrl)}${planBlock}`;

  return layout(`${guestName} acaba de aportar ${amountFormatted}`, body);
}

export interface WeeklyDigestInput {
  /** Already joined, e.g. "María y Jorge". */
  partnerNames: string;
  /** Aportaciones confirmadas de la semana, ya formateadas. */
  weekItems: { guestName: string; amountFormatted: string }[];
  /** Total de la semana, pre-formateado. */
  weekTotalFormatted: string;
  /** Total acumulado del bote, pre-formateado. */
  allTotalFormatted: string;
  /** Plazas restantes del plan básico; null = boda Premium. */
  remainingFreeSlots?: number | null;
  panelUrl: string;
}

/**
 * Resumen semanal para la pareja (preferencia 'semanal'): quién ha
 * aportado esta semana, cuánto suma y cómo va el bote. Solo se envía si
 * hubo actividad — sin actividad, sin correo.
 */
export function weeklyDigestHtml({
  partnerNames,
  weekItems,
  weekTotalFormatted,
  allTotalFormatted,
  remainingFreeSlots,
  panelUrl,
}: WeeklyDigestInput): string {
  const rows = weekItems
    .map(
      (item) => `
                  <tr>
                    <td style="padding:8px 20px;font-family:${SANS};font-size:14px;line-height:22px;color:${TINTA};border-bottom:1px solid ${HAIRLINE};">${escapeHtml(item.guestName)}</td>
                    <td align="right" style="padding:8px 20px;font-family:${SANS};font-size:14px;line-height:22px;font-weight:600;color:${TINTA};white-space:nowrap;border-bottom:1px solid ${HAIRLINE};">${escapeHtml(item.amountFormatted)}</td>
                  </tr>`,
    )
    .join("");
  const planBlock =
    typeof remainingFreeSlots === "number"
      ? freePlanLine(remainingFreeSlots, panelUrl)
      : "";

  const countLabel =
    weekItems.length === 1
      ? "1 aportaci&oacute;n nueva"
      : `${weekItems.length} aportaciones nuevas`;

  const body = `
                ${headline(countLabel, escapeHtml(weekTotalFormatted))}
                <p style="margin:0 0 20px 0;font-family:${SANS};font-size:14px;line-height:22px;color:${MUTED};text-align:center;">
                  As&iacute; ha crecido vuestro sobre esta semana, ${escapeHtml(partnerNames)}.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPEL};border:1px solid ${HAIRLINE};border-radius:10px;">
                  ${rows}
                  <tr>
                    <td style="padding:12px 20px;font-family:${SANS};font-size:14px;line-height:22px;font-weight:600;color:${TINTA};">Total del bote</td>
                    <td align="right" style="padding:12px 20px;font-family:${SANS};font-size:14px;line-height:22px;font-weight:700;color:${TINTA};white-space:nowrap;">${escapeHtml(allTotalFormatted)}</td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
                  <tr><td>${ctaButton("Ver en el panel", panelUrl)}</td></tr>
                </table>${planBlock}`;

  return layout(
    `Vuestra semana: ${weekItems.length === 1 ? "1 aportación nueva" : `${weekItems.length} aportaciones nuevas`}`,
    body,
  );
}

export interface VendorInviteInput {
  vendorName: string;
  /** Already joined, e.g. "María y Jorge". */
  partnerNames: string;
  /** Absolute URL to the vendor's magic link, e.g. https://vinklo.es/v/{token} */
  inviteUrl: string;
}

/**
 * Warm-professional es-ES invite for a newly added vendor: no account, no
 * password — just this link. Tone sits between the celebratory guest
 * copy and the sober couple copy (PLAN.md §8: "visibilidad de cobro" is
 * the vendor-facing value word).
 */
export interface VendorSetupNoticeInput {
  vendorName: string;
  panelUrl: string;
  ibanChanged: boolean;
}

/** Aviso a la pareja: un proveedor ha enviado (o reenviado) su ficha. */
export function vendorSetupNoticeHtml({
  vendorName,
  panelUrl,
  ibanChanged,
}: VendorSetupNoticeInput): string {
  const vendor = escapeHtml(vendorName);
  const ibanLine = ibanChanged
    ? `<p style="margin:12px 0 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${TINTA};"><strong>Ojo:</strong> en este env&iacute;o se ha establecido o actualizado el IBAN de cobro. Si no lo esperabais, revisadlo con vuestro proveedor.</p>`
    : "";
  const body = `
                ${headline(vendor, "ha actualizado su ficha.")}
                <p style="margin:0 0 28px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${MUTED};text-align:center;">Vuestro proveedor <strong style="color:${TINTA};">${vendor}</strong> acaba de enviar su factura y su calendario de pagos en el portal de proveedores.</p>
                ${ibanLine}
                ${ctaButton("Ver en vuestro panel", panelUrl)}`;
  return layout("Novedades de un proveedor", body);
}

export function vendorInviteHtml({
  vendorName,
  partnerNames,
  inviteUrl,
}: VendorInviteInput): string {
  const vendor = escapeHtml(vendorName);
  const partners = escapeHtml(partnerNames);
  const url = escapeHtml(inviteUrl);

  const body = `
                ${headline(`${partners} os han invitado,`, `${vendor}.`)}
                <p style="margin:0 0 28px 0;font-family:${SANS};font-size:14px;line-height:22px;color:${MUTED};text-align:center;">
                  Subid vuestra factura o presupuesto, el importe y
                  los plazos de pago. Sin cuenta ni contrase&ntilde;a &mdash;
                  solo este enlace, con visibilidad de cobro para vosotros.
                </p>
                ${ctaButton("Abrir el portal", inviteUrl)}
                <p style="margin:20px 0 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED};text-align:center;">
                  Si el bot&oacute;n no funciona, copiad este enlace: ${url}
                </p>`;

  return layout(`${partnerNames} os han invitado a su portal de proveedores`, body);
}

export interface PartnerInviteInput {
  /** Email de quien invita (lo que la persona invitada reconoce). */
  inviterEmail: string;
  /** Absolute URL: https://vinklo.es/unirse?token=… */
  joinUrl: string;
  /** Días de validez del enlace. */
  days: number;
}

/**
 * Invitación a la segunda cuenta de pareja (2026-10-15). Sobria, como el
 * resto de correos a la pareja. No incluye datos de la boda: quien la
 * recibe los verá al aceptar, con su propio correo.
 */
export function partnerInviteHtml({ inviterEmail, joinUrl, days }: PartnerInviteInput): string {
  const inviter = escapeHtml(inviterEmail);
  const url = escapeHtml(joinUrl);
  const body = `
                ${headline("Preparad la boda", "a cuatro manos.")}
                <p style="margin:0 0 12px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${MUTED};text-align:center;"><strong style="color:${TINTA};">${inviter}</strong> te invita a gestionar vuestra boda en vinklo con tu propio correo: invitados, mensajes, regalos, mesas y la web, los dos a la vez.</p>
                <p style="margin:0 0 28px 0;font-family:${SANS};font-size:14px;line-height:22px;color:${MUTED};text-align:center;">Entra con el correo en el que has recibido este mensaje. El enlace vale ${days} d&iacute;as y solo sirve para ti.</p>
                ${ctaButton("Unirme a la boda", joinUrl)}
                <p style="margin:20px 0 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED};text-align:center;">
                  Si el bot&oacute;n no funciona, copia este enlace: ${url}<br />
                  &iquest;No esperabas este correo? Ign&oacute;ralo: sin aceptar no pasa nada.
                </p>`;
  return layout("Te invitan a preparar vuestra boda en vinklo", body);
}

export interface RsvpDigestInput {
  /** «En las últimas 24 horas, 4 personas han confirmado y 1 invitado no podrá ir.» (lib/rsvp-digest.ts). */
  sentence: string;
  /** Personas confirmadas en total (quien responde + acompañantes); null si no se pudo leer. */
  totalConfirmed: number | null;
  /** https://vinklo.es/panel/invitados */
  panelUrl: string;
  /** https://vinklo.es/panel/ajustes (darse de baja). */
  settingsUrl: string;
}

/**
 * Resumen diario de respuestas a la pareja (plan maestro §2.6). Sobrio, sin
 * nombres de invitados ni notas (las alergias son datos de salud): solo
 * cifras y el enlace al panel, que pide sesión.
 */
export function rsvpDigestHtml({ sentence, totalConfirmed, panelUrl, settingsUrl }: RsvpDigestInput): string {
  const total =
    totalConfirmed === null
      ? ""
      : `<br />En total ya ${totalConfirmed === 1 ? "viene 1 persona" : `vienen ${totalConfirmed} personas`}.`;
  const body = `
                ${headline("Nuevas respuestas", "a vuestra invitación.")}
                <p style="margin:0 0 28px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${MUTED};text-align:center;">
                  ${escapeHtml(sentence)}${total}
                </p>
                ${ctaButton("Ver las respuestas", panelUrl)}
                <p style="margin:20px 0 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED};text-align:center;">
                  Os escribimos como mucho una vez al d&iacute;a y solo si alguien ha respondido.
                  <a href="${escapeHtml(settingsUrl)}" style="color:${TINTA};font-weight:600;">Dejar de recibir este resumen</a>.
                </p>`;
  return layout("Nuevas respuestas a vuestra invitación", body);
}

export interface RetentionNoticeInput {
  /** Fecha a partir de la cual se anonimiza, ya formateada: «15 de julio de 2027». */
  anonymiseOnFormatted: string;
  /** https://vinklo.es/panel/invitados (exportar la lista antes). */
  panelUrl: string;
  /** https://vinklo.es/panel#regalos (descargar regalos y agradecimientos antes). */
  giftsUrl: string;
  /** https://vinklo.es/privacidad#cuanto-tiempo-conservamos-tus-datos */
  privacyUrl: string;
}

/**
 * Aviso de retención (plan maestro §5.9): 30 días antes de anonimizar los
 * datos de contacto y las respuestas de los invitados, y quién os hizo cada
 * regalo (20261026100000), un único correo a cada miembro de la boda. Sobrio,
 * sin datos de invitados, con un botón para cada descarga (el panel pide
 * entrar con la cuenta).
 */
export function retentionNoticeHtml({ anonymiseOnFormatted, panelUrl, giftsUrl, privacyUrl }: RetentionNoticeInput): string {
  const body = `
                ${headline("Los datos de vuestros", "invitados y regalos.")}
                <p style="margin:0 0 12px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${MUTED};text-align:center;">
                  Vuestra boda ya cumple casi un a&ntilde;o. Dentro de 30 d&iacute;as, a partir del <strong style="color:${TINTA};">${escapeHtml(anonymiseOnFormatted)}</strong>, borraremos los datos personales de vuestros invitados: los tel&eacute;fonos, las notas y las respuestas del formulario (alergias, autob&uacute;s, men&uacute;&hellip;), y sus enlaces personales dejar&aacute;n de funcionar.
                </p>
                <p style="margin:0 0 12px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${MUTED};text-align:center;">
                  Tambi&eacute;n borraremos de los regalos que hab&eacute;is anotado qui&eacute;n os hizo cada uno, sus descripciones y vuestras notas. Conservaremos el tipo, el importe, la fecha y si lo agradecisteis, para que los totales sigan cuadrando.
                </p>
                <p style="margin:0 0 28px 0;font-family:${SANS};font-size:14px;line-height:22px;color:${MUTED};text-align:center;">
                  Conservaremos los nombres de los invitados y qui&eacute;n vino. Si quer&eacute;is guardarlo todo, descargad antes de esa fecha la lista de invitados y la de regalos y agradecimientos (os pediremos entrar con vuestra cuenta).
                </p>
                ${ctaButton("Descargar la lista de invitados", panelUrl)}
                <div style="height:12px;line-height:12px;font-size:12px;">&nbsp;</div>
                ${ctaButton("Descargar regalos y agradecimientos", giftsUrl)}
                <p style="margin:20px 0 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED};text-align:center;">
                  Los botones abren vuestro panel: la lista, en Invitados (&laquo;Exportar CSV&raquo;); los regalos, en Regalos anotados. Os escribimos una sola vez. Lo explicamos en nuestra <a href="${escapeHtml(privacyUrl)}" style="color:${TINTA};font-weight:600;">pol&iacute;tica de privacidad</a>.
                </p>`;
  return layout("Los datos de vuestros invitados y regalos", body);
}
