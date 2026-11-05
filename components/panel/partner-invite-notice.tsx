import "./partner.css";

/**
 * Aviso en /onboarding cuando hay una invitación de pareja vigente para el
 * correo de la sesión (abierta en otro navegador): mejor uniros a esa boda
 * que crear otra. No muestra nada de la boda que invita.
 */
export function PartnerInviteNotice() {
  return (
    <div role="status" className="partner-invite-notice">
      <p>
        <strong>Tienes una invitación de tu pareja.</strong> Abre el enlace del correo
        «Te invitan a preparar vuestra boda» en este navegador para uniros a la misma boda.
        Si creas una aquí, tendréis dos bodas separadas.
      </p>
    </div>
  );
}
