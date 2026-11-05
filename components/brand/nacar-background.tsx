/**
 * Fondo nacarado de la web pública (9-oct-2026): ondas ciruela y una cinta
 * iridiscente suave sobre perla, fijo detrás de toda la página. Solo
 * decorativo (aria-hidden, sin eventos); los estilos están en globals.css
 * (.vk-nacar) y con reduced-motion se queda quieto. No va en el panel ni en
 * las invitaciones de las parejas.
 */
export function NacarBackground() {
  return <div className="vk-nacar" aria-hidden="true" />;
}
