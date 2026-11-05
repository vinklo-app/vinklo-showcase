"use client";

/**
 * Respuestas de los módulos (8-oct-2026): autobús por parada y sentido,
 * alojamiento por hotel (y cuántos de cada sitio van en autobús), menú,
 * niños y canciones. Cuenta personas (quien responde + acompañantes). El CSV
 * es para la empresa de autobuses, el hotel o el catering.
 */
import { DownloadIcon } from "lucide-react";

import { csvCell } from "@/lib/messages/guest-csv";
import { busText, lodgingText, menuText, summarizeAnswers, type AnswerRow, type ModuleLabels, type RsvpModules } from "@/lib/rsvp-answers";

function people(n: number) {
  return `${n} ${n === 1 ? "persona" : "personas"}`;
}

export function ModuleSummary({ rows, modules, labels, menuModules = modules }: { rows: AnswerRow[]; modules: RsvpModules; labels: ModuleLabels; menuModules?: Pick<RsvpModules, "menu"> | null }) {
  const t = summarizeAnswers(rows, modules, labels, menuModules);

  function download() {
    const header = ["Nombre", "Personas", "Autobús", "Alojamiento", "Niños", "Menú", "Canción"];
    const lines = rows.filter((r) => r.answers).map((r) => {
      const a = r.answers!;
      return [csvCell(r.name), String(r.companions + 1), csvCell(busText(a, labels)), csvCell(lodgingText(a, labels)), a.kids ? String(a.kids) : "", csvCell(menuText(a, labels)), csvCell(a.song ?? "")].join(";");
    });
    const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "vinklo-autobuses-alojamiento-menu.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="pn-modsum" aria-labelledby="pn-modsum-title">
      <div className="pn-modsum-head">
        <div>
          <h2 id="pn-modsum-title" className="pn-h3">Lo que os han contestado</h2>
          <p className="pn-help">{t.responded === 0 ? "Aún nadie ha contestado a estas preguntas. Las respuestas aparecen aquí según confirman." : `${t.responded} ${t.responded === 1 ? "respuesta" : "respuestas"} con estos datos. Contamos personas: quien responde y sus acompañantes.`}</p>
        </div>
        {t.responded > 0 && (
          <button type="button" onClick={download} className="pn-act pn-press"><DownloadIcon aria-hidden="true" className="size-4" />Exportar CSV</button>
        )}
      </div>
      <div className="pn-modsum-grid">
        {t.bus && (
          <article className="pn-modsum-card">
            <h3>Autobuses</h3>
            <p className="pn-modsum-big pn-tnum">{people(t.bus.ida)} <small>a la ida</small></p>
            <p className="pn-modsum-big pn-tnum">{people(t.bus.vuelta)} <small>a la vuelta</small></p>
            {t.bus.byStop.length > 0 && <ul>{t.bus.byStop.map((s) => <li key={s.label}><span>{s.label}</span><b className="pn-tnum">{s.people}</b></li>)}</ul>}
            {t.bus.none > 0 && <p className="pn-help">{people(t.bus.none)} van por su cuenta.</p>}
          </article>
        )}
        {t.lodging && (
          <article className="pn-modsum-card">
            <h3>Alojamiento</h3>
            <ul>
              {t.lodging.byHotel.map((h) => <li key={h.label}><span>{h.label}{h.bus > 0 ? <small> · {h.bus} en autobús</small> : null}</span><b className="pn-tnum">{h.people}</b></li>)}
              <li><span>En otro sitio{t.lodging.otherBus > 0 ? <small> · {t.lodging.otherBus} en autobús</small> : null}</span><b className="pn-tnum">{t.lodging.other}</b></li>
              <li><span>No se alojan</span><b className="pn-tnum">{t.lodging.none}</b></li>
            </ul>
          </article>
        )}
        {t.menu.length > 0 && (
          <article className="pn-modsum-card">
            <h3>Menú</h3>
            <ul>{t.menu.map((m) => <li key={m.label}><span>{m.label}</span><b className="pn-tnum">{m.people}</b></li>)}</ul>
            {t.menuMissing > 0 && <p className="pn-help pn-tnum">{people(t.menuMissing)} sin menú.</p>}
          </article>
        )}
        {modules.kids && (
          <article className="pn-modsum-card">
            <h3>Niños</h3>
            <p className="pn-modsum-big pn-tnum">{t.kids}</p>
          </article>
        )}
        {modules.song && (
          <article className="pn-modsum-card">
            <h3>Canciones</h3>
            {t.songs.length === 0 ? <p className="pn-help">Todavía ninguna.</p> : <ul>{t.songs.slice(0, 30).map((s, i) => <li key={`${s.name}-${i}`}><span>{s.song}</span><small>{s.name}</small></li>)}</ul>}
          </article>
        )}
      </div>
    </section>
  );
}
