import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRightIcon, CheckIcon, FileSpreadsheetIcon, MessageCircleIcon, PencilIcon, SendHorizontalIcon, UploadIcon, XIcon } from "lucide-react";

import { NacarBackground } from "@/components/brand/nacar-background";
import { LazoIcon } from "@/components/brand/icons";
import { LandingFinale } from "@/components/landing/landing-finale";
import { LandingMotion } from "@/components/landing/landing-motion";

/**
 * /invitados-desde-excel (punto 17 del dueño, 14-oct-2026): la landing en
 * «vídeo» del camino Excel → lista → mensaje → WhatsApp → respuestas.
 *
 * Sin vídeo de verdad ni framer-motion: cada capítulo es una maqueta HTML
 * que se reproduce con keyframes CSS cuando entra en pantalla (los reveals
 * de LandingMotion), y el hero lleva un bucle corto solo de CSS. Así la
 * isla de cliente es la misma de la landing y el LCP es el h1 (texto).
 *
 * Estado final por defecto: sin JS, con reduced-motion o antes de entrar en
 * pantalla, cada maqueta ya está en su último fotograma y se lee entera.
 *
 * Datos de ejemplo inventados (teléfonos 600 000 1xx). Copy honesto:
 * WhatsApp se abre con el texto escrito y lo envían ellos; vinklo no sabe si
 * llega ni si se lee (CLAUDE.md, docs/COPY-Y-VOZ-VINKLO.md).
 */

/** Mismo texto que `readSummary` de lib/crm/guest-excel-import.ts (lo comprueba el test). */
export const EXCEL_SAMPLE = { rows: 142, guests: 98, people: 210 } as const;
export const EXCEL_SUMMARY = "Hemos leído 142 filas: 98 invitaciones y 210 personas";
/** Pie de la hoja del mensaje, literal del panel (components/panel/whatsapp-compose.tsx). */
export const COMPOSE_FOOTNOTE = "Abrir WhatsApp no lo envía ni lo marca como enviado: lo enviáis vosotros desde el chat.";

/** Script previo a la primera pintura: mismo patrón que LANDING_MOTION_BOOT (landing-lovable.tsx). */
const MOTION_BOOT = `(function(){var r=document.currentScript&&document.currentScript.parentElement;if(!r)return;var q=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;r.setAttribute("data-motion",q?"reduce":"full");setTimeout(function(){if(!r.hasAttribute("data-motion-ready"))r.removeAttribute("data-motion")},4000)})()`;

/** La hoja tal cual la tienen los novios: títulos raros, teléfonos con puntos, familias en una fila. */
const SHEET_HEAD = ["NOMBRE Y APELLIDOS", "Tlf.", "Acompañantes", "¿mesa?", "Alergias / obs.", "de quién"] as const;
const SHEET_ROWS = [
  ["Marta López Ruiz", "600 000 101", "1", "4", "", "Novia"],
  ["Familia Ortega (Pedro y Ana)", "+34 600.000.102", "3", "7", "celíaca (Ana)", "novio"],
  ["Íñigo Sáez", "600000103", "0", "", "vegetariano", "Novio"],
  ["Carmen y Luis Prieto", "600 000 104", "1", "2", "", "NOVIA"],
  ["Rosario Gil (abuela)", "600 00 01 05", "0", "1", "sin sal", "Novia"],
] as const;

/** Cada título de columna, al campo de vinklo que le asigna la revisión (IMPORT_FIELD_LABELS). */
const MAPPING = [
  ["NOMBRE Y APELLIDOS", "Nombre"],
  ["Tlf.", "Teléfono"],
  ["Acompañantes", "Nº de acompañantes"],
  ["Alergias / obs.", "Alergias / dieta"],
  ["de quién", "Lado (de quién)"],
  ["¿mesa?", "Mesa (campo propio)"],
] as const;

