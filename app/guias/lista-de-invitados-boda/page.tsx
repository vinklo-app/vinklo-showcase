import type { Metadata } from "next";
import Link from "next/link";

import { GuiaFigure, GUIA_IMG } from "@/components/guias/guia-figure";
import { GuiaShell, type GuiaFaq } from "@/components/guias/guia-shell";
import { guiaMetadata } from "@/components/guias/guias";

export const metadata: Metadata = guiaMetadata("lista-de-invitados-boda");

const FAQ: GuiaFaq[] = [
  {
    q: "¿Cómo recortamos la lista de invitados sin discutir?",
    a: "Acordad el criterio antes de mirar nombres y aplicadlo a círculos enteros: primos sí y primos segundos no, o del trabajo solo con quien quedáis fuera de la oficina. Un criterio por grupos se explica mucho mejor que un «a ti no» persona a persona.",
  },
  {
    q: "¿Invitamos con acompañante a todo el mundo?",
    a: "No hace falta. Lo habitual es fijar una regla, por ejemplo pareja estable sí y acompañante genérico no, y aplicarla igual a todos. Apuntad cuántos acompañantes puede traer cada invitado y pedidle que confirme cuántos vienen de verdad.",
  },
  {
    q: "¿Podemos llevar la lista los dos a la vez?",
    a: "Sí, si usáis algo compartido en vez de un archivo que va de un móvil a otro. En vinklo podéis invitar a la otra persona a vuestra boda y los dos veis la misma lista y las mismas respuestas.",
  },
  {
    q: "¿Dónde apuntamos los regalos que nos hacen?",
    a: "En la misma lista, al lado de cada invitado, para que no se os quede nadie sin su agradecimiento. vinklo no cobra ni gestiona dinero: los regalos los apuntáis vosotros a mano y os ayuda a llevar a quién falta por dar las gracias.",
  },
];

export default function GuiaListaInvitados() {
  return (
    <GuiaShell slug="lista-de-invitados-boda" faq={FAQ}>
      <p>
        Para hacer la lista de invitados de la boda, escribid primero todos los
        nombres que se os ocurran, sin filtrar. Después agrupadlos por círculos
        (la familia de cada uno, amigos, trabajo) y recortad según el sitio y
        lo que queráis gastar. De cada invitado apuntad el teléfono, cuántos
        acompañantes puede traer y, cuando llegue, su respuesta.
      </p>
      <p>
        Y no la deis por terminada al mandar las invitaciones: ahí vais a ver
        quién ha confirmado, dónde se sienta cada uno y a quién dar las gracias.
      </p>

      <h2>¿Por dónde empezamos?</h2>
      <ol>
        <li>
          <strong>Cada uno hace su lista por separado.</strong> Todos los
          nombres, sin pensar todavía en cuántos caben.
        </li>
        <li>
          <strong>Juntadlas y separad por círculos:</strong> familia de uno,
          familia del otro, amigos de los dos, amigos de cada uno, trabajo y
          compromisos. Los compromisos suelen venir de la lista de vuestros
          padres, y conviene hablarlo pronto.
        </li>
        <li>
          <strong>Preguntad cuánta gente cabe en el sitio</strong> y decidid
          cuántos queréis invitar de verdad. No es lo mismo.
        </li>
        <li>
          <strong>Recortad por círculos completos</strong>, no persona a
          persona. Si cortáis a la mitad de un grupo, la otra mitad se entera.
        </li>
        <li>
          <strong>Agrupad por invitación.</strong> Una familia o una pareja
          reciben una sola invitación y contestan juntas.
        </li>
      </ol>

      <h2>¿Qué datos apuntamos de cada invitado?</h2>
      <p>
        Lo que no puede faltar es el nombre, el teléfono (para mandar la
        invitación por WhatsApp), cuántos acompañantes puede traer y su
        respuesta. El resto depende de vuestra boda:
      </p>
      <ul>
        <li>Con qué grupo o familia viene.</li>
        <li>
          De quién es invitado (de uno, del otro o de los dos) y etiquetas como
          «universidad» o «pádel».
        </li>
        <li>Si vienen niños y cuántos.</li>
        <li>Alergias o menú especial.</li>
        <li>Si coge el autobús o necesita alojamiento.</li>
        <li>Si ya le habéis enviado la invitación.</li>
        <li>El regalo y si ya le habéis dado las gracias.</li>
      </ul>

      <h2>¿Para qué sirven los grupos y las etiquetas?</h2>
      <p>
        Para no ir fila por fila cuando tenéis ciento y pico nombres. Un grupo
        junta a quienes van juntos: la familia de Elena, Marcos y su pareja.
        Las etiquetas dicen de qué os conocen, y una persona puede tener
        varias.
      </p>
      <p>
        Con esto podéis mandar las invitaciones por tandas, recordar solo a un
        círculo y, más adelante, sentar juntos a los que se conocen. Lo
        contamos en{" "}
        <Link href="/guias/como-organizar-las-mesas-de-la-boda">
          cómo organizar las mesas de la boda
        </Link>
        .
      </p>

      <GuiaFigure
        img={GUIA_IMG.listaInvitados}
        caption="La lista en vinklo: arriba, a quién le falta la invitación y a quién toca recordar; debajo, filtros por estado, grupo, etiqueta y lado."
      />

      <h2>¿Hoja de cálculo o una herramienta?</h2>
      <p>
        Para la primera lista, una hoja de cálculo va bien. El problema llega
        con las respuestas: hay que copiarlas a mano, y editando los dos
        acabáis con «lista_boda_v3» y «lista_boda_v3_buena». Una lista conectada a la
        invitación guarda cada respuesta en cuanto el invitado la envía y os
        dice quién falta sin copiar nada.
      </p>

      <h2>¿Cómo sabemos quién falta por responder?</h2>
      <p>
        Dando a cada invitado un estado (pendiente, viene o no viene) y
        filtrando por él. Los pendientes que ya recibieron la invitación son
        los únicos a los que hay que volver a escribir. Cómo hacerlo sin
        agobiar a nadie, en{" "}
        <Link href="/guias/confirmar-asistencia-boda-whatsapp">
          cómo confirmar asistencia por WhatsApp
        </Link>
        .
      </p>

      <h2>¿Cómo se lleva en vinklo?</h2>
      <p>
        Añadís a vuestros invitados, los agrupáis por familias y les ponéis
        etiquetas y lado. Cada uno tiene su enlace personal y un máximo de
        acompañantes. Cuando alguien responde, su estado cambia solo y veis sus
        acompañantes, sus alergias y lo que haya contestado sobre autobús,
        hotel, menú, niños o canción.
      </p>
      <p>
        Los regalos los apuntáis vosotros y vinklo os prepara el mensaje de
        agradecimiento para WhatsApp. Es gratis y los invitados no necesitan
        cuenta. Probadlo en <Link href="/crear">el creador</Link> o echad un
        ojo a las{" "}
        <Link href="/preguntas">preguntas frecuentes</Link>.
      </p>
    </GuiaShell>
  );
}
