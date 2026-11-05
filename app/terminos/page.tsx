import type { Metadata } from "next";

import { BRAND_CONTACT_EMAIL, BRAND_NAME } from "@/lib/brand";
import {
  LegalSection,
  LegalShell,
  Placeholder,
} from "@/components/guias/read-mode";

export const metadata: Metadata = {
  title: "Términos y condiciones",
  description:
    "Condiciones del servicio de vinklo: web de boda y gestión de invitados, gratuito en fase beta, sin pagos activos.",
};

/**
 * Términos y condiciones del servicio. Fase beta gratuita (invitación +
 * CRM de invitados): sin pagos, sin Stripe/Klarna activos. Si se reactivan
 * pagos, esta página y su metadata deben volver a revisarse (auditoría
 * H13, 2026-10-04).
 */
export default function TerminosPage() {
  return (
    <LegalShell
      href="/terminos"
      title="Términos y condiciones"
      meta="Última actualización: 4 de octubre de 2026"
    >
      <LegalSection id="quienes-somos-y-que-es-vinklo" title={`1. Quiénes somos y qué es ${BRAND_NAME}`}>
        <p>
          {BRAND_NAME} es un servicio prestado por{" "}
          <Placeholder>[RAZÓN SOCIAL / NOMBRE DEL TITULAR]</Placeholder>,
          con NIF <Placeholder>[NIF]</Placeholder> y domicilio en{" "}
          <Placeholder>[DOMICILIO]</Placeholder>, que permite a una
          pareja de novios (&quot;los novios&quot;, &quot;vosotros&quot;)
          crear una página de boda y compartirla con sus invitados
          mediante un enlace propio. Desde su panel, los novios pueden
          gestionar su lista de invitados, registrar confirmaciones de
          asistencia (RSVP) y acompañantes, llevar el seguimiento manual
          del envío de invitaciones (por ejemplo, por WhatsApp) y
          mantener una agenda con sus proveedores de boda. Al crear una
          cuenta o una página de boda en {BRAND_NAME}, aceptas estos
          términos y condiciones.
        </p>
      </LegalSection>

      <LegalSection id="estado-del-servicio-y-pagos" title="2. Estado del servicio: fase beta gratuita, sin pagos">
        <p>
          {BRAND_NAME} se encuentra actualmente en{" "}
          <strong>fase beta</strong> y es{" "}
          <strong>gratuito</strong> para los novios: no existen planes de
          pago, suscripciones ni cobros de ningún tipo activos en el
          Sitio. En particular, {BRAND_NAME} <strong>no procesa
          pagos ni aportaciones económicas</strong> de invitados a
          novios ni de novios a proveedores; cualquier gestión de pagos
          entre la pareja, sus invitados o sus proveedores ocurre fuera
          del Sitio, por los medios que decidan entre ellos.
        </p>
        <p>
          Si en el futuro {BRAND_NAME} activa funciones de pago o planes
          de precios, actualizaremos estos términos antes de su entrada
          en vigor y lo comunicaremos con antelación razonable.
        </p>
      </LegalSection>

      <LegalSection id="obligaciones-de-los-usuarios" title="3. Obligaciones de los usuarios">
        <p>
          Al usar {BRAND_NAME}, te comprometes a:
        </p>
        <ul>
          <li>
            Proporcionar datos veraces y mantenerlos actualizados, tanto
            en la página de boda como en los datos de tu cuenta.
          </li>
          <li>
            Usar el servicio únicamente para su finalidad: crear y
            compartir vuestra página de boda y gestionar vuestra lista
            de invitados.
          </li>
          <li>
            No utilizar {BRAND_NAME} para actividades fraudulentas,
            suplantación de identidad o cualquier otro uso ajeno al
            propósito del servicio.
          </li>
          <li>
            Custodiar tus credenciales de acceso y notificarnos
            cualquier uso no autorizado de tu cuenta.
          </li>
          <li>
            No publicar en tu página de boda contenido ilícito, que
            infrinja derechos de terceros o que sea contrario a la buena
            fe.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="cancelacion-y-baja" title="4. Cancelación y baja">
        <p>
          Puedes dejar de usar {BRAND_NAME} y solicitar la baja de tu
          cuenta en cualquier momento escribiendo a{" "}
          <a
            href={`mailto:${BRAND_CONTACT_EMAIL}`}
          >
            {BRAND_CONTACT_EMAIL}
          </a>
          .
        </p>
        <p>
          {BRAND_NAME} podrá suspender o cancelar una cuenta que
          incumpla estos términos, que haga un uso fraudulento del
          servicio o cuando así lo exija la normativa aplicable, previa
          notificación cuando sea razonablemente posible.
        </p>
      </LegalSection>

      <LegalSection id="limitacion-de-responsabilidad" title="5. Limitación de responsabilidad">
        <p>
          {BRAND_NAME} pone a disposición de los novios una herramienta
          tecnológica para gestionar su página de boda y su lista de
          invitados, pero no es parte en la relación entre los novios y
          sus invitados ni entre los novios y sus proveedores.{" "}
          {BRAND_NAME} no garantiza la asistencia de invitados a la
          boda ni el resultado de las gestiones que la pareja realice
          con sus proveedores fuera del Sitio.
        </p>
        <p>
          En la medida máxima permitida por la ley, {BRAND_NAME} no será
          responsable de indisponibilidades temporales del servicio ni
          de incidencias imputables a Supabase, Resend u otros
          proveedores tecnológicos, ni de daños indirectos o lucro
          cesante derivados del uso del servicio. Nada en estos
          términos limita la responsabilidad en los casos en que la ley
          no lo permita (por ejemplo, dolo o negligencia grave).
        </p>
      </LegalSection>

      <LegalSection id="modificacion-de-estos-terminos" title="6. Modificación de estos términos">
        <p>
          Podemos actualizar estos términos y condiciones para
          adaptarlos a cambios legales o del servicio. Los cambios
          relevantes se comunicarán con antelación razonable; el uso
          continuado de {BRAND_NAME} tras la entrada en vigor de los
          nuevos términos implica su aceptación.
        </p>
      </LegalSection>

      <LegalSection id="ley-aplicable-y-jurisdiccion" title="7. Ley aplicable y jurisdicción">
        <p>
          Estos términos y condiciones se rigen por la legislación
          española. Para cualquier controversia derivada de su
          interpretación o cumplimiento, las partes se someten a los
          Juzgados y Tribunales de{" "}
          <Placeholder>[CIUDAD DE JURISDICCIÓN]</Placeholder> (España),
          salvo que la normativa de protección de consumidores y
          usuarios establezca un fuero distinto de carácter imperativo.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
