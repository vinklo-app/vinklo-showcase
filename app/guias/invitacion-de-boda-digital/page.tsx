import type { Metadata } from "next";
import Link from "next/link";

import { GuiaFigure, GUIA_IMG } from "@/components/guias/guia-figure";
import { GuiaShell, type GuiaFaq } from "@/components/guias/guia-shell";
import { guiaMetadata } from "@/components/guias/guias";

export const metadata: Metadata = guiaMetadata("invitacion-de-boda-digital");

const FAQ: GuiaFaq[] = [
  {
    q: "¿Es lo mismo una web de boda que una invitación digital?",
    a: "Para vuestros invitados, sí. La invitación es lo primero que ven al abrir el enlace (vuestros nombres, la fecha y el botón para confirmar) y la web es todo lo que hay debajo: horarios, sitios, autobús, hoteles. Lo práctico es que sean la misma página y vaya en un solo enlace.",
  },
  {
    q: "¿Cuánto se tarda en hacer la web de la boda?",
    a: "Lo básico (nombres, fecha, sitios y fecha para confirmar) se rellena de una sentada. Lo que todavía no tengáis cerrado, como el horario del autobús o los hoteles, se añade después y quien abra el enlace ya lo verá, sin reenviar nada.",
  },
  {
    q: "¿Pueden ver la web personas que no están invitadas?",
    a: "Si cada invitado recibe su propio enlace y la web no sale en Google, es difícil que llegue a alguien de fuera. En vinklo las webs de boda van marcadas para que los buscadores no las muestren, así que no aparecen al buscar vuestros nombres.",
  },
  {
    q: "¿Cuánto cuesta hacer la web de la boda con vinklo?",
    a: "Hoy, crear la web y llevar a vuestros invitados con vinklo es gratis. Podéis probar el creador sin registraros y entrar con vuestro email cuando queráis publicarla.",
  },
];

