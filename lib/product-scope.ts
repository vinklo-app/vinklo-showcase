/** Alcance aprobado: web de boda + CRM de asistencia. Las funciones
 * financieras se conservan para el backlog, sin nuevas operaciones.
 * Los webhooks históricos permanecen activos para conciliar pagos previos.
 *
 * /guias salió del backlog el 2026-10-05 (rama feat/geo): las guías antiguas
 * hablaban de dinero y regalos (fuera del alcance) y por eso redirigían; se
 * han sustituido por guías sobre invitaciones digitales, confirmación de
 * asistencia y lista de invitados, alineadas con el producto actual.
 *
 * /panel/proveedores salió del backlog el 2026-10-06 (rama
 * feat/crm-planificar): la página ya usa la agenda nueva sin dinero
 * (wedding_vendor_contacts) y el presupuesto como anotación de la pareja.
 * El módulo legado (tabla `vendors`, tramos, Stripe) no se importa ahí y su
 * portal /v sigue en backlog.
 */
export const RSVP_MVP = true;
export const BACKLOG_MESSAGE = "Esta función no forma parte de la beta de web de boda y asistencia.";

export function isBacklogPath(pathname: string): boolean {
  return ["/precios", "/v", "/panel/contribuciones"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
