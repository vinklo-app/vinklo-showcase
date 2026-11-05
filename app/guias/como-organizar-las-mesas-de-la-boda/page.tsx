import type { Metadata } from "next";
import Link from "next/link";

import { GuiaFigure, GUIA_IMG } from "@/components/guias/guia-figure";
import { GuiaShell, type GuiaFaq } from "@/components/guias/guia-shell";
import { guiaMetadata } from "@/components/guias/guias";

export const metadata: Metadata = guiaMetadata(
  "como-organizar-las-mesas-de-la-boda"
);

const FAQ: GuiaFaq[] = [
  {
    q: "¿Cuándo se hace el plano de mesas de la boda?",
    a: "Cuando tengáis casi todas las confirmaciones, normalmente pasada la fecha límite para responder. Podéis ir sentando a quien ya ha confirmado y cerrar el plano cuando el catering os pida el número definitivo.",
  },
  {
    q: "¿Cuántas personas se sientan en cada mesa?",
    a: "Depende de las mesas que tenga el sitio, de su forma y su tamaño. Preguntad al catering o a la finca qué mesas hay y cuántas personas caben cómodas en cada una antes de repartir a nadie.",
  },
  {
    q: "¿Quién se sienta en la mesa presidencial?",
    a: "No hay una norma. Hay parejas que se sientan con sus padres y padrinos, otras con sus amigos más cercanos y otras solas, en una mesa para dos. Elegid lo que os deje comer tranquilos y no abra frentes en la familia.",
  },
  {
    q: "¿Qué hacemos con los niños?",
    a: "Si son pequeños, lo normal es sentarlos con sus padres. Si hay muchos, una mesa de niños cerca de la de sus familias funciona bien. Preguntad en la confirmación cuántos niños vienen para contarlos desde el principio.",
  },
];

export default function GuiaMesas() {
  return (
    <GuiaShell slug="como-organizar-las-mesas-de-la-boda" faq={FAQ}>
      <p>
        Para organizar las mesas de la boda, esperad a tener casi todas las
        respuestas y preguntad al sitio cuántas mesas hay y cuánta gente cabe
        en cada una. Después juntad a los invitados por familias y por cómo se
        conocen, colocad primero a los grupos grandes y repasad el plano con
        las alergias delante antes de mandarlo al catering.
      </p>
      <p>
        Suele atascarse por lo mismo: se empieza con nombres sueltos. Con una
        lista que ya tiene grupos, etiquetas y respuestas, sale mucho antes.
      </p>

      <h2>¿Qué necesitamos antes de empezar?</h2>
      <ul>
        <li>
          <strong>Las respuestas.</strong> Quién viene y con cuántos
          acompañantes. Solo ocupa silla quien viene.
        </li>
        <li>
          <strong>Las mesas del sitio.</strong> Cuántas hay, si son redondas o
          rectangulares y cuántas personas caben en cada una.
        </li>
        <li>
          <strong>Los grupos.</strong> Quiénes van juntos y no se pueden
          separar: una familia, una pareja.
        </li>
        <li>
          <strong>De qué os conocen.</strong> Familia, colegio, universidad,
          trabajo. Es lo que más ayuda a sentar juntos a quienes se hablan.
        </li>
        <li>
          <strong>Alergias y menús especiales</strong>, que el catering os los
          va a pedir por mesa.
        </li>
      </ul>
      <p>
        Si vuestra lista todavía no está así, empezad por{" "}
        <Link href="/guias/lista-de-invitados-boda">
          cómo hacer la lista de invitados
        </Link>
        .
      </p>

      <h2>¿Cómo se organizan las mesas, paso a paso?</h2>
      <ol>
        <li>
          <strong>Decidid vuestra mesa</strong>: con quién os sentáis vosotros.
        </li>
        <li>
          <strong>Poned a la familia cercana</strong> en las mesas más próximas
          a la vuestra.
        </li>
        <li>
          <strong>Juntad por círculos:</strong> los de la universidad, los del
          trabajo, los del pueblo. Una mesa entera de un mismo círculo funciona
          mejor que dos medias que no se conocen.
        </li>
        <li>
          <strong>No separéis grupos.</strong> A una pareja o a una familia,
          nunca.
        </li>
        <li>
          <strong>Tirad de los comodines</strong>: ese amigo que encaja en
          cualquier mesa. Para rellenar huecos, son oro.
        </li>
        <li>
          <strong>Repasad las tensiones.</strong> Exparejas, padres separados
          que mejor no compartan mesa, el cuñado con el que no se habla nadie, la
          abuela que necesita estar cerca del baño.
        </li>
        <li>
          <strong>Dejad algún hueco libre</strong> para las respuestas de última
          hora. Siempre llega alguna.
        </li>
        <li>
          <strong>Mandad el plano al catering</strong> con cuántas personas hay
          en cada mesa y las alergias marcadas.
        </li>
      </ol>

      <GuiaFigure
        img={GUIA_IMG.mesas}
        caption="Las mesas en vinklo: cada mesa cuenta a quien viene y a sus acompañantes. «Sentar automáticamente» os enseña una propuesta antes de aplicar nada."
      />

      <h2>¿Qué hacemos con quien no ha respondido?</h2>
      <p>
        Recordádselo antes de cerrar el plano, solo a quien sigue pendiente.
        Mientras, dejadle una silla provisional, pero no deis por hecho que
        viene porque «siempre viene». Cómo recordarlo sin ponerse pesados está en{" "}
        <Link href="/guias/confirmar-asistencia-boda-whatsapp">
          cómo confirmar asistencia por WhatsApp
        </Link>
        .
      </p>

      <h2>¿Y el día de la boda?</h2>
      <p>
        Llevad el plano impreso y una lista de entrada por orden alfabético con
        la mesa de cada invitado. Dádsela a quien vaya a recibir a la gente en
        la puerta, que no seréis vosotros. Y al catering, otra copia con las
        alergias marcadas por mesa.
      </p>

      <h2>¿Cómo se hacen las mesas con vinklo?</h2>
      <p>
        Creáis las mesas con sus plazas y cada mesa va contando a quien viene y
        a sus acompañantes, con las alergias a la vista. Con «Sentar
        automáticamente», vinklo os propone un plano que no separa ningún
        grupo, junta a quien comparte etiqueta (o, si no hay etiquetas, a
        quien es invitado del mismo lado) y respeta las plazas. Lo revisáis,
        movéis a quien queráis y, si no os convence, lo deshacéis.
      </p>
      <p>
        En la ficha de cada invitado podéis marcar con quién no sentarlo, y la
        propuesta automática lo respeta. Cuando esté listo, tenéis las mesas
        y la lista de entrada para imprimir. Empezad en{" "}
        <Link href="/crear">el creador</Link> o mirad{" "}
        <Link href="/demo">la boda de ejemplo</Link>.
      </p>
    </GuiaShell>
  );
}