type Answer = "si" | "no" | "pendiente";
/** La lista ya importada y cómo queda tras las respuestas (capítulo 06). */
const GUESTS: ReadonlyArray<{ name: string; people: number; companions: number; phone: string; note: string; side: string; answer: Answer }> = [
  { name: "Marta López", people: 2, companions: 1, phone: "600 000 101", note: "", side: "Novia", answer: "si" },
  { name: "Familia Ortega", people: 4, companions: 3, phone: "600 000 102", note: "Celíaca (Ana)", side: "Novio", answer: "si" },
  { name: "Íñigo Sáez", people: 1, companions: 0, phone: "600 000 103", note: "Vegetariano", side: "Novio", answer: "no" },
  { name: "Carmen y Luis Prieto", people: 2, companions: 1, phone: "600 000 104", note: "", side: "Novia", answer: "pendiente" },
  { name: "Rosario Gil", people: 1, companions: 0, phone: "600 000 105", note: "Sin sal", side: "Novia", answer: "si" },
];
const ANSWER_LABEL: Record<Answer, string> = { si: "Confirmada", no: "No viene", pendiente: "Pendiente" };

/** Contadores tras las respuestas (58 + 9 + 31 = 98 invitaciones). */
const AFTER = { si: 58, no: 9, pendiente: 31 } as const;

const MESSAGE_BEFORE = "¡Hola, Marta! Nos casamos y nos haría mucha ilusión que vinieras";
const MESSAGE_TYPED = " con Pablo";
const MESSAGE_AFTER = ". Será el sábado 12 de junio de 2027. En tu invitación tienes el lugar, los horarios y todo lo demás, y puedes confirmar en un momento:";
const MESSAGE_LINK = "vinklo.es/b/lucia-y-juan?invitacion=…";
const MESSAGE_SIGN = "Un abrazo, Lucía y Juan";

export const EXCEL_CHAPTERS = [
  {
    id: "subir",
    kicker: "01 · Subid vuestro Excel",
    title: "Tal y como lo tenéis",
    body: "Columnas con nombres a vuestra manera, teléfonos con puntos o con +34, familias en una sola fila. Elegís el archivo (.xlsx, .xls, .ods o .csv) y vinklo lo lee.",
  },
  {
    id: "revisar",
    kicker: "02 · Revisad cómo lo hemos leído",
    title: "Nada se importa a ciegas",
    body: "Antes de añadir a nadie veis cuántas invitaciones y personas salen, a qué campo va cada columna y qué filas parecen repetidas. Si algo no cuadra, lo cambiáis.",
  },
  {
    id: "lista",
    kicker: "03 · Vuestra lista, en el panel",
    title: "Cada invitado, en su fila",
    body: "Las invitaciones aparecen en vuestra lista y en la vista Tabla, con acompañantes, alergias y teléfono. Los contadores se calculan solos.",
  },
  {
    id: "mensaje",
    kicker: "04 · Su mensaje, con su enlace",
    title: "Leedlo y retocadlo antes de enviarlo",
    body: "Cada invitado tiene su mensaje con su nombre y su enlace personal. Lo veis entero y podéis cambiar lo que queráis solo para esa persona.",
  },
  {
    id: "whatsapp",
    kicker: "05 · Abrid WhatsApp",
    title: "El mensaje ya va escrito",
    body: "Al pulsar «Abrir WhatsApp» se abre su chat con el texto puesto: nada de copiar y pegar. Lo enviáis vosotros, como cualquier otro mensaje.",
  },
  {
    id: "respuestas",
    kicker: "06 · Las respuestas vuelven",
    title: "Y vuestra lista se pone al día",
    body: "Cuando lo hayáis enviado, lo marcáis vosotros: WhatsApp no avisa a vinklo. Cada invitado confirma desde su enlace y los contadores cambian con cada respuesta.",
  },
] as const;

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

