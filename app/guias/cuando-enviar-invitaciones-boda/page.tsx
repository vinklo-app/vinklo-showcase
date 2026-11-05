import type { Metadata } from "next";
import Link from "next/link";

import { GuiaFigure, GUIA_IMG } from "@/components/guias/guia-figure";
import { GuiaShell, type GuiaFaq } from "@/components/guias/guia-shell";
import { guiaMetadata } from "@/components/guias/guias";

export const metadata: Metadata = guiaMetadata(
  "cuando-enviar-invitaciones-boda"
);

const FAQ: GuiaFaq[] = [
  {
    q: "¿Cuánto antes se manda el «reserva la fecha»?",
    a: "En cuanto tengáis cerrados la fecha y el sitio, sobre todo si hay invitados que tienen que viajar. Basta con vuestros nombres, la fecha y la ciudad; los detalles llegan después, con la invitación.",
  },
  {
    q: "¿Se puede enviar la invitación de boda por WhatsApp?",
    a: "Sí, siempre que el mensaje sea personal y la invitación esté cuidada. Lo cómodo es que cada invitado reciba su propio enlace y conteste desde ahí, en vez de responder en el chat.",
  },
  {
    q: "¿Qué hacemos si cambia algo después de enviar las invitaciones?",
    a: "Si la invitación es digital, la corregís una vez y todos ven la versión nueva al abrir su enlace. Si el cambio es gordo (fecha, sitio u hora de la ceremonia), avisad además con un mensaje.",
  },
];

export default function GuiaCuandoEnviar() {
  return (
    <GuiaShell slug="cuando-enviar-invitaciones-boda" faq={FAQ}>
      <p>
        Como orientación, las invitaciones de boda se envían entre dos y tres
        meses antes, y antes todavía si mucha gente tiene que viajar o la boda
        cae en temporada alta. La fecha límite para confirmar se calcula al
        revés: desde el día en que el sitio os pide el número definitivo de
        invitados.
      </p>
      <p>
        No hay ninguna norma oficial. Manda lo que necesitan vuestros invitados
        para organizarse y lo que os pide el catering.
      </p>

      <h2>¿Con cuánta antelación se envían las invitaciones?</h2>
      <p>
        Lo normal son dos o tres meses. Con menos, a parte de la gente ya le
        coincide con otra cosa. Con mucho más, la invitación se olvida y vais a
        tener que recordarla igual. Si la boda es en otra ciudad, en verano o
        en puente, adelantad el envío: quien viene desde Canarias o desde
        Berlín necesita tiempo para pillar vuelo y hotel a un precio razonable.
      </p>

      <h2>¿Hace falta un «reserva la fecha»?</h2>
      <p>
        Si tenéis invitados que viajan o la fecha es complicada, sí. Un
        «reserva la fecha» (el <em>save the date</em> de toda la vida) es un
        aviso corto, sin detalles, que se manda en cuanto tenéis fecha y sitio
        cerrados. La invitación completa, con la confirmación, llega más tarde.
        Si toda vuestra gente vive a media hora, os lo podéis saltar.
      </p>

      <h2>¿Qué fecha límite ponemos para confirmar?</h2>
      <p>
        Primero preguntad al catering o a la finca cuándo quieren el número
        cerrado de cubiertos. Suele ser unas semanas antes de la boda, pero
        cada sitio tiene su plazo. Poned vuestra fecha límite unos días antes
        de ese día, porque los rezagados existen. Y escribidla con día
        concreto: «antes del 15 de mayo», no «cuanto antes», que para muchos
        significa «cuando me acuerde».
      </p>

      <GuiaFigure
        img={GUIA_IMG.resumenRespuestas}
        caption="El resumen de vinklo: a cuántos les habéis enviado la invitación, cuántos la han abierto y cuántos han respondido (boda de ejemplo)."
      />

      <h2>¿Y si alguien no responde a tiempo?</h2>
      <p>
        Un recordatorio amable a quien siga pendiente, unos días antes de que
        venza el plazo. Para eso tenéis que saber exactamente quién falta, y
        eso es mucho más fácil si las respuestas llegan a una lista y no al
        chat. Lo explicamos en{" "}
        <Link href="/guias/confirmar-asistencia-boda-whatsapp">
          cómo pedir la confirmación de asistencia por WhatsApp
        </Link>
        .
      </p>

      <h2>¿Cambia algo si la invitación es digital?</h2>
      <p>
        Cambian vuestros plazos, no los de los invitados. Una invitación
        digital llega al momento, así que no hay que contar días de imprenta ni
        de correo, y si algo cambia después se corrige una vez. Pero la gente
        necesita el mismo tiempo para pedirse el día libre o buscar canguro.
        Comparamos los dos formatos en{" "}
        <Link href="/guias/invitacion-de-boda-digital-o-papel">
          invitación digital o de papel
        </Link>
        .
      </p>

      <h2>¿Cómo lo hacemos con vinklo?</h2>
      <p>
        Podéis crear la web de la boda en cuanto tengáis fecha y sitio,
        publicarla cuando queráis enviarla y añadir autobuses u hoteles más
        tarde, sin reenviar nada. A cada invitado le mandáis por WhatsApp su
        enlace, por tandas si queréis, y los recordatorios salen ya escritos
        solo para quien recibió la invitación y aún no ha respondido. Las
        respuestas se juntan en vuestra lista de invitados. Es gratis. Empezad
        en <Link href="/crear">el creador</Link> o mirad{" "}
        <Link href="/demo">la boda de ejemplo</Link>.
      </p>
    </GuiaShell>
  );
}
