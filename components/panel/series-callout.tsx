import Link from "next/link";
import { AnimatedNumber } from "@/components/panel/animated-number";

/**
 * Aviso «N sin enviar · Enviar» con la entrada al envío en serie
 * (/panel/invitados/enviar, plan maestro §4.1). Server-safe. Una línea bajo
 * el título (revisión Jobs #11): la lista, que es el producto, sube. Solo se
 * pinta si queda alguien sin enviar. El recuento es el del chip «Sin enviar»
 * y se anima al cambiar, como el del chip.
 */
export function SeriesCallout({ count, href }: { count: number; href: string }) {
  if (count <= 0) return null;
  return (
    <p className="pn-aviso">
      <AnimatedNumber value={count} /> sin enviar ·{" "}
      <Link href={href} className="pn-aviso-go pn-press">Enviar</Link>
    </p>
  );
}