export function LandingExcel() {
  return (
    <div className="ll-home lc-home lx-home" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      <NacarBackground />
      <a className="ll-skip" href="#contenido">Saltar al contenido</a>

      {/* Cabecera fija y sin JS (la de la landing trae framer-motion y anclas de la portada). */}
      <header className="lc-nav" data-on="light" data-scrolled="">
        <nav aria-label="Principal" className="lc-nav-inner">
          <Link href="/" aria-label="vinklo, inicio" className="lc-brand">
            <span className="lc-brand-word"><LazoIcon aria-hidden="true" /><span>v<span className="lc-brand-i">ı</span>nklo</span></span>
          </Link>
          <div className="lc-nav-actions">
            <Link href="/login" prefetch={false} className="lc-nav-login">Entrar</Link>
            <Link href="/crear" className="lc-pill lc-pill--solid"><span className="lc-only-sm">Crear</span><span className="lc-hide-sm-inline">Crear nuestra web</span></Link>
          </div>
        </nav>
      </header>

      <main id="contenido">
        {/* Hero: el h1 es el LCP y no se anima. A la derecha, el bucle corto. */}
        <section className="lx-hero" aria-labelledby="lx-title">
          <div className="lx-hero-inner">
            <div className="lx-hero-copy">
              <p className="lc-kicker lc-kicker--clay">Invitados desde Excel</p>
              <h1 id="lx-title" className="lc-display lx-hero-title">
                Del Excel a WhatsApp, <em>sin copiar y pegar.</em>
              </h1>
              <p className="lx-hero-lead ll-enter" style={v({ "--enter-delay": "120ms" })}>
                ¿Ya tenéis la lista de invitados en un Excel? Traedla tal cual. vinklo la ordena en vuestro panel y os prepara el mensaje de cada invitado, con su enlace personal, listo para abrirlo en WhatsApp.
              </p>
              <div className="lc-hero-ctas ll-enter" style={v({ "--enter-delay": "200ms" })}>
                <Link href="/crear" className="ll-btn-clay ll-pressable lc-hero-cta">Crear nuestra web <ArrowRightIcon aria-hidden="true" width={18} height={18} /></Link>
                <Link href="/demo" className="lc-hero-demo ll-pressable">Ver una boda de ejemplo</Link>
              </div>
              <a href="#como-funciona" className="lx-watch ll-enter ll-pressable" style={v({ "--enter-delay": "260ms" })}>
                <span className="lx-watch-play" aria-hidden="true" />Ved cómo funciona, paso a paso
              </a>
            </div>
            <HeroFilm />
          </div>
        </section>

        <section id="como-funciona" className="lx-steps" aria-labelledby="lx-steps-title">
          <div className="lc-container">
            <h2 id="lx-steps-title" className="lc-display lc-h2" data-reveal="fade">De vuestra hoja a sus respuestas, <em>en seis pasos.</em></h2>
          </div>
          <ol className="lx-chapters lc-container">
            {EXCEL_CHAPTERS.map((chapter, i) => (
              <li key={chapter.id} id={`paso-${chapter.id}`} className="lx-chapter">
                <div className="lx-chapter-copy" data-reveal="fade">
                  <p className="lc-kicker lc-kicker--clay">{chapter.kicker}</p>
                  <h3 className="lc-display lx-h3">{chapter.title}</h3>
                  <p className="lx-body">{chapter.body}</p>
                  {chapter.id === "whatsapp" && <p className="lx-honest">vinklo no sabe si el mensaje llega ni si se lee.</p>}
                </div>
                <Scene index={i} />
              </li>
            ))}
          </ol>
        </section>

        <section className="lc-section lc-paper lx-truth" aria-labelledby="lx-truth-title">
          <div className="lc-container">
            <p className="lc-kicker lc-kicker--clay" data-reveal="fade">Lo que hace y lo que no</p>
            <h2 id="lx-truth-title" className="lc-display lc-h2" data-reveal="fade">Claro desde <em>el primer mensaje.</em></h2>
            <ul className="lx-truth-list">
              <li data-reveal="rise" data-reveal-group="truth">
                <h3>Vosotros decidís qué entra</h3>
                <p>Revisáis la lectura antes de importar. Si subís el mismo archivo otra vez, no se duplica a nadie.</p>
              </li>
              <li data-reveal="rise" data-reveal-group="truth">
                <h3>vinklo no envía por vosotros</h3>
                <p>WhatsApp se abre con el mensaje escrito y lo enviáis vosotros. Por eso sois vosotros quienes lo marcáis como enviado.</p>
              </li>
              <li data-reveal="rise" data-reveal-group="truth">
                <h3>Las respuestas sí llegan solas</h3>
                <p>Cada invitado confirma desde su enlace personal, sin cuenta ni aplicación, y su respuesta aparece en vuestra lista.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="lc-section lc-paper lx-close" aria-labelledby="lx-close-title">
          <div className="lc-container lx-close-inner" data-reveal="fade">
            <h2 id="lx-close-title" className="lc-display lc-h2">Empezad por la web. <em>Vuestra lista, después.</em></h2>
            <p className="lc-sub">Hoy, crear vuestra web de boda es gratis. Después, desde vuestro panel, importad el Excel cuando queráis.</p>
            <div className="lc-hero-ctas">
              <Link href="/crear" className="ll-btn-clay ll-pressable lc-hero-cta">Crear nuestra web <ArrowRightIcon aria-hidden="true" width={18} height={18} /></Link>
              <Link href="/demo" className="lc-hero-demo ll-pressable">Ver una boda de ejemplo</Link>
            </div>
          </div>
        </section>
      </main>

      <LandingFinale />
      <LandingMotion />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero: bucle de 4 fotogramas (16 s), solo CSS y decorativo.
// ---------------------------------------------------------------------------

function HeroFilm() {
  return (
    <div className="lx-film ll-enter" style={v({ "--enter-delay": "160ms" })} aria-hidden="true">
      <div className="lx-film-phone">
        <div className="lx-film-frame" style={v({ "--f": 0 })}>
          <span className="lx-film-file"><FileSpreadsheetIcon width={18} height={18} />invitados-DEFINITIVO.xlsx</span>
          <div className="lx-film-grid">
            {SHEET_ROWS.slice(0, 4).map((row) => <span key={row[0]}><i>{row[0]}</i><i>{row[1]}</i></span>)}
          </div>
          <span className="lx-film-caption">Subís el Excel</span>
        </div>
        <div className="lx-film-frame" style={v({ "--f": 1 })}>
          <b className="lx-film-big">98 <small>invitaciones</small></b>
          <b className="lx-film-big">210 <small>personas</small></b>
          <span className="lx-film-caption">Revisáis la lectura</span>
        </div>
        <div className="lx-film-frame" style={v({ "--f": 2 })}>
          <div className="lx-film-msg">¡Hola, Marta! Nos casamos y nos haría mucha ilusión que vinieras…<u>{MESSAGE_LINK}</u></div>
          <span className="lx-film-btn"><MessageCircleIcon width={16} height={16} />Abrir WhatsApp</span>
          <span className="lx-film-caption">Preparáis su mensaje</span>
        </div>
        <div className="lx-film-frame" style={v({ "--f": 3 })}>
          {GUESTS.slice(0, 4).map((g) => (
            <span key={g.name} className="lx-film-row"><i>{g.name}</i><Chip answer={g.answer} /></span>
          ))}
          <span className="lx-film-caption">Llegan las respuestas</span>
        </div>
      </div>
      <div className="lx-film-bar">{[0, 1, 2, 3].map((f) => <i key={f} style={v({ "--f": f })} />)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capítulos: cada maqueta se reproduce al entrar (data-revealed).
// ---------------------------------------------------------------------------

function Scene({ index }: { index: number }) {
  switch (index) {
    case 0: return <SceneUpload />;
    case 1: return <SceneReview />;
    case 2: return <SceneList />;
    case 3: return <SceneMessage />;
    case 4: return <SceneWhatsApp />;
    default: return <SceneAnswers />;
  }
}

function Screen({ scene, title, children }: { scene: string; title: string; children: ReactNode }) {
  return (
    <div className="lx-screen" data-scene={scene} data-reveal="rise" aria-hidden="true">
      <div className="lx-screen-bar"><i /><i /><i /><span>{title}</span></div>
      <div className="lx-screen-body">{children}</div>
    </div>
  );
}

function SceneUpload() {
  return (
    <Screen scene="subir" title="invitados-DEFINITIVO.xlsx">
      <div className="lx-sheet">
        <div className="lx-sheet-row lx-sheet-letters"><b /> {["A", "B", "C", "D", "E", "F"].map((l) => <b key={l}>{l}</b>)}</div>
        <div className="lx-sheet-row lx-sheet-head"><b>1</b>{SHEET_HEAD.map((h) => <span key={h}>{h}</span>)}</div>
        {SHEET_ROWS.map((row, r) => (
          <div key={row[0]} className="lx-sheet-row" style={v({ "--row": r })}><b>{r + 2}</b>{row.map((cell, c) => <span key={c}>{cell}</span>)}</div>
        ))}
      </div>
      <div className="lx-drop">
        <span className="lx-drop-file"><FileSpreadsheetIcon width={18} height={18} />invitados-DEFINITIVO.xlsx</span>
        <span className="lx-drop-label"><UploadIcon width={18} height={18} />Importar Excel</span>
        <span className="lx-drop-read"><i /></span>
        <span className="lx-drop-done"><CheckIcon width={16} height={16} strokeWidth={2.25} />Leído: 142 filas</span>
      </div>
    </Screen>
  );
}

function SceneReview() {
  return (
    <Screen scene="revisar" title="Importar Excel · Revisión">
      <p className="lx-review-title">{EXCEL_SUMMARY}</p>
      <p className="lx-muted">Hoja «Invitados» · cada columna, a su campo</p>
      <ul className="lx-map">
        {MAPPING.map(([from, to], r) => (
          <li key={from} style={v({ "--row": r })}>
            <span className="lx-map-from">{from}</span>
            <ArrowRightIcon width={14} height={14} className="lx-map-arrow" />
            <span className="lx-map-to">{to}</span>
            <CheckIcon width={16} height={16} strokeWidth={2.25} className="lx-map-ok" />
          </li>
        ))}
      </ul>
      <p className="lx-review-note">2 filas parecen repetidas dentro del archivo: se importarán; borradlas luego si sobran.</p>
      <span className="lx-btn lx-btn--clay lx-press">Importar 98 invitaciones (210 personas)</span>
    </Screen>
  );
}

function Counters({ after }: { after?: boolean }) {
  // Antes de las respuestas: todo «sin responder». Después: 58 / 9 / 31.
  const items: Array<[string, number, number]> = after
    ? [["Vienen", AFTER.si, 0], ["No vienen", AFTER.no, 0], ["Sin responder", AFTER.pendiente, EXCEL_SAMPLE.guests]]
    : [["Invitaciones", EXCEL_SAMPLE.guests, 0], ["Personas", EXCEL_SAMPLE.people, 0], ["Sin responder", EXCEL_SAMPLE.guests, 0]];
  return (
    <div className="lx-counters">
      {items.map(([label, n, from]) => (
        <span key={label} className="lx-counter">
          <b className="lx-num" style={v({ "--lx-n": n, "--lx-from": from })} />
          <small>{label}</small>
        </span>
      ))}
    </div>
  );
}

function Chip({ answer }: { answer: Answer }) {
  return <span className="lx-chip" data-a={answer}>{ANSWER_LABEL[answer]}</span>;
}

function SceneList() {
  return (
    <Screen scene="lista" title="Panel · Invitados">
      <div className="lx-tabs"><span>Lista</span><span data-on="">Tabla</span></div>
      <Counters />
      <div className="lx-table">
        <div className="lx-table-row lx-table-head"><span>Nombre</span><span className="lx-col-phone">Teléfono</span><span>Estado</span><span>Acompañantes</span><span className="lx-col-note">Notas</span></div>
        {GUESTS.map((g, r) => (
          <div key={g.name} className="lx-table-row" style={v({ "--row": r })}>
            <span className="lx-strong">{g.name}</span><span className="lx-col-phone">{g.phone}</span><Chip answer="pendiente" /><span>{g.companions}</span><span className="lx-col-note">{g.note || "—"}</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}

function SceneMessage() {
  return (
    <Screen scene="mensaje" title="Panel · Invitados">
      <div className="lx-sheet-card">
        <div className="lx-sheet-card-head"><b>Mensaje para Marta</b><XIcon width={18} height={18} /></div>
        <span className="lx-field-label">Así le llegará a Marta López <span className="lx-edit"><PencilIcon width={12} height={12} />Editado</span></span>
        <div className="lx-textarea">
          <p>{MESSAGE_BEFORE}<span className="lx-typed">{MESSAGE_TYPED}</span>{MESSAGE_AFTER}</p>
          <p><u>{MESSAGE_LINK}</u></p>
          <p>{MESSAGE_SIGN}</p>
        </div>
        <span className="lx-muted">Los cambios valen solo para este mensaje. No quitéis su enlace personal.</span>
        <div className="lx-actions">
          <span className="lx-btn lx-btn--clay lx-press"><MessageCircleIcon width={16} height={16} />Abrir WhatsApp</span>
          <span className="lx-btn lx-btn--ghost">Cancelar</span>
        </div>
        <span className="lx-muted">{COMPOSE_FOOTNOTE}</span>
      </div>
    </Screen>
  );
}

function SceneWhatsApp() {
  return (
    <div className="lx-screen lx-phone" data-scene="whatsapp" data-reveal="rise" aria-hidden="true">
      <div className="lx-wa-head"><span className="lx-wa-avatar">M</span><b>Marta López</b></div>
      <div className="lx-wa-chat">
        <span className="lx-wa-day">Hoy</span>
        <div className="lx-wa-bubble">
          <p>{MESSAGE_BEFORE}{MESSAGE_TYPED}{MESSAGE_AFTER}</p>
          <p><u>{MESSAGE_LINK}</u></p>
          <p>{MESSAGE_SIGN}</p>
          {/* Sin doble check: vinklo no sabe si se ha entregado ni leído. */}
          <small>12:04</small>
        </div>
      </div>
      <div className="lx-wa-compose">
        <span className="lx-wa-input">
          <span className="lx-wa-draft">{MESSAGE_BEFORE}{MESSAGE_TYPED}{MESSAGE_AFTER} {MESSAGE_LINK} {MESSAGE_SIGN}</span>
          <span className="lx-wa-placeholder">Mensaje</span>
        </span>
        <span className="lx-wa-send lx-press"><SendHorizontalIcon width={18} height={18} /></span>
      </div>
    </div>
  );
}

function SceneAnswers() {
  return (
    <Screen scene="respuestas" title="Panel · Invitados">
      <div className="lx-ask">
        <b>¿Se la habéis enviado a Marta?</b>
        <span className="lx-muted">Solo vosotros lo sabéis: WhatsApp no avisa a vinklo.</span>
        {/* El botón se pulsa y deja paso a la marca: «enviada» solo porque ellos lo dicen. */}
        <span className="lx-ask-swap">
          <span className="lx-btn lx-btn--clay lx-press"><CheckIcon width={16} height={16} strokeWidth={2.25} />Sí, enviada</span>
          <span className="lx-ask-done"><CheckIcon width={16} height={16} strokeWidth={2.25} />Enviada (lo marcasteis vosotros)</span>
        </span>
      </div>
      <p className="lx-later">Unos días después</p>
      <Counters after />
      <div className="lx-table lx-table--answers">
        {GUESTS.map((g, r) => (
          <div key={g.name} className="lx-table-row" style={v({ "--row": r })}>
            <span className="lx-strong">{g.name}</span><span>{g.people}</span>
            <span className="lx-flip"><Chip answer="pendiente" /><Chip answer={g.answer} /></span>
          </div>
        ))}
      </div>
    </Screen>
  );
}
