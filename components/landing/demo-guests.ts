/**
 * Invitados de ejemplo de la landing: una sola fuente para la tarjeta
 * «Invitados y respuestas» y la lista animada del recorrido, para que las
 * cifras cuadren en toda la página (14 confirmados de 16 invitados). Los
 * nombres que se ven salen de copy/ (por idioma), en este mismo orden.
 */
export const DEMO_GUESTS = [
  { name: "Familia de Elena", invited: 6, confirmed: 5 },
  { name: "Marta y su acompañante", invited: 2, confirmed: 2 },
  { name: "Tíos de Juan", invited: 4, confirmed: 4 },
  { name: "Jorge Lee", invited: 1, confirmed: 0 },
  { name: "Amigos de la uni", invited: 3, confirmed: 3 },
] as const;

export const DEMO_INVITED = DEMO_GUESTS.reduce((sum, g) => sum + g.invited, 0);
export const DEMO_CONFIRMED = DEMO_GUESTS.reduce((sum, g) => sum + g.confirmed, 0);
