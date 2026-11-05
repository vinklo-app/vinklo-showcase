import Image from "next/image";

/**
 * Capturas del producto dentro de las guías (public/guias/). Datos de la
 * boda de ejemplo (Lucía y Juan), nunca de parejas reales. Medidas
 * intrínsecas reales para que next/image reserve el hueco sin saltos.
 * `phone`: la captura de móvil se pinta a tamaño de teléfono, no a lo
 * ancho de la columna.
 */
export const GUIA_IMG = {
  listaInvitados: {
    src: "/guias/panel-lista-invitados.webp",
    width: 1600,
    height: 1071,
    alt: "Lista de invitados de la boda en vinklo: avisos de quién no tiene aún su invitación y a quién recordar, y filtros por estado, grupo, etiqueta y lado",
  },
  resumenRespuestas: {
    src: "/guias/panel-resumen-respuestas.webp",
    width: 1600,
    height: 1177,
    alt: "Resumen de la boda de Lucía y Juan en vinklo: cuántos invitados están añadidos, con la invitación enviada, abierta y respondida",
  },
  enviarInvitaciones: {
    src: "/guias/panel-enviar-invitaciones-whatsapp.webp",
    width: 1600,
    height: 1021,
    alt: "Pantalla de envío de invitaciones por WhatsApp en vinklo, de una en una, con filtros por grupo, etiqueta y lado",
  },
  recordatorio: {
    src: "/guias/panel-recordatorio-quien-no-responde.webp",
    width: 1600,
    height: 1048,
    alt: "Recordatorio por WhatsApp ya escrito para un invitado que recibió la invitación y no ha respondido",
  },
  mesas: {
    src: "/guias/panel-mesas-sentar-automaticamente.webp",
    width: 1600,
    height: 926,
    alt: "Pantalla de mesas de la boda en vinklo con los botones Sentar automáticamente, Plano del salón y Exportar CSV",
  },
  invitacionMovil: {
    src: "/guias/invitacion-movil-sobre.webp",
    width: 780,
    height: 1545,
    alt: "Invitación de boda digital abierta en el móvil: un sobre cerrado con sello de lacre y los nombres Lucía y Juan",
  },
} as const;

type GuiaImg = (typeof GUIA_IMG)[keyof typeof GUIA_IMG];

export function GuiaFigure({
  img,
  caption,
  phone = false,
  priority = false,
}: {
  img: GuiaImg;
  caption: string;
  phone?: boolean;
  priority?: boolean;
}) {
  return (
    <figure className={phone ? "rd-figure rd-figure--phone" : "rd-figure"}>
      <Image
        src={img.src}
        width={img.width}
        height={img.height}
        alt={img.alt}
        sizes={phone ? "(max-width: 400px) 70vw, 17.5rem" : "(max-width: 1024px) 100vw, 68ch"}
        priority={priority}
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
