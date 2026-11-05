/**
 * Lacre con las iniciales (SVG): lo comparten la apertura «sobre» de la web
 * de cada pareja (sealed-envelope.tsx, con la paleta de la boda) y el sobre
 * de la landing (arcilla de la marca). Los colores
 * salen de variables CSS con la arcilla como valor por defecto:
 *   --wax (color base), --wax-light (brillo), --wax-dark (sombra), --wax-ink
 *   (letras).
 * Decorativo: aria-hidden; las iniciales legibles van fuera.
 */
import "./wax-seal.css";

const OUTLINE =
  "M97.7 50.0 L98.8 54.3 L96.3 58.2 L95.6 62.2 L94.9 66.4 L92.0 69.9 L89.9 73.7 L86.6 76.5 L84.0 79.9 L80.5 82.3 L77.5 85.3 L73.6 86.9 L70.1 89.3 L66.0 90.1 L62.3 91.9 L58.1 91.8 L54.1 92.9 L50.0 92.0 L45.9 92.9 L41.9 91.8 L37.7 91.9 L34.0 90.1 L29.9 89.3 L26.4 86.9 L22.5 85.3 L19.5 82.3 L16.0 79.9 L13.4 76.5 L10.1 73.7 L8.0 69.9 L5.1 66.4 L4.4 62.2 L3.7 58.2 L1.2 54.3 L2.3 50.0 L1.2 45.7 L3.7 41.8 L4.4 37.8 L5.1 33.6 L8.0 30.1 L10.1 26.3 L13.4 23.5 L16.0 20.1 L19.5 17.7 L22.5 14.7 L26.4 13.1 L29.9 10.7 L34.0 9.9 L37.7 8.1 L41.9 8.2 L45.9 7.1 L50.0 8.0 L54.1 7.1 L58.1 8.2 L62.3 8.1 L66.0 9.9 L70.1 10.7 L73.6 13.1 L77.5 14.7 L80.5 17.7 L84.0 20.1 L86.6 23.5 L89.9 26.3 L92.0 30.1 L94.9 33.6 L95.6 37.8 L96.3 41.8 L98.8 45.7 Z";

export function WaxSeal({ initials, className, id }: { initials: [string, string]; className?: string; id: string }) {
  return (
    <svg className={`wax ${className ?? ""}`.trim()} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-wax`} cx="38%" cy="32%" r="75%">
          <stop offset="0" className="wax-stop-light" />
          <stop offset=".45" className="wax-stop-base" />
          <stop offset="1" className="wax-stop-dark" />
        </radialGradient>
        <radialGradient id={`${id}-well`} cx="50%" cy="45%" r="60%">
          <stop offset="0" className="wax-stop-well" />
          <stop offset="1" className="wax-stop-dark" />
        </radialGradient>
      </defs>
      <path d={OUTLINE} fill={`url(#${id}-wax)`} />
      <circle cx="50" cy="50" r="31" fill={`url(#${id}-well)`} className="wax-rim" strokeWidth="2.4" />
      <circle cx="50" cy="50" r="27.5" fill="none" className="wax-ring" strokeWidth=".9" />
      <text x="50" y="57" textAnchor="middle" className="wax-initials">
        {initials[0]}
        {initials[1] ? <tspan className="wax-amp">&amp;</tspan> : null}
        {initials[1]}
      </text>
      <ellipse cx="36" cy="28" rx="13" ry="6" fill="#fff" opacity=".16" transform="rotate(-24 36 28)" />
    </svg>
  );
}
