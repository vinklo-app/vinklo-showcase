import type { Metadata } from "next";
import Link from "next/link";

import { GuiaFigure, GUIA_IMG } from "@/components/guias/guia-figure";
import { GuiaShell, type GuiaFaq } from "@/components/guias/guia-shell";
import { guiaMetadata } from "@/components/guias/guias";

export const metadata: Metadata = guiaMetadata(
  "que-poner-en-una-invitacion-de-boda"
);

const FAQ: GuiaFaq[] = [
  {
    q: "¿Se ponen los nombres de los padres en la invitación?",
    a: "Es costumbre en las invitaciones formales, no una obligación. Si os apetece tener ese detalle con ellos, ponedlos; si vuestra invitación es más cercana, con vuestros nombres basta.",
  },
  {
    q: "¿Cómo decimos que la boda es sin niños?",
    a: "Claro y sin pedir perdón, por ejemplo: «Hemos pensado en una celebración solo para adultos; esperamos que lo entendáis». Ponedlo en la invitación o en las preguntas frecuentes, y en el mensaje nombrad solo a quien está invitado.",
  },
  {
    q: "¿Se pone el código de vestimenta?",
    a: "Si lo hay, sí, y dicho en cristiano: «de cóctel», «etiqueta» o «ropa cómoda, que la fiesta es en el campo». Si no hay ninguno especial, no hace falta mencionarlo.",
  },
  {
    q: "¿Se mencionan los regalos en la invitación?",
    a: "Con discreción y sin que parezca obligatorio. Si queréis decir algo, mejor en un apartado propio o en las preguntas frecuentes que en la portada.",
  },
];

export default function GuiaQuePoner() {
  return (
    <GuiaShell slug="que-poner-en-una-invitacion-de-boda" faq={FAQ}>
      <p>
        Una invitación de boda tiene que decir quién se casa, cuándo (fecha y
        hora), dónde (ceremonia y celebración, con dirección) y cómo y hasta
        cuándo hay que confirmar. A partir de ahí, lo que más os van a
        preguntar es el programa del día, los autobuses, el alojamiento y si
        pueden ir los niños. Si lo ponéis, os ahorráis muchos mensajes.
      </p>
      <p>
        En una invitación digital cabe todo sin apretar, y si algo cambia se
        corrige después de enviarla.
      </p>

      <h2>¿Qué información es imprescindible?</h2>
      <ul>
        <li>
          <strong>Vuestros nombres.</strong> Como os conoce la gente. Si a la
          novia todo el mundo la llama Maite, poned Maite y no María Teresa.
        </li>
        <li>
          <strong>Fecha y hora.</strong> Con el día de la semana. «Sábado 12 de
          junio» evita más dudas que «12/06».
        </li>
        <li>
          <strong>Dónde es la ceremonia y dónde la celebración.</strong> Con la
          dirección completa, sobre todo si son sitios distintos.
        </li>
        <li>
          <strong>Cómo confirmar.</strong> Por dónde se responde y una fecha
          límite concreta.
        </li>
      </ul>

      <GuiaFigure
        img={GUIA_IMG.invitacionMovil}
        phone
        caption="Lo primero que ve el invitado: vuestros nombres. Todo lo demás va dentro, ordenado (boda de ejemplo)."
      />

      <h2>¿Cómo ponemos el programa del día?</h2>
      <p>
        Como una lista de horas, sin adornos: a qué hora llegar, cuándo se come
        y cuándo se puede ir quien tiene canguro hasta las doce.
      </p>
      <ul>
        <li>«12:30 · Ceremonia en la iglesia de San Pedro»</li>
        <li>«14:00 · Cóctel en los jardines de la finca»</li>
        <li>«16:00 · Banquete»</li>
        <li>«19:00 · Fiesta»</li>
      </ul>

      <h2>¿Qué ponemos de los autobuses?</h2>
      <p>
        La hora y el punto exacto de cada salida, y las horas de vuelta («desde
        el centro» no sirve). Si hay varios trayectos, una línea por cada uno: «Ida:
        11:45 desde la plaza Mayor. Vuelta: 20:00 y 2:00 desde la finca». Y
        preguntad en la confirmación quién lo va a coger, para contratar las
        plazas justas.
      </p>

      <h2>¿Y el alojamiento?</h2>
      <p>
        Si viene gente de fuera, poned dos o tres hoteles cerca, con su
        dirección y cómo reservar. Si habéis apalabrado algo con alguno, decid
        hasta cuándo vale. Preguntar en la confirmación quién necesita hotel os
        ayuda, de paso, a cuadrar los autobuses.
      </p>

      <h2>¿Qué más conviene añadir?</h2>
      <ul>
        <li>Cómo llegar y dónde aparcar.</li>
        <li>Si los niños están invitados y, si lo están, cuántos vienen.</li>
        <li>Menú: si hay que elegir plato o avisar de alergias.</li>
        <li>Código de vestimenta, si lo hay.</li>
        <li>Una canción para la fiesta, si os apetece preguntarla.</li>
        <li>Unas preguntas frecuentes para todo lo demás.</li>
      </ul>

      <h2>¿Cómo redactamos el texto?</h2>
      <p>
        Como habláis. Hay invitaciones formales, con los nombres de los padres,
        y otras de colegas; las dos están bien si suenan a vosotros. Lo que
        chirría es una pareja muy guasona con una invitación solemne. Algunos
        ejemplos para adaptar:
      </p>
      <ul>
        <li>
          «Lucía y Juan nos casamos. Nos encantaría que vinieras el sábado 12 de
          junio a la finca El Olivar.»
        </li>
        <li>
          «Después de diez años juntos, por fin lo celebramos. Te esperamos el
          12 de junio.»
        </li>
        <li>«Confírmanos si vienes antes del 15 de mayo desde este enlace.»</li>
      </ul>

      <h2>¿Qué es mejor no poner?</h2>
      <p>
        Lo que no es para todos. Si hay una parte de la boda solo para
        algunos, como una cena la víspera, contadla en persona. Y lo que puede
        cambiar, como el horario del autobús o el menú, mejor en una invitación
        digital, donde se corrige sin reenviar nada.
      </p>

      <h2>¿Cómo nos ayuda vinklo con el contenido?</h2>
      <p>
        El creador de vinklo os va pidiendo justo estos datos (nombres, fecha,
        sitios, programa y bienvenida) y monta la web mientras contestáis, así
        que lo imprescindible no se os escapa. Luego podéis añadir autobuses,
        hoteles, menú, niños, canción y preguntas frecuentes. Los apartados que
        necesitan respuesta salen también en el formulario de confirmación, y
        las respuestas os llegan a vuestra lista.
      </p>
      <p>
        Es gratis. Mirad cómo queda en{" "}
        <Link href="/demo">la boda de ejemplo</Link> o empezad en{" "}
        <Link href="/crear">el creador</Link>. Si queréis el paso a paso
        completo, está en{" "}
        <Link href="/guias/invitacion-de-boda-digital">
          cómo hacer la web de vuestra boda
        </Link>
        .
      </p>
    </GuiaShell>
  );
}