export default function GuiaWebDeBoda() {
  return (
    <GuiaShell slug="invitacion-de-boda-digital" faq={FAQ}>
      <p>
        Para hacer la web de vuestra boda os basta con cuatro datos para
        empezar: vuestros nombres, la fecha, los sitios y hasta cuándo se puede
        confirmar. Con eso ya tenéis una invitación digital que se puede enviar.
        Después se le añade lo que la gente os va a preguntar de todas formas
        (a qué hora sale el autobús, dónde dormir, si pueden ir los niños) y se
        manda por WhatsApp, con un enlace distinto para cada invitado.
      </p>
      <p>
        La web hace de invitación y de formulario a la vez: cada respuesta
        queda guardada con su nombre, en vez de perdida en el chat.
      </p>

      <h2>¿Qué es una web de boda o invitación digital?</h2>
      <p>
        Una página de vuestra boda que se abre en el móvil desde un enlace. A
        diferencia de una imagen o un PDF, si el restaurante os mueve la cena
        media hora, lo cambiáis una vez y todo el mundo ve la hora buena. Y
        lleva el formulario para confirmar: si viene, con cuántas personas y
        alergias.
      </p>

      <GuiaFigure
        img={GUIA_IMG.invitacionMovil}
        phone
        caption="Así la abre el invitado: un sobre con vuestros nombres. Al tocar el sello aparece la invitación (boda de ejemplo)."
      />

      <h2>¿Qué apartados conviene poner?</h2>
      <p>
        Lo que os van a preguntar la semana de la boda. Si no está en la web,
        os lo preguntarán por WhatsApp, treinta veces.
      </p>
      <ul>
        <li>
          <strong>Portada.</strong> Nombres, fecha y una frase de bienvenida.
        </li>
        <li>
          <strong>Vuestra historia.</strong> Opcional: unas líneas y alguna
          foto.
        </li>
        <li>
          <strong>Sitios.</strong> Ceremonia y celebración, con dirección y cómo
          llegar. Si la finca está a 40 minutos por una carretera comarcal,
          decidlo.
        </li>
        <li>
          <strong>Programa del día.</strong> Ceremonia, cóctel, banquete y
          fiesta, con horas aproximadas.
        </li>
        <li>
          <strong>Autobuses y alojamiento.</strong> Paradas, horarios y hoteles
          cerca, sobre todo si viene gente de fuera.
        </li>
        <li>
          <strong>Confirmación.</strong> Sí o no, acompañantes, alergias y lo
          que necesitéis: menú, niños, autobús o la canción que no puede faltar.
        </li>
        <li>
          <strong>Preguntas frecuentes.</strong> Vestimenta, aparcamiento, si
          hay sitio para los peques.
        </li>
        <li>
          <strong>Galería.</strong> Para quien quiera ver fotos vuestras.
        </li>
      </ul>
      <p>
        Qué escribir en cada uno, con ejemplos que podéis copiar, lo tenéis en{" "}
        <Link href="/guias/que-poner-en-una-invitacion-de-boda">
          qué poner en la invitación de boda
        </Link>
        .
      </p>

      <h2>¿Cómo se hace, paso a paso?</h2>
      <ol>
        <li>
          <strong>Juntad los datos fijos.</strong> Fecha, sitios con dirección
          y el día en que el catering os pide el número cerrado, que marca
          vuestra fecha límite.
        </li>
        <li>
          <strong>Elegid el formato.</strong> Pantallas que se pasan como una
          Story de Instagram o una página larga que se baja con el dedo.
          Cuestión de gusto.
        </li>
        <li>
          <strong>Escribid como habláis.</strong> Tres líneas que suenen a
          vosotros valen más que un párrafo de tarjeta de imprenta.
        </li>
        <li>
          <strong>Añadid solo lo que esté cerrado.</strong> El horario del
          autobús, cuando lo tengáis.
        </li>
        <li>
          <strong>Preguntad al confirmar solo lo que vayáis a usar.</strong>
          Acompañantes y alergias casi siempre; lo demás, según vuestra boda.
        </li>
        <li>
          <strong>Abridla en el móvil antes de mandarla.</strong> Es donde la va
          a ver casi todo el mundo.
        </li>
        <li>
          <strong>Enviad un enlace a cada invitado</strong> y seguid las
          respuestas desde vuestra lista.
        </li>
      </ol>

      <h2>¿Cómo se comparte por WhatsApp?</h2>
      <p>
        Dentro de un mensaje personal, con el enlace al final. Si cada persona
        tiene su propio enlace, la respuesta llega con su nombre y no hay que
        adivinar quién es «Mari» ni cuántos son «los de Toledo». El mensaje
        sale de vuestro WhatsApp, así que ninguna web puede saber si lo han
        leído; sí si han abierto su enlace y si han contestado. Cómo montar todo
        el envío lo contamos en{" "}
        <Link href="/guias/confirmar-asistencia-boda-whatsapp">
          cómo confirmar asistencia por WhatsApp
        </Link>
        .
      </p>

      <h2>¿Y los invitados que no usan el móvil?</h2>
      <p>
        Siempre hay alguno, como el abuelo que tiene el móvil para llamar y
        poco más. Para ellos, invitación impresa o una llamada. Eso sí, su
        respuesta tiene que acabar en la misma lista que las demás, o tendréis
        dos cuentas que no cuadran. Comparamos los dos formatos en{" "}
        <Link href="/guias/invitacion-de-boda-digital-o-papel">
          invitación digital o de papel
        </Link>
        .
      </p>

      <h2>¿Cómo se hace con vinklo?</h2>
      <p>
        En <Link href="/crear">el creador de vinklo</Link> vais contestando
        preguntas cortas sobre vuestra boda y la web se va montando mientras
        respondéis. Si os atascáis con el texto, la IA os propone un borrador
        que luego cambiáis. Podéis elegir entre «Como una
        Story» y «Como una web», y que la invitación se abra como un sobre
        cerrado.
      </p>
      <p>
        Fotos, galería, programa, autobuses, hoteles, menú, niños, canción y
        preguntas frecuentes se añaden cuando queráis. Al publicarla, cada
        invitado tiene su enlace y confirma sin crearse ninguna cuenta. Para
        haceros una idea, mirad{" "}
        <Link href="/demo">la boda de ejemplo</Link>; y si os queda alguna duda,
        está en <Link href="/preguntas">preguntas frecuentes</Link>.
      </p>
    </GuiaShell>
  );
}
