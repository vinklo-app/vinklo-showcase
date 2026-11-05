"use client";

import { useState, useTransition } from "react";
import { plural } from "@/components/panel/guest-status";
import { TAG_MAX, normalizeTag, tagKey, type GuestTagSummary } from "@/lib/crm/tags";

/**
 * «Vuestras etiquetas»: cada etiqueta con cuántos la tienen, para renombrarla
 * en todos (si ya existe la nueva, se juntan) o quitarla a todos.
 */
export function TagManager({ summary, onRename }: { summary: readonly GuestTagSummary[]; onRename: (from: string, to: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function run(from: string, to: string) {
    setError(null);
    startTransition(async () => {
      try {
        const problem = await onRename(from, to);
        if (problem) { setError(problem); return; }
        setEditing(null); setAsking(null);
      } catch { setError("No se ha guardado. Comprobad la conexión y probad de nuevo."); }
    });
  }
  if (summary.length === 0) return <p className="pn-help">Aún no habéis puesto ninguna etiqueta. Hacedlo desde la ficha de cada invitado o con «Seleccionar» y «Etiquetar…».</p>;
  return (
    <div className="grid gap-4">
      <p className="pn-help">Grupo = van juntos (una familia, una pareja). Etiquetas = de qué os conocen (Amigos de la uni, Trabajo…): un invitado puede tener varias y las mesas automáticas intentan juntar a quien comparte etiqueta.</p>
      <ul className="pn-tag-admin">
        {summary.map((row) => (
          <li key={row.tag}>
            <div className="pn-tag-admin-head">
              <span className="pn-tag-admin-name">{row.tag}</span>
              <span className="pn-muted pn-tnum shrink-0 text-sm">{plural(row.guests, "invitado", "invitados")}</span>
            </div>
            {editing === row.tag ? (
              <form onSubmit={(event) => {
                event.preventDefault();
                const to = normalizeTag(draft);
                if (!to) { setError("Escribid el nombre nuevo o usad «Quitar a todos»."); return; }
                if (to === row.tag) { setEditing(null); return; }
                run(row.tag, to);
              }}>
                <label className="sr-only" htmlFor={`tag-${tagKey(row.tag)}`}>Nombre nuevo de {row.tag}</label>
                <input id={`tag-${tagKey(row.tag)}`} value={draft} maxLength={TAG_MAX} autoFocus disabled={pending} onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }} />
                <button type="submit" className="pn-btn pn-btn--sm pn-press" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</button>
              </form>
            ) : asking === row.tag ? (
              <div className="pn-tag-admin-actions" role="group" aria-label={`Quitar ${row.tag}`}>
                <span className="text-sm">¿Quitar «{row.tag}» a {plural(row.guests, "invitado", "invitados")}?</span>
                <button type="button" className="pn-btn pn-btn--danger pn-btn--sm pn-press" disabled={pending} onClick={() => run(row.tag, "")}>Quitar a todos</button>
                <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={pending} onClick={() => setAsking(null)}>Cancelar</button>
              </div>
            ) : (
              <div className="pn-tag-admin-actions">
                <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={pending} onClick={() => { setEditing(row.tag); setAsking(null); setDraft(row.tag); setError(null); }}>Renombrar</button>
                <button type="button" className="pn-btn pn-btn--ghost pn-btn--sm pn-press" disabled={pending} onClick={() => { setAsking(row.tag); setEditing(null); setError(null); }}>Quitar a todos</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="pn-row-error">{error}</p>}
    </div>
  );
}
