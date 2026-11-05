import type { Metadata } from "next";
import Link from "next/link";

import { GuiaFigure, GUIA_IMG } from "@/components/guias/guia-figure";
import { GuiaShell, type GuiaFaq } from "@/components/guias/guia-shell";
import { guiaMetadata } from "@/components/guias/guias";

export const metadata: Metadata = guiaMetadata(
  "confirmar-asistencia-boda-whatsapp"
);

const FAQ: GuiaFaq[] = [
  {
    q: "¿Qué significa RSVP en una invitación de boda?",
    a: "Son las siglas del francés «répondez s’il vous plaît», es decir, «responda, por favor». En una invitación de boda le pide al invitado que confirme si va a ir, normalmente antes de una fecha concreta.",
  },
  {
    q: "¿Se puede saber si un invitado ha leído el WhatsApp?",
    a: "No. El mensaje sale de vuestro teléfono y ninguna web de invitaciones puede ver si ha llegado o si lo han leído. Lo que sí queda registrado es si el invitado ha abierto su enlace y si ha respondido desde él.",
  },
  {
    q: "¿Y si un invitado cambia de opinión después de confirmar?",
    a: "Que vuelva a abrir su enlace y cambie la respuesta. En vinklo, al reabrirlo ve lo que contestó la última vez, corrige solo lo que cambia y vuestro recuento se actualiza.",
  },
  {
    q: "¿Cuántos recordatorios se mandan?",
    a: "Uno amable a quien siga pendiente, unos días antes de la fecha límite, suele bastar. Si hace falta un segundo, dejad pasar unos días y escribid solo a quien sigue sin contestar.",
  },
];

export default function GuiaConfirmarAsistencia() {
  return (
    <GuiaShell slug="confirmar-asistencia-boda-whatsapp" faq={FAQ}>
      <p>
        Para confirmar asistencia a la boda por WhatsApp sin perder la cuenta,
        mandad a cada invitado un mensaje corto con su propio enlace y una
        fecha límite que se entienda. Pedidle que conteste desde el enlace, no
        en el chat. Y cuando llegue el momento, recordádselo solo a quien no
        haya respondido.
      </p>
      <p>
        Así cada respuesta se apunta sola con su nombre y nadie pasa mensajes a
        un Excel a la una de la mañana.
      </p>

      <h2>¿Por qué no basta con que respondan en el chat?</h2>
      <p>
        Porque en el chat la gente responde como habla. «Ahí estaremos» no dice
        cuántos sois. «Te digo algo la semana que viene» no vuelve nunca. Vuestra
        tía os manda un audio de dos minutos en el que la respuesta está al
        final, entre el tiempo que hace en el pueblo y lo guapa que va a ir.
        Y el primo que dice «sí, sí» en el grupo de la familia desaparece bajo
        cien fotos del bautizo de su sobrino.
      </p>
      <p>
        Y luego alguien tiene que pasarlo todo a una lista. Con un formulario
        que ya lleva el nombre puesto, eso desaparece.
      </p>

      <h2>¿Cómo se organiza el envío, paso a paso?</h2>
      <ol>
        <li>
          <strong>Tened la lista hecha.</strong> Nombre, teléfono y cuántos
          acompañantes puede traer cada uno. Si todavía no la tenéis, empezad
          por{" "}
          <Link href="/guias/lista-de-invitados-boda">
            la lista de invitados
          </Link>
          .
        </li>
        <li>
          <strong>Poned la fecha límite</strong> contando hacia atrás desde el
          día en que el catering os pide el número definitivo. Dejad una semana
          de margen para los despistados, que los habrá.
        </li>
        <li>
          <strong>Escribid un mensaje corto</strong> con el nombre de la persona
          y el enlace al final.
        </li>
        <li>
          <strong>Enviad por tandas.</strong> Un día la familia, otro los amigos.
          Con ciento veinte mensajes en una noche, alguno se queda sin enviar.
        </li>
        <li>
          <strong>Apuntad a quién se lo habéis mandado.</strong> Parece obvio
          hasta que dudáis si a vuestro tío se lo enviasteis o solo lo pensasteis.
        </li>
        <li>
          <strong>Recordad solo a quien falta</strong>, unos días antes de que
          venza el plazo.
        </li>
      </ol>

      <GuiaFigure
        img={GUIA_IMG.enviarInvitaciones}
        caption="Enviar las invitaciones en vinklo: se abre vuestro WhatsApp con el mensaje y el enlace de cada persona, una detrás de otra."
      />

      <h2>¿Qué mensaje enviamos?</h2>
      <p>
        Uno breve, con el nombre y el enlace al final. Los textos largos se leen
        en diagonal y el enlace se pierde. Podéis adaptar estos:
      </p>
      <ul>
        <li>
          «¡Hola, Marta! Nos casamos el 12 de junio y nos haría mucha ilusión
          que vinieras. Aquí tienes la invitación y puedes confirmar desde el
          mismo enlace: [enlace]»
        </li>
        <li>
          «Familia, ya tenemos fecha. Está todo aquí; decidnos si venís antes
          del 15 de mayo: [enlace]»
        </li>
      </ul>
      <p>
        Y para el recordatorio, sin dramas: «¡Hola! Estamos cerrando números
        para la boda, ¿nos dices si vienes? Te dejo el enlace otra vez:
        [enlace]».
      </p>

      <h2>¿Qué preguntamos al confirmar?</h2>
      <p>
        Lo que vayáis a usar. Casi siempre: si viene, con cuántos acompañantes
        y si tiene alguna alergia. Según vuestra boda, también si coge el
        autobús, si necesita hotel, qué menú prefiere, si vienen niños o qué
        canción quiere oír en la fiesta. Cada pregunta que sobra es una excusa
        para dejar el formulario a medias y «ya lo termino luego».
      </p>

      <h2>¿Cómo sabemos quién falta por responder?</h2>
      <p>
        Separando dos cosas que solemos mezclar: si le habéis enviado la
        invitación y si ha contestado (pendiente, viene o no viene). Los que la
        recibieron y siguen pendientes son los únicos a los que hay que volver
        a escribir. Así no le recordáis nada a quien ni siquiera la tiene, que
        queda fatal.
      </p>

      <GuiaFigure
        img={GUIA_IMG.recordatorio}
        caption="El recordatorio sale ya escrito y solo para quien recibió la invitación y no ha respondido. Podéis cambiar el texto antes de enviarlo."
      />

      <h2>¿Cómo funciona en vinklo?</h2>
      <p>
        Cada invitado tiene su enlace personal. Desde vuestra lista enviáis en
        serie: vinklo os abre WhatsApp con el mensaje ya escrito para cada
        persona, una detrás de otra, y podéis filtrar por etiqueta o por lado
        (si es invitado de uno, del otro o de los dos). El mensaje lo mandáis
        vosotros desde vuestro móvil y lo marcáis como enviado.
      </p>
      <p>
        El invitado abre su enlace, ve la web y responde sin crearse ninguna
        cuenta. Si vuelve más tarde, ve lo que contestó y puede cambiarlo. Los
        recordatorios salen ya escritos solo para quien recibió la invitación y
        no ha respondido, y nadie recibe dos en menos de tres días. Los días
        que haya respuestas nuevas os llega un correo con el resumen. Podéis
        verlo en <Link href="/demo">la boda de ejemplo</Link> o empezar en{" "}
        <Link href="/crear">el creador</Link>.
      </p>
    </GuiaShell>
  );
}
