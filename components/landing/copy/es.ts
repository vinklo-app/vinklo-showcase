import { FAQS } from "@/components/landing/faqs";

/**
 * Textos de la landing en español (1-nov-2026, versión en inglés en /en).
 * Son exactamente los de siempre: este archivo los reúne para que la página
 * en inglés (./en.ts) tenga la misma estructura. Una frase con cursiva va
 * partida en `pre` / `em` / `post`.
 */
export const es = {
  lang: "es",
  home: "/",
  skip: "Saltar al contenido",
  nav: {
    label: "Principal",
    homeLabel: "vinklo, inicio",
    templates: "Plantillas",
    faq: "Preguntas",
    login: "Entrar",
    createShort: "Crear",
    create: "Crear nuestra web",
    language: { href: "/en", lang: "en", text: "EN", label: "English version" },
  },
  hero: {
    title: { pre: "Vuestra web de boda. Todos los detalles, ", em: "bajo control." },
    lead: "Cread vuestra invitación, compartidla por WhatsApp y organizad respuestas, acompañantes y mesas desde vuestro panel.",
    demo: "Ver una boda de ejemplo",
    note: null as string | null,
  },
  know: {
    intro: "Sabréis",
    items: [
      { text: "quién viene y quién no", sep: "," },
      { text: "quién es alérgico", sep: "," },
      { text: "quién va en autobús", sep: "," },
      { text: "dónde se sienta cada uno", sep: " y" },
      { text: "quién os ha hecho un regalo", sep: "." },
    ],
  },
  mark: [
    { lead: "Vuestra web", rest: "con un estilo único y todo en un único lugar." },
    { lead: "Vuestros invitados", rest: "simplificad el seguimiento y centraos en lo importante, hacer vuestro día especial." },
    { lead: "Vuestro gran día", rest: "toda la información relevante: disposición de las mesas, lugar, autobuses, alergias, música…" },
  ],
  flight: {
    label: "Cómo funciona vinklo",
    steps: [
      { kicker: "01 · Contad cómo es vuestra boda", title: "Un sobre que se abre", body: "Al abrir vuestro enlace, cada invitado ve un sobre lacrado con vuestras iniciales y lo abre con un toque en su móvil." },
      { kicker: "02 · Hacedla vuestra", title: "Vuestra foto, vuestros colores", body: "Tres estilos y ocho paletas. Elegís una paleta y la invitación cambia entera, al momento." },
      { kicker: "03 · Enviadla y seguid cada respuesta", title: "Las respuestas llegan solas", body: "Cada invitado confirma desde su enlace. Vosotros veis quién la ha abierto, quién viene y a quién recordárselo." },
    ],
    listKicker: "Vuestros invitados",
    ofConfirmed: (total: number) => `de ${total} confirmados`,
    invited: (n: number) => `${n} ${n === 1 ? "invitado" : "invitados"}`,
  },
  guests: {
    names: ["Familia de Elena", "Marta y su acompañante", "Tíos de Juan", "Jorge Lee", "Amigos de la uni"],
    confirmed: (n: number) => (n === 1 ? "1 confirmado" : `${n} confirmados`),
    sent: "Enviada",
    opened: "Abierta",
  },
  switcher: {
    label: "Hacedla vuestra",
    off: { pre: "Si organizar una boda fuera tan fácil como ", em: "pulsar un interruptor.", post: "" },
    on: { pre: "Con vinklo, ", em: "es así de fácil.", post: " Invitación, invitados y respuestas en un mismo sitio." },
    offSub: "La lista de invitados, los mensajes, las respuestas, las mesas… todo se suma muy rápido.",
    onSub: "Empezad en un minuto, sin registraros. Las respuestas llegan solas.",
  },
  styles: {
    kicker: "Plantillas",
    title: { pre: "Webs de boda ", em: "que se recuerdan." },
    sub: "Y detrás, un panel propio conectado a vuestra lista de invitados y a todo lo demás: el estado de cada invitado en un solo lugar. Olvidaos del Excel.",
    ideaLabel: "O contadnos vuestra boda en una frase y os la preparamos:",
    ideaPlaceholder: "Una cena bajo los olivos…",
    ideaSubmit: "Preparar",
  },
  templates: {
    label: "Plantillas de web de boda",
    kicker: "Web de boda",
    /** Sin entrada: se usan los textos de demo-wedding.ts (los de siempre). */
    byId: {} as Record<string, { styleLabel: string; description: string; alt: string }>,
  },
  statement: {
    label: "Vuestra boda vive en los detalles",
    a: "Vuestra boda vive",
    aEm: "en los detalles.",
    b: "vinklo los reúne en un lugar que ya",
    bEm: "se siente",
    cEm: "vuestro.",
  },
  bento: {
    kicker: "Para toda la celebración",
    title: { pre: "Todo lo que vuestra boda necesita, ", em: "bien conectado." },
    sub: "Desde la primera idea hasta la última respuesta: la invitación y la gestión de vuestros invitados son la misma cosa.",
    guests: {
      title: "Invitados y respuestas, juntos",
      body: "Grupos, acompañantes, alergias y quién viene, en una sola lista que se rellena sola con cada respuesta.",
      confirmed: "confirmados",
      of: (n: number) => `de ${n} invitados`,
    },
    whatsapp: {
      title: "WhatsApp, en un solo mensaje",
      body: "Un mensaje cuidado con su nombre y su enlace personal dentro. Lo retocáis a vuestro gusto, abrís WhatsApp con el texto ya escrito y lo enviáis vosotros.",
      edit: "Editable",
      message: "¡Hola, Marta! Nos casamos y nos haría mucha ilusión que vinieras. Será el sábado 12 de junio de 2027. En tu invitación tienes el lugar, los horarios y todo lo demás, y puedes confirmar en un momento: ",
      signature: "Un abrazo, Lucía y Juan",
    },
    day: {
      title: "Todo el día, en orden",
      body: "El programa, el lugar con el botón “Cómo llegar” y la fecha, lista para guardarla en el calendario de cada invitado.",
      town: "Cercedilla, Madrid",
      go: "Cómo llegar",
      agenda: [
        ["11:45", "Autobuses de ida"],
        ["13:00", "Ceremonia"],
        ["14:15", "Cóctel en el jardín"],
        ["16:00", "Banquete"],
        ["19:30", "Baile"],
        ["01:00", "Autobuses de vuelta"],
      ] as ReadonlyArray<readonly [string, string]>,
      calendar: "Añadido al calendario · sáb 12 jun",
    },
    envelope: {
      title: "Un sobre que se abre",
      body: "Al abrir vuestro enlace, cada invitado ve un sobre lacrado con vuestras iniciales y lo abre con un toque.",
    },
    remind: {
      title: "Recordad sin perseguir",
      body: "Quién la abrió y no contesta, con el recordatorio escrito y por grupos.",
      rows: ["La ha abierto y no contesta", "Persona para recordar"],
    },
    tables: {
      title: "Mesas, sin hojas de cálculo",
      body: "Sentad a cada grupo, ved la ocupación y exportad el plan para el catering.",
    },
  },
  gifts: {
    kicker: "Una cosa más",
    soon: "Próximamente",
    title: { pre: "Que los regalos paguen vuestra boda. ", em: "No el banco." },
    subs: [
      "Vuestros invitados os harán su regalo desde vinklo, en lugar de por transferencia, y vosotros pagaréis a vuestros proveedores directamente con ese dinero. Sin préstamos y sin pedir dinero a vuestros padres.",
      "Ellos podrán pagarlo en hasta 3 meses. Vosotros lo recibís entero al momento.",
    ],
  },
  notify: {
    email: "Vuestro email",
    sending: "Enviando…",
    submit: "Avisadme cuando esté",
    consentPre: "Quiero que me aviséis por email cuando estén los regalos. He leído la ",
    privacy: "política de privacidad",
    consentPost: ".",
    needConsent: "Necesitamos vuestro permiso para avisaros por email.",
    offline: "No se ha podido conectar. Comprobad vuestra conexión y volved a intentarlo.",
    done: "Hecho. Os avisaremos en cuanto esté listo.",
    /** Con null se enseña el mensaje del servidor (en español). */
    serverError: null as string | null,
  },
  faq: {
    title: { pre: "Preguntas, ", em: "respondidas." },
    askPre: "¿Os queda alguna? Escribidnos a ",
    askPost: ".",
    items: FAQS as ReadonlyArray<{ q: string; a: string }>,
  },
  finale: {
    line: "Cada invitado, cada detalle y cada momento, conectados con cariño. De la primera idea a la última respuesta.",
    linksLabel: "Enlaces",
    links: [
      [{ href: "/#estilos", label: "Plantillas" }, { href: "/guias", label: "Guías" }, { href: "/invitados-desde-excel", label: "Del Excel a WhatsApp" }, { href: "/preguntas", label: "Preguntas" }, { href: "/login", label: "Entrar" }],
      [{ href: "/privacidad", label: "Privacidad" }, { href: "/terminos", label: "Términos" }, { href: "/aviso-legal", label: "Aviso legal" }],
    ] as ReadonlyArray<ReadonlyArray<{ href: string; label: string }>>,
    made: "Hecho con calma, en España",
    note: null as string | null,
  },
};

export type LandingCopy = typeof es;
