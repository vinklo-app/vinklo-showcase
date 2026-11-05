import type { Metadata } from "next";
import Link from "next/link";

import { BRAND_CONTACT_EMAIL, BRAND_NAME } from "@/lib/brand";
import {
  LegalSection,
  LegalShell,
  Placeholder,
} from "@/components/guias/read-mode";

export const metadata: Metadata = {
  title: "Aviso legal",
  description:
    "Datos del titular y condiciones de uso del sitio vinklo.es (LSSI-CE).",
};

/**
 * Aviso legal — LSSI-CE (Ley 34/2002). Página de documento sobria:
 * misma paleta papel/tinta/cava que el resto del producto, sin cabecera
 * ni pie completos, solo el enlace "Volver" (docs/legal-report).
 */
export default function AvisoLegalPage() {
  return (
    <LegalShell
      href="/aviso-legal"
      title="Aviso legal"
      meta="Última actualización: 4 de octubre de 2026"
    >
      <LegalSection id="titular-del-sitio" title="1. Titular del sitio">
        <p>
          En cumplimiento del artículo 10 de la Ley 34/2002, de 11 de
          julio, de Servicios de la Sociedad de la Información y de
          Comercio Electrónico (LSSI-CE), se informa de los siguientes
          datos: el sitio web {BRAND_NAME}.es (en adelante, &quot;el
          Sitio&quot;) es titularidad de{" "}
          <Placeholder>[NOMBRE Y APELLIDOS DEL TITULAR]</Placeholder>{" "}
          (persona física),
          con NIF <Placeholder>[NIF]</Placeholder> y domicilio en{" "}
          <Placeholder>[DOMICILIO]</Placeholder> (en adelante, &quot;
          {BRAND_NAME}&quot;, &quot;nosotros&quot;). Puede contactarse a
          través de{" "}
          <a
            href={`mailto:${BRAND_CONTACT_EMAIL}`}
          >
            {BRAND_CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="objeto" title="2. Objeto">
        <p>
          {BRAND_NAME} es un servicio online, actualmente en fase
          beta gratuita, que permite a parejas de novios crear una
          página de boda, compartirla con sus invitados mediante un
          enlace propio y gestionar su lista de invitados: confirmaciones
          de asistencia (RSVP), acompañantes y el seguimiento manual del
          envío de invitaciones. {BRAND_NAME} no procesa pagos ni
          aportaciones económicas de ningún tipo en esta fase. El
          presente aviso legal regula el acceso y uso del Sitio por
          parte de cualquier persona que lo visite (&quot;el
          Usuario&quot;).
        </p>
        <p>
          El uso del Sitio implica la aceptación de este aviso legal.
          Las condiciones específicas del servicio se recogen en
          nuestros{" "}
          <Link href="/terminos">
            Términos y condiciones
          </Link>{" "}
          y el tratamiento de datos personales en nuestra{" "}
          <Link href="/privacidad">
            Política de privacidad
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="condiciones-de-uso" title="3. Condiciones de uso">
        <p>
          El Usuario se compromete a hacer un uso adecuado y lícito del
          Sitio, así como de los contenidos y servicios que se ofrecen a
          través de él, de conformidad con la legislación aplicable, el
          presente aviso legal, las buenas costumbres y el orden
          público. En particular, el Usuario se compromete a no utilizar
          el Sitio para fines fraudulentos, para dañar a terceros o para
          introducir virus, malware o cualquier otro código de
          naturaleza dañina en los sistemas de {BRAND_NAME} o de
          terceros.
        </p>
        <p>
          {BRAND_NAME} se reserva el derecho a modificar, suspender o
          interrumpir, en cualquier momento y sin necesidad de previo
          aviso, el acceso al Sitio, así como a denegar o retirar el
          acceso a Usuarios que incumplan estas condiciones.
        </p>
      </LegalSection>

      <LegalSection id="propiedad-intelectual-e-industrial" title="4. Propiedad intelectual e industrial">
        <p>
          Todos los contenidos del Sitio —incluyendo, sin carácter
          limitativo, textos, imágenes, marcas, logotipos, el nombre
          comercial &quot;{BRAND_NAME}&quot;, código fuente y diseño— son
          propiedad de {BRAND_NAME} o de terceros que han autorizado su
          uso, y están protegidos por la normativa española y
          comunitaria en materia de propiedad intelectual e industrial.
        </p>
        <p>
          Queda prohibida la reproducción, distribución, comunicación
          pública, transformación o cualquier otra forma de explotación
          de dichos contenidos sin la autorización previa y expresa de
          su titular, salvo en los casos en que la ley lo permita
          expresamente o resulte necesario con fines de cita o
          información periodística.
        </p>
        <p>
          Los contenidos que la pareja de novios publica en su página de
          boda (nombres, fotografías, fechas y textos propios) son de su
          exclusiva responsabilidad; {BRAND_NAME} actúa únicamente como
          prestador del servicio de alojamiento de dicho contenido.
        </p>
      </LegalSection>

      <LegalSection id="responsabilidad" title="5. Responsabilidad">
        <p>
          {BRAND_NAME} no garantiza la disponibilidad y continuidad
          ininterrumpida del Sitio ni la ausencia de errores en sus
          contenidos, si bien pondrá los medios razonables a su alcance
          para mantener el servicio operativo y corregir cualquier
          incidencia a la mayor brevedad.
        </p>
        <p>
          {BRAND_NAME} no se hace responsable de los daños y perjuicios
          de cualquier naturaleza que pudieran derivarse de la falta de
          disponibilidad o continuidad del Sitio, de errores u
          omisiones en los contenidos publicados por terceros, ni del
          uso ilícito, negligente o contrario a las presentes
          condiciones que los Usuarios pudieran hacer del Sitio o de sus
          contenidos.
        </p>
        <p>
          El Sitio puede contener enlaces a sitios web de terceros.
          {BRAND_NAME} no asume responsabilidad alguna por el
          contenido, políticas o prácticas de dichos sitios, que se
          rigen por sus propias condiciones.
        </p>
      </LegalSection>

      <LegalSection id="ley-aplicable-y-jurisdiccion" title="6. Ley aplicable y jurisdicción">
        <p>
          El presente aviso legal se rige en su totalidad por la
          legislación española. Para la resolución de cualquier
          controversia derivada del acceso o uso del Sitio, las partes
          se someten a los Juzgados y Tribunales que correspondan
          conforme a la normativa aplicable; cuando el Usuario tenga la
          condición de consumidor, serán competentes los Juzgados y
          Tribunales de su domicilio en España.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
