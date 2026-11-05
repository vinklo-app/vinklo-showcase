import Link from "next/link";
import { AnimatedNumber } from "@/components/panel/animated-number";

/**
 * Aviso «N para recordar · Recordar» con la entrada a la fila (server-safe).
 * Una línea bajo el título (revisión Jobs #11). Solo se pinta si hay alguien
 * en la fila. El recuento es el de la fila de recordatorios
 * (`getReminderCandidates`: plazo, margen de 3 días y aperturas). La cifra se anima al cambiar, como las de los chips.
 */
export function ReminderCallout({ count, href }: { count: number; href: string }) {
  if (count <= 0) return null;
  return (
    <p className="pn-aviso">
      <AnimatedNumber value={count} /> para recordar ·{" "}
      <Link href={href} className="pn-aviso-go pn-press">Recordar</Link>
    </p>
  );
}
