import type { Metadata } from "next";
import Link from "next/link";

import { GuiaFigure, GUIA_IMG } from "@/components/guias/guia-figure";
import { GuiaShell, type GuiaFaq } from "@/components/guias/guia-shell";
import { guiaMetadata } from "@/components/guias/guias";

export const metadata: Metadata = guiaMetadata(
  "invitacion-de-boda-digital-o-papel"
);

const FAQ: GuiaFaq[] = [
  {
    q: "¿Qué invitación de boda es más barata, la digital o la de papel?",
    a: "La digital suele salir más barata porque no hay imprenta ni envío, y las hay gratuitas. La de papel depende del diseño, del papel y de cuántas imprimáis; pedid presupuesto con el número exacto.",
  },
  {
    q: "¿Cómo confirman la asistencia los invitados con invitación de papel?",
    a: "Por teléfono, por mensaje o con un código o enlace impreso en la tarjeta. Llegue como llegue, apuntad su respuesta en la misma lista que las de la invitación digital para tener un único recuento.",
  },
  {
    q: "¿Queda bien enviar solo la invitación digital?",
    a: "Sí, y cada vez es más habitual. Si os preocupa algún invitado en concreto, mandadle además una impresa o llamadle: no hace falta elegir lo mismo para todo el mundo.",
  },
];

export default function GuiaDigitalOPapel() {
  return (
    <GuiaShell slug="invitacion-de-boda-digital-o-papel" faq={FAQ}>
      <p>
        La invitación de boda digital gana en lo práctico: se envía en un
        momento, se corrige si algo cambia y recoge las confirmaciones en un
        solo sitio. La de papel gana como recuerdo y para quien no se apaña con
        el móvil. Por eso muchas parejas acaban haciendo las dos: digital para
        todos y unas pocas impresas para quien de verdad las va a guardar.
      </p>

      <h2>¿En qué se diferencian?</h2>
      <div
        className="rd-scroll"
        role="region"
        aria-label="Comparativa entre invitación digital y de papel"
        tabIndex={0}
      >
        <table className="rd-table">
          <thead>
            <tr>
              <th scope="col">Aspecto</th>
              <th scope="col">Digital</th>
              <th scope="col">Papel</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Envío</th>
              <td>Un enlace por WhatsApp, al momento</td>
              <td>En mano o por correo, con días de margen</td>
            </tr>
            <tr>
              <th scope="row">Cambios después de enviarla</th>
              <td>Se corrige una vez y todos ven la versión buena</td>
              <td>Hay que avisar uno a uno</td>
            </tr>
            <tr>
              <th scope="row">Confirmación de asistencia</th>
              <td>Desde la propia invitación, queda apuntada</td>
              <td>Por teléfono o mensaje, y se apunta a mano</td>
            </tr>
            <tr>
              <th scope="row">Información práctica</th>
              <td>Mapa, horarios y detalles sin límite de espacio</td>
              <td>Lo que quepa en la tarjeta</td>
            </tr>
            <tr>
              <th scope="row">Recuerdo físico</th>
              <td>No</td>
              <td>Sí</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>¿Cuándo tiene más sentido la invitación digital?</h2>
      <p>
        Cuando casi todos vuestros invitados usan WhatsApp, que hoy es lo
        normal. También cuando hay cosas que pueden moverse (el horario del
        autobús, el sitio del cóctel si llueve) o cuando queréis saber quién
        ha confirmado sin pasar respuestas a mano. Y si vais con prisa, no
        dependéis de imprenta ni de correos.
      </p>

      <GuiaFigure
        img={GUIA_IMG.invitacionMovil}
        phone
        caption="Digital no tiene por qué ser frío: la invitación puede abrirse como un sobre con su sello (boda de ejemplo)."
      />

      <h2>¿Cuándo merece la pena el papel?</h2>
      <p>
        Cuando queréis que la invitación se guarde. La abuela que la pondrá en
        la nevera con un imán la disfruta más en papel que en un enlace. Y para los
        familiares que no usan el móvil, una tarjeta entregada en mano sigue
        siendo un detalle bonito.
      </p>

      <h2>¿Se pueden combinar?</h2>
      <p>
        Sí, y en muchas bodas es lo más sensato. Mandad la digital a todos para
        que tengan la información y puedan responder, e imprimid unas pocas
        para quien las vaya a apreciar. Solo hay una condición: todas las
        respuestas, lleguen por donde lleguen, tienen que acabar en la misma
        lista de invitados. Cómo llevarla, en{" "}
        <Link href="/guias/lista-de-invitados-boda">
          cómo organizar la lista de invitados
        </Link>
        .
      </p>

      <h2>¿Es de mal gusto enviar la invitación por WhatsApp?</h2>
      <p>
        No, si la invitación está cuidada y el mensaje es personal. Lo frío es
        reenviar la misma imagen a un grupo de cuarenta personas sin decir ni
        hola. Un mensaje con el nombre de la persona y su propio enlace dice
        «hemos pensado en ti» igual que una tarjeta en mano.
      </p>

      <h2>¿Qué ofrece vinklo?</h2>
      <p>
        vinklo junta la web de vuestra boda y vuestra lista de invitados. La
        creáis contestando unas preguntas, elegís si se ve como una Story o
        como una web y la compartís por WhatsApp con un enlace para cada
        invitado. Las respuestas aparecen en vuestra lista, y las que os
        lleguen por teléfono o en persona también las podéis apuntar ahí. Es
        gratis. Si queréis empezar por lo básico, leed{" "}
        <Link href="/guias/invitacion-de-boda-digital">
          cómo hacer la web de vuestra boda
        </Link>{" "}
        o mirad <Link href="/demo">la boda de ejemplo</Link>.
      </p>
    </GuiaShell>
  );
}
