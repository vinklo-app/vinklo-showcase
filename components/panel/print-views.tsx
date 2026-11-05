import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

import "@/components/panel/print.css";
import { PrintButton } from "@/components/panel/print-button";
import { companionLabel, seatsTaken, type SeatingPlan } from "@/lib/crm/seating";
import { attendingPeople, cateringRows, companionNamesByGuest, companionNamesText, entryList, initialOf, kidsSummary, printTables, tablesByGuest } from "@/lib/panel/print-lists";
import { menuText, summarizeAnswers, type ModuleLabels, type RsvpAnswers, type RsvpModules } from "@/lib/rsvp-answers";
import { dietSummaryText, summarizeDiet } from "@/lib/rsvp-diet";

/**
 * Hojas para imprimir del panel (plan maestro §4.7). Server-safe: las páginas
 * reales y el borrador (/borrador/panel) las montan con sus datos. Sin
 * librerías: CSS de impresión en print.css.
 */
export interface PrintWedding { names: string; date: string | null }

function people(n: number) {
  return `${n} ${n === 1 ? "persona" : "personas"}`;
}
function companionsLabel(companions: number) {
  return companions > 0 ? ` +${companions}` : "";
}

function PrintHeader({ wedding, eyebrow, title, back }: { wedding: PrintWedding; eyebrow: string; title: string; back: { href: string; label: string } }) {
  return (
    <>
      <div className="pn-print-bar pn-print-hide">
        <Link href={back.href} className="pn-link pn-press pn-muted"><ChevronLeftIcon aria-hidden="true" className="size-4" />{back.label}</Link>
        <PrintButton />
      </div>
      <header className="pn-print-head">
        <p className="pn-eyebrow">{eyebrow}</p>
        <h1 className="pn-display pn-h1">{title}</h1>
        <p className="pn-muted text-sm">{[wedding.names, wedding.date].filter(Boolean).join(" · ")}</p>
      </header>
    </>
  );
}

