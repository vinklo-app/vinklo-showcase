/**
 * Iconos de marca compartidos por todas las superficies (landing, creador,
 * panel, acceso, 404). 24×24, trazo 1.5, currentColor; el símbolo de
 * vinklo (`LazoIcon`) lleva el punto de la ı en el acento (ciruela en la
 * marca v9; dentro de una invitación, --clay conserva el valor v8).
 * (La landing archivada v3 se eliminó el 9-oct-2026.)
 */
import type { SVGProps } from "react";


const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ArrowUpRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" {...STROKE} {...props}>
      <path d="M7 17L17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}

export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

/** Check simple — mismo trazo 1.5 que el resto de la familia. */
export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" {...STROKE} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * El símbolo de vinklo (v8, prototipo 2026-08-09): la V inicial en un
 * trazo abierto (currentColor, normalmente tinta) con el punto de la ı
 * flotando encima en el acento (--clay = ciruela en v9) — la misma ı que
 * va en el acento en el wordmark. 24×24, trazo 2.1, puntas redondeadas.
 * El nombre `LazoIcon` se conserva para no tocar el JSX que lo consume.
 */
export function LazoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M3 5.5 12 20l9-14.5"
        stroke="currentColor"
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={12} cy={3.2} r={1.5} fill="var(--clay, #573B62)" />
    </svg>
  );
}

/**
 * Motivo de marca v9 (DESIGN.md §5): una curva amplia y asimétrica que
 * sugiere unión, con una segunda línea desplazada para dar relieve. Es
 * decorativa: aria-hidden, sin eventos de puntero, y quien la usa la recorta
 * con su contenedor y la retira en móvil. Nunca detrás de texto, tablas ni
 * formularios. Color: currentColor (por defecto, --separador).
 */
export function BrandCurve({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 800 420"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ pointerEvents: "none", color: "var(--separador)" }}
    >
      <path d="M-40 400C120 120 330 30 520 70c150 32 250 140 320 300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M-40 430C140 170 340 90 530 126c140 26 236 120 306 260" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" opacity={0.6} />
    </svg>
  );
}
