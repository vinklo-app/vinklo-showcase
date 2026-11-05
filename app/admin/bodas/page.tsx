import type { Metadata } from "next";
import { connection } from "next/server";

import { assertAdmin } from "@/lib/admin";
import { loadLatestWeddings, loadUsers } from "@/lib/admin/overview";
import { createAdminClient } from "@/lib/supabase/admin";
import { WeddingsTable } from "../_components/overview-view";
import { fmtInt } from "../_components/format";

export const metadata: Metadata = {
  title: "Bodas · Admin",
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

const LIMIT = 500;

/**
 * Todas las bodas (las 500 más recientes) con el estado real de su web y el
 * nº de invitados (agregado embebido; ningún dato personal de invitados).
 * Plan y cobros retirados: los pagos están desactivados en el producto v2.
 */
export default async function AdminBodasPage() {
  await assertAdmin();
  await connection();
  const unavailable = new Set<string>();
  const client = createAdminClient();
  const users = await loadUsers(client, new Date());
  const rows = await loadLatestWeddings(client, LIMIT, unavailable, users?.idToEmail ?? new Map());

  return (
    <div className="ad-root">
      <header className="ad-page-head">
        <div>
          <p className="ad-folio">Bodas</p>
          <h1 className="ad-h1">Todas las bodas</h1>
        </div>
        <p className="ad-meta">
          {rows.length === LIMIT ? `Las ${fmtInt(LIMIT)} más recientes` : `${fmtInt(rows.length)} ${rows.length === 1 ? "boda" : "bodas"}`}
        </p>
      </header>

      <section className="ad-section" aria-label="Listado de bodas">
        {rows.length === 0 ? (
          <p className="ad-empty">
            {unavailable.has("weddings")
              ? "No se han podido leer las bodas."
              : "Aún no hay bodas creadas. Cuando una pareja complete el creador, aparecerá aquí."}
          </p>
        ) : (
          <WeddingsTable rows={rows} showWeddingDate />
        )}
        <p className="ad-note">
          Estado: «Publicada» sirve la revisión publicada; «Retirada» responde 404; «v1» sirve el adaptador a partir de los datos de la boda (la web es pública igualmente).
          {unavailable.has("wedding_sites") ? " En este entorno no existe la tabla de webs: todas aparecen como v1." : ""}
        </p>
      </section>
    </div>
  );
}
