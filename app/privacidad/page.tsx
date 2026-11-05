import type { Metadata } from "next";

import { BRAND_CONTACT_EMAIL, BRAND_NAME } from "@/lib/brand";
import {
  LegalSection,
  LegalShell,
  Placeholder,
} from "@/components/guias/read-mode";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description:
    "Cómo tratamos los datos personales en vinklo: qué recogemos, para qué y vuestros derechos (RGPD).",
};

/**
 * Política de privacidad — RGPD (UE 2016/679) y LOPDGDD (LO 3/2018).
 * Misma familia visual que /aviso-legal y /terminos.
 */
export default function PrivacidadPage() {
  return (
    <LegalShell
      href="/privacidad"
      title="Política de privacidad"
      meta="Última actualización: 17 de octubre de 2026"
    >
      <LegalSection id="responsable-del-tratamiento" title="1. Responsable del tratamiento">
        <p>
          El responsable de los tratamientos de datos personales
          descritos en esta política es{" "}
          <Placeholder>[NOMBRE Y APELLIDOS DEL TITULAR]</Placeholder>{" "}
          (persona física),
          con NIF <Placeholder>[NIF]</Placeholder> y domicilio en{" "}
          <Placeholder>[DOMICILIO]</Placeholder> (en adelante, &quot;
          {BRAND_NAME}&quot;). Para cualquier cuestión relativa a esta
          política o al tratamiento de tus datos, puedes escribirnos a{" "}
          <a
            href={`mailto:${BRAND_CONTACT_EMAIL}`}
          >
            {BRAND_CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="que-datos-tratamos" title="2. Qué datos tratamos">
        <p>
          Según cómo uses {BRAND_NAME}, tratamos distintas categorías de
          datos personales:
        </p>
        <ul>
          <li>
            <strong>
              Cuenta de los novios:
            </strong>{" "}
            dirección de email y nombres de la pareja, y los datos que
            decidáis incluir en vuestra página de boda (fecha, lugar,
            textos, fotografías, horarios, autobuses y alojamientos). Si
            invitáis a una segunda persona a gestionar la boda (por
            ejemplo, vuestra pareja con otro email), guardamos también su
            email y su acceso.
          </li>
          <li>
            <strong>Borrador antes de registraros:</strong>{" "}
            lo que escribís en el creador (/crear) se guarda en vuestro
            navegador. Cuando pedís el enlace de acceso, guardamos una
            copia del texto del borrador asociada a ese email durante un
            máximo de 7 días, para que podáis seguir aunque abráis el
            enlace en otro dispositivo. La foto no sale de vuestro
            navegador hasta que entráis en la cuenta.
          </li>
          <li>
            <strong>Invitados:</strong>{" "}
            nombre, teléfono (si la pareja lo añade para enviar la
            invitación por WhatsApp desde su propio teléfono), la
            respuesta de asistencia, el número de acompañantes y, si la
            web lo pregunta, las respuestas a los módulos: si usará el
            autobús y en qué parada, dónde se aloja, el menú elegido,
            cuántos niños vienen y una canción. También puede dejar una
            nota libre para avisos prácticos (por ejemplo, que viene con
            carrito de bebé), que no es para datos de salud. La pareja ve la fecha en
            que cada invitado abre por primera vez su enlace personal.
          </li>
          <li>
            <strong>Alergias e intolerancias:</strong>{" "}
            el invitado puede indicarlas en su respuesta. Como pueden
            revelar información de salud, solo se envían si el invitado
            marca una casilla que lo autoriza expresamente, y se usan
            únicamente para que la pareja organice el menú (art. 9.2.a
            RGPD). Guardamos la fecha en que se marcó la casilla y la
            versión del texto aceptado. Puedes retirar ese consentimiento pidiéndole a la pareja
            o a nosotros que borremos la nota.
          </li>
          <li>
            <strong>Organización de la boda:</strong>{" "}
            los grupos de invitados, las mesas y la asignación de cada
            invitado, las tareas, el presupuesto y los regalos que la
            pareja anota a mano (tipo, importe opcional y notas) y los
            agradecimientos. Todo esto es privado de la pareja: no se
            muestra al invitado ni en la página de la boda.
          </li>
          <li>
            <strong>Proveedores:</strong>{" "}
            nombre, categoría, teléfono y/o email de contacto, y las
            notas que la pareja añada sobre el estado de esa relación
            (incluida una anotación libre sobre pagos escrita por la
            propia pareja). {BRAND_NAME} no gestiona ni calcula pagos a
            proveedores y no recoge datos bancarios ni IBAN.
          </li>
          <li>
            <strong>Inteligencia artificial:</strong>{" "}
            en el creador (/crear), también antes de registraros, el texto
            con el que describís vuestra boda se envía a un modelo de IA
            para rellenar la web. En el editor, los textos de la página
            que pidáis cambiar se envían igual, solo para generar la
            propuesta. Usamos Claude, de Anthropic, mediante su API, o
            Gemini, de Google, a través de Vercel AI Gateway, según la
            configuración del servicio. En el creador y en el editor no
            añadimos los datos de vuestros invitados al contexto de la IA.
          </li>
          <li>
            <strong>Mesas con IA:</strong>{" "}
            si subís una foto o captura del plano del salón, la imagen se
            envía al modelo de IA configurado, Claude (Anthropic) o
            Gemini (Google), solo para leer las mesas (número o
            nombre, forma, plazas y posición) y no se guarda: se procesa en
            memoria y se descarta. Antes de subirla, la reducimos en vuestro
            dispositivo y le quitamos los datos de ubicación. Para explicar
            cada mesa de una propuesta, solo enviamos el tamaño de cada
            grupo, sus etiquetas y su lado, sin nombres, notas ni alergias.
            Quién se sienta dónde lo decide siempre un cálculo propio, no la
            IA, y nada se aplica sin que lo confirméis.
          </li>
          <li>
            <strong>Asistente del panel:</strong>{" "}
            enviamos al modelo de IA el texto que escribís y datos agregados
            de vuestra boda, como el número de confirmados, pendientes y
            tareas. No añadimos la lista de invitados, sus teléfonos,
            correos, alergias, notas privadas ni enlaces personales. El
            asistente prepara respuestas y propuestas; los cambios solo se
            guardan cuando pulsáis para aplicarlos. No incluyáis información
            de salud ni otros datos sensibles en vuestras instrucciones.
          </li>
          <li>
            <strong>Sugerencias de lugares:</strong>{" "}
            cuando escribís el lugar o la dirección de la boda (en el
            creador, también antes de registraros, y en vuestro panel),
            lo que vais tecleando se envía desde nuestros servidores a
            Google (Google Maps) o, si ese servicio no está activo, a
            Photon, de OpenStreetMap, únicamente para sugeriros sitios.
            Vuestra dirección IP no llega a esos servicios; lo que
            escribís para buscar no se guarda en nuestra base de datos ni
            en los registros (como mucho, unos minutos en memoria para no
            repetir la misma búsqueda), y en vuestra web solo queda el
            lugar que elijáis o escribáis.
          </li>
          <li>
            <strong>
              Datos técnicos:
            </strong>{" "}
            los estrictamente necesarios para mantener la sesión
            iniciada y el servicio en funcionamiento (ver sección de
            cookies).
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="con-que-finalidad-y-con-que-base-juridica" title="3. Con qué finalidad y con qué base jurídica">
        <ul>
          <li>
            <strong>
              Prestar el servicio
            </strong>{" "}
            (crear y publicar la página de boda, gestionar la lista de
            invitados y sus respuestas de asistencia, mantener la
            agenda de proveedores y enviar notificaciones del
            servicio):
            base jurídica de{" "}
            <strong>
              ejecución de un contrato
            </strong>{" "}
            (art. 6.1.b RGPD) entre {BRAND_NAME} y quien usa el
            servicio.
          </li>
          <li>
            <strong>
              Comunicaciones opcionales
            </strong>{" "}
            (por ejemplo, avisos sobre nuevas funciones): base jurídica
            de{" "}
            <strong>consentimiento</strong>{" "}
            (art. 6.1.a RGPD), que puedes retirar en cualquier momento.
          </li>
          <li>
            <strong>
              Cumplimiento de obligaciones legales
            </strong>{" "}
            (por ejemplo, las que nos imponga la normativa de pagos o de
            prevención del fraude): base jurídica de{" "}
            <strong>
              obligación legal
            </strong>{" "}
            (art. 6.1.c RGPD).
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="a-quien-comunicamos-tus-datos" title="4. A quién comunicamos tus datos">
        <p>
          No vendemos tus datos a nadie. Para poder prestar el servicio
          trabajamos con proveedores que actúan como encargados del
          tratamiento (procesan datos por cuenta de {BRAND_NAME}, bajo
          contrato y sus propias garantías de seguridad):
        </p>
        <ul>
          <li>
            <strong>Supabase</strong>,
            como proveedor de alojamiento (hosting) de la base de datos
            y la infraestructura donde se almacenan tus datos.
          </li>
          <li>
            <strong>Resend</strong>, como
            proveedor de envío de emails del servicio (por ejemplo, el
            enlace de acceso a tu cuenta).
          </li>
          <li>
            <strong>Vercel</strong>, como
            proveedor de alojamiento de la aplicación web (los servidores
            que muestran las páginas y procesan las peticiones).
          </li>
          <li>
            <strong>Anthropic (modelo Claude)</strong>, para las peticiones
            que utilizan su API: textos e instrucciones del creador, editor
            y asistente del panel, lectura del plano y explicaciones de
            mesas, con el contexto limitado descrito arriba.
          </li>
          <li>
            <strong>Google (modelo Gemini)</strong>,{" "}
            a través de Vercel AI Gateway, únicamente cuando usáis la IA
            del creador o del editor, para generar la propuesta
            solicitada, o la de las mesas, para leer el plano del salón
            (la imagen no se guarda) y explicar la propuesta de mesas con
            datos sin nombres.
          </li>
          <li>
            <strong>Google (Google Maps Platform)</strong>, únicamente
            para sugerir lugares mientras escribís el lugar o la dirección
            de la boda.
          </li>
          <li>
            <strong>Photon (komoot, con datos de OpenStreetMap)</strong>,
            en lugar de Google cuando ese servicio no está activo, con la
            misma única finalidad. Se presta desde Alemania, dentro de la
            Unión Europea.
          </li>
        </ul>
        <p>
          <strong>Transferencias internacionales:</strong>{" "}
          Supabase, Resend, Vercel y Google (Gemini y Google Maps) son empresas de Estados Unidos y pueden tratar
          datos fuera del Espacio Económico Europeo. Lo hacen bajo el Marco
          de Privacidad de Datos UE-EE. UU. o, en su defecto, bajo las
          cláusulas contractuales tipo de la Comisión Europea (art. 45 y
          46 RGPD).
        </p>
        <p>
          {BRAND_NAME} no procesa pagos en esta fase del servicio, por
          lo que no compartimos datos con pasarelas de pago. Si en el
          futuro activamos funciones de pago, actualizaremos esta
          política antes de hacerlo.
        </p>
        <p>
          No cedemos datos a terceros con fines publicitarios ni
          elaboramos perfiles con tus datos para dicho fin.
        </p>
      </LegalSection>

      <LegalSection id="cuanto-tiempo-conservamos-tus-datos" title="5. Cuánto tiempo conservamos tus datos">
        <p>
          Conservamos tus datos mientras la cuenta o la página de boda
          esté activa y, tras su baja, durante los plazos exigidos por
          la normativa aplicable (por ejemplo, la relativa a
          obligaciones frente a medios de pago), y en todo caso durante
          el plazo necesario para atender posibles responsabilidades
          derivadas del tratamiento. Transcurridos dichos plazos, los
          datos se eliminan o se anonimizan de forma irreversible.
        </p>
        <p>
          <strong>Datos de los invitados tras la boda.</strong> Doce meses
          después de la fecha de la boda borramos de forma automática los
          teléfonos, las notas, las respuestas al formulario (por ejemplo,
          alergias, autobús o menú) con el registro del consentimiento, los nombres de los acompañantes y los
          enlaces personales de los invitados. En los regalos que la pareja
          haya anotado borramos quién hizo cada regalo, su descripción y las
          notas. La pareja conserva, mientras mantenga su cuenta, el nombre de
          cada invitado, si asistió y con cuántos acompañantes, su grupo, mesa
          y etiquetas y, de cada regalo, el tipo, el importe, la fecha y si lo
          agradeció. Avisamos por correo a quienes gestionan la boda
          30 días antes y, si el aviso llega más tarde de esos doce meses,
          esperamos igualmente 30 días desde el aviso. Hasta ese momento,
          la pareja puede descargar desde su panel la lista de invitados y la
          de regalos y agradecimientos completas.
        </p>
        <p>
          <strong>Registros de actividad.</strong> Los registros técnicos de
          actividad de cada boda se borran a los 13 meses.
        </p>
        <p>
          <strong>Borrado a petición.</strong> Desde los ajustes del panel,
          quien creó la boda puede eliminarla en cualquier momento (con su
          web, invitados, respuestas y fotos), y cada persona puede eliminar
          su cuenta. Si quien creó la boda elimina su cuenta y la gestionaba
          con su pareja, la boda pasa a la pareja; si no, se elimina también.
        </p>
      </LegalSection>

      <LegalSection id="tus-derechos" title="6. Tus derechos">
        <p>
          Puedes ejercer en cualquier momento tus derechos de{" "}
          <strong>
            acceso, rectificación, supresión, oposición, portabilidad y
            limitación del tratamiento
          </strong>{" "}
          (derechos ARSOPL) escribiendo a{" "}
          <a
            href={`mailto:${BRAND_CONTACT_EMAIL}`}
          >
            {BRAND_CONTACT_EMAIL}
          </a>{" "}
          indicando el derecho que quieres ejercer y adjuntando, si
          procede, copia de un documento que acredite tu identidad.
          Responderemos en el plazo legalmente previsto.
        </p>
        <p>
          Si consideras que el tratamiento de tus datos no se ajusta a
          la normativa, tienes derecho a presentar una reclamación ante
          la Agencia Española de Protección de Datos (
          <strong>www.aepd.es</strong>).
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="7. Cookies">
        <p>
          {BRAND_NAME} utiliza únicamente{" "}
          <strong>
            cookies técnicas esenciales
          </strong>
          , necesarias para mantener tu sesión iniciada de forma segura
          (gestionadas por Supabase Auth, nuestro proveedor de
          autenticación). Estas cookies no requieren consentimiento
          porque son estrictamente necesarias para prestar el servicio
          que solicitas (art. 22.2 LSSI-CE).
        </p>
        <p>
          Hoy no utilizamos cookies de publicidad ni de analítica de
          terceros, por lo que no mostramos un banner de consentimiento
          de cookies. Si en el futuro incorporamos cookies no esenciales,
          actualizaremos esta política y solicitaremos tu consentimiento
          antes de instalarlas.
        </p>
      </LegalSection>

      <LegalSection id="cambios-en-esta-politica" title="8. Cambios en esta política">
        <p>
          Podemos actualizar esta política de privacidad para adaptarla
          a novedades legislativas o a cambios en el servicio. Cuando lo
          hagamos, actualizaremos la fecha que figura al inicio de este
          documento y, si el cambio es relevante, te avisaremos por los
          medios habituales.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
