import type { Metadata } from "next";
import { connection } from "next/server";

import { assertAdmin } from "@/lib/admin";
import type { AdminWaitlistRow } from "@/lib/admin/types";
import { WAITLIST_KIND_LABELS } from "@/lib/admin/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { WaitlistCsvButton } from "@/components/admin/waitlist-csv-button";
import { fmtCivilDate, fmtDateTime, fmtInt } from "../_components/format";

export const metadata: Metadata = {
  title: "Waitlist · Admin",
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

const BASE_COLUMNS = "id, email, name, kind, wedding_date, source, created_at";

export default async function AdminWaitlistPage() {
  await assertAdmin();
  await connection();
  const admin = createAdminClient();

  const run = (columns: string) =>
    admin.from("waitlist").select(columns).order("created_at", { ascending: false }).limit(5000);
  // interested_in_gifts puede no estar migrada en este entorno: se reintenta sin ella.
  let { data, error } = await run(`${BASE_COLUMNS}, interested_in_gifts`);
  const hasGiftsColumn = !error;
  if (error) ({ data, error } = await run(BASE_COLUMNS));

  const rows = (data ?? []) as unknown as AdminWaitlistRow[];
  const interested = rows.filter((r) => r.interested_in_gifts).length;

  return (
    <div className="ad-root">
      <header className="ad-page-head">
        <div>
          <p className="ad-folio">Waitlist</p>
          <h1 className="ad-h1">Lista de espera</h1>
          <p className="ad-meta ad-tnum">
            {rows.length === 0
              ? "Sin altas todavía."
              : `${fmtInt(rows.length)} ${rows.length === 1 ? "alta" : "altas"}${hasGiftsColumn ? ` · ${fmtInt(interested)} con interés en regalos` : ""}`}
          </p>
        </div>
        <WaitlistCsvButton rows={rows} />
      </header>

      <section className="ad-section" aria-label="Altas de la lista de espera">
        {error ? (
          <p className="ad-empty">No se ha podido leer la lista de espera.</p>
        ) : rows.length === 0 ? (
          <p className="ad-empty">Aún no hay nadie en la lista. Las altas de la landing aparecerán aquí.</p>
        ) : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Nombre</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Fecha de boda</th>
                  {hasGiftsColumn ? <th scope="col">Regalos</th> : null}
                  <th scope="col">Origen</th>
                  <th scope="col" className="ad-right">
                    Alta
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="ad-ellipsis ad-strong">{row.email}</td>
                    <td className="ad-ellipsis">{row.name ?? "—"}</td>
                    <td>{WAITLIST_KIND_LABELS[row.kind] ?? row.kind}</td>
                    <td className="ad-tnum">{fmtCivilDate(row.wedding_date)}</td>
                    {hasGiftsColumn ? <td>{row.interested_in_gifts ? "Sí" : "No"}</td> : null}
                    <td className="ad-ellipsis ad-muted">{row.source ?? "—"}</td>
                    <td className="ad-right ad-tnum ad-muted">{fmtDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