/** Mesas con sus invitados y lista de entrada alfabética con la mesa de cada uno. */
export function SeatingPrintView({ wedding, plan, back }: { wedding: PrintWedding; plan: SeatingPlan; back: { href: string; label: string } }) {
  const tables = printTables(plan);
  const entry = entryList(plan);
  const unseated = entry.filter((row) => row.table === null);
  let lastLetter = "";
  return (
    <main className="pn-wrap pn-print">
      <PrintHeader wedding={wedding} eyebrow="Para imprimir" title="Mesas y lista de entrada" back={back} />

      <section className="pn-print-section" aria-labelledby="print-tables">
        <h2 id="print-tables" className="pn-display pn-h2">Mesas <span className="pn-muted pn-tnum text-sm">{people(tables.reduce((sum, t) => sum + t.people, 0))} sentadas</span></h2>
        {tables.length === 0 ? (
          <p className="pn-note">Aún no habéis creado mesas. <Link href="/panel/mesas" className="pn-link pn-print-hide">Crear las mesas</Link></p>
        ) : (
          <div className="pn-print-tables">
            {tables.map((table) => (
              <article key={table.id} className="pn-print-table">
                <h3><span>{table.name}</span><span className="pn-tnum pn-print-note">{table.people} / {table.seats}</span></h3>
                {table.guests.length === 0 && table.visitors.length === 0 ? <p className="pn-print-note">Nadie que venga, todavía.</p> : (
                  <ul className="pn-print-list">
                    {table.guests.map((guest) => {
                      const names = companionNamesText(guest);
                      return (
                        <li key={guest.id}>
                          {guest.name}<span className="pn-tnum">{companionsLabel(seatsTaken(guest) - 1)}</span>
                          {names && <span className="pn-print-note">Con {names}</span>}
                          {guest.notes?.trim() && <span className="pn-print-note pn-print-note--alert">{guest.notes.trim()}</span>}
                        </li>
                      );
                    })}
                    {table.visitors.map((visitor) => (
                      <li key={visitor.id}>
                        {companionLabel(visitor)}
                        <span className="pn-print-note">Con {visitor.guestName}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {table.pending > 0 && <p className="pn-print-note">{table.pending === 1 ? "1 persona sentada aquí no ha respondido." : `${table.pending} personas sentadas aquí no han respondido.`}</p>}
              </article>
            ))}
          </div>
        )}
        {unseated.length > 0 && tables.length > 0 && <p className="pn-print-note">{unseated.length === 1 ? "1 invitación de quien viene está sin mesa." : `${unseated.length} invitaciones de quien viene están sin mesa.`} En la lista de entrada aparecen como «Sin mesa».</p>}
      </section>

      <section className="pn-print-section pn-print-break" aria-labelledby="print-entry">
        <h2 id="print-entry" className="pn-display pn-h2">Lista de entrada <span className="pn-muted pn-tnum text-sm">{people(attendingPeople(entry))}</span></h2>
        {entry.length === 0 ? <p className="pn-note">Aún no ha confirmado nadie.</p> : (
          <div className="pn-print-scroll">
            <table className="pn-print-rows">
              <thead><tr><th scope="col">Nombre</th><th scope="col">Personas</th><th scope="col">Mesa</th></tr></thead>
              <tbody>
                {entry.flatMap((row) => {
                  const letter = initialOf(row.name);
                  const showLetter = letter !== lastLetter;
                  lastLetter = letter;
                  const line = (
                    <tr key={row.id}>
                      <td>
                        <b>{row.name}</b>
                        {row.names.length > 0 && <span className="pn-print-note">Con {row.names.join(" · ")}</span>}
                        {row.away.map((item) => <span key={`${item.name}-${item.table}`} className="pn-print-note">{item.name}: {item.table}</span>)}
                      </td>
                      <td className="pn-tnum">{row.companions + 1}</td>
                      <td>{row.table ?? <span className="pn-print-note">Sin mesa</span>}</td>
                    </tr>
                  );
                  return showLetter ? [<tr key={`letra-${letter}`} className="pn-print-letter-row"><th scope="rowgroup" colSpan={3} className="pn-print-letter">{letter}</th></tr>, line] : [line];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export interface PrintAgendaItem { id: string; title: string; time_label: string | null; place: string | null; address: string | null; notes: string | null }
export interface PrintAttending { id: string; name: string; companions: number; notes: string | null; answers: RsvpAnswers | null }

/** El día: agenda, y para el catering el resumen de menús y las alergias por mesa. */
export function DayPrintView({ wedding, agenda, guests, modules, labels, plan, back, menuModules = modules }: {
  wedding: PrintWedding; agenda: PrintAgendaItem[]; guests: PrintAttending[];
  modules: RsvpModules | null; labels: ModuleLabels | null; plan: SeatingPlan | null;
  /** Menús que pueden elegir los invitados (publicada), para «sin menú»; por defecto, `modules`. */
  menuModules?: Pick<RsvpModules, "menu"> | null;
  back: { href: string; label: string };
}) {
  // Todos los que vienen (también sin respuestas de módulos): así salen las personas sin menú.
  const answerRows = guests.map((g) => ({ id: g.id, name: g.name, companions: g.companions, answers: g.answers }));
  const totals = modules && labels && modules.menu.length > 0 ? summarizeAnswers(answerRows, modules, labels, menuModules) : null;
  const menu = totals ? totals.menu.filter((m) => m.people > 0) : [];
  const menuMissing = totals?.menuMissing ?? 0;
  const namesOf = companionNamesByGuest(plan);
  // Vegetarianos/veganos (ítem 21) van con las notas de su invitación: «… · 1 vegetariano».
  const rows = cateringRows(guests.map((g) => ({ id: g.id, name: g.name, companions: g.companions, notes: [g.notes?.trim(), dietSummaryText(g.answers?.diet ?? {})].filter(Boolean).join(" · ") || null, menu: g.answers && labels ? menuText(g.answers, labels) : "", companionNames: namesOf.get(g.id) ?? "" })), tablesByGuest(plan));
  // «3 sin gluten · 2 vegetarianos» (ítem 21): solo lo marcado en las casillas.
  const diet = summarizeDiet(guests);
  const dietLine = dietSummaryText(diet.counts);
  const hasTables = Boolean(plan && plan.tables.length > 0);
  const hasNames = rows.some((row) => row.companionNames);
  const kids = kidsSummary(plan);
  return (
    <main className="pn-wrap pn-print">
      <PrintHeader wedding={wedding} eyebrow="Para imprimir" title="El día y el catering" back={back} />

      <section className="pn-print-section" aria-labelledby="print-agenda">
        <h2 id="print-agenda" className="pn-display pn-h2">Agenda</h2>
        {agenda.length === 0 ? <p className="pn-note">Aún no habéis añadido momentos del día.</p> : (
          <ul className="pn-print-list">
            {agenda.map((item) => (
              <li key={item.id}>
                <b className="pn-tnum">{item.time_label ? `${item.time_label} · ` : ""}</b><b>{item.title}</b>
                {(item.place || item.address) && <span className="pn-print-note">{[item.place, item.address].filter(Boolean).join(" · ")}</span>}
                {item.notes && <span className="pn-print-note">{item.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pn-print-section pn-print-break" aria-labelledby="print-catering">
        <h2 id="print-catering" className="pn-display pn-h2">Para el catering <span className="pn-muted pn-tnum text-sm">{people(attendingPeople(guests))} confirmadas</span></h2>
        {menu.length > 0 && (
          <ul className="pn-print-totals" aria-label="Menús">
            {menu.map((m) => <li key={m.label}><b className="pn-tnum">{m.people}</b> {m.label}</li>)}
          </ul>
        )}
        {menuMissing > 0 && <p className="pn-print-note pn-tnum">Aviso: {people(menuMissing)} sin menú.</p>}
        {dietLine && <p className="pn-print-totals-line pn-tnum" data-diet-summary=""><b>Alergias y dietas marcadas:</b> {dietLine}.</p>}
        {diet.withDetails > 0 && (
          <p className="pn-print-note pn-tnum" data-diet-details="">
            {diet.withDetails === 1 ? "1 nota con más detalles: leedla en la tabla." : `${diet.withDetails} notas con más detalles: leedlas en la tabla.`}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="pn-note">Nadie ha dejado alergias ni notas{menu.length > 0 ? " ni ha elegido menú" : ""} al confirmar.</p>
        ) : (
          <div className="pn-print-scroll">
            <table className="pn-print-rows">
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  {hasTables && <th scope="col">Mesa</th>}
                  <th scope="col">Personas</th>
                  {hasNames && <th scope="col">Acompañantes</th>}
                  {menu.length > 0 && <th scope="col">Menú</th>}
                  <th scope="col">Alergias y notas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><b>{row.name}</b></td>
                    {hasTables && <td>{row.table ?? <span className="pn-print-note">Sin mesa</span>}</td>}
                    <td className="pn-tnum">{row.companions + 1}</td>
                    {hasNames && <td>{row.companionNames ?? ""}</td>}
                    {menu.length > 0 && <td>{row.menu}</td>}
                    <td>{row.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="pn-print-note">Las notas son lo que cada invitado marcó o escribió al confirmar: revisadlas con el catering.</p>
      </section>

      {(kids.total > 0 || kids.named.length > 0) && (
        <section className="pn-print-section" aria-labelledby="print-kids">
          <h2 id="print-kids" className="pn-display pn-h2">Niños <span className="pn-muted pn-tnum text-sm">{kids.total === 1 ? "1 niño o niña" : `${kids.total} niños`}</span></h2>
          {kids.named.length === 0 ? (
            <p className="pn-note">Nadie ha dado aún los nombres de los niños: el total sale de lo que indicó cada invitado.</p>
          ) : (
            <div className="pn-print-scroll">
              <table className="pn-print-rows">
                <thead><tr><th scope="col">Nombre</th><th scope="col">Va con</th>{hasTables && <th scope="col">Mesa</th>}</tr></thead>
                <tbody>
                  {kids.named.map((kid) => (
                    <tr key={kid.id}>
                      <td><b>{kid.name}</b></td>
                      <td>{kid.with}</td>
                      {hasTables && <td>{kid.table ?? <span className="pn-print-note">Sin mesa</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {kids.named.length > 0 && kids.named.length < kids.total && <p className="pn-print-note">{kids.total - kids.named.length === 1 ? "Falta el nombre de 1 niño o niña." : `Faltan los nombres de ${kids.total - kids.named.length} niños.`}</p>}
        </section>
      )}
    </main>
  );
}
