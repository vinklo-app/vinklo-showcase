import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatEurCents } from "@/lib/fees";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MethodBadge, StatusBadge } from "@/components/panel/badges";
import { ConfirmBizumButton } from "@/components/panel/confirm-bizum-button";
import { CsvExportButton } from "@/components/panel/csv-export-button";
import {
  netCents,
  type ContributionRow,
  type WeddingRow,
} from "@/components/panel/types";
import "@/components/panel/panel.css";

export const metadata = {
  title: "Contribuciones",
};

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default async function ContribucionesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: weddingData } = await supabase
    .from("weddings")
    .select("id, slug, plan")
    .limit(1)
    .maybeSingle();

  if (!weddingData) {
    redirect("/onboarding");
  }
  const wedding = weddingData as Pick<WeddingRow, "id" | "slug" | "plan">;

  const { data: contributionsData } = await supabase
    .from("contributions")
    .select(
      "id, guest_name, guest_email, n_cubiertos, cubierto_cents, gift_cents, total_cents, service_fee_cents, method, status, created_at"
    )
    .eq("wedding_id", wedding.id)
    .order("created_at", { ascending: false });

  const contributions = (contributionsData ?? []) as ContributionRow[];

  const confirmedCents = contributions
    .filter((c) => c.status === "confirmed")
    .reduce((sum, c) => sum + netCents(c), 0);
  const pendingCents = contributions
    .filter((c) => c.status === "pending")
    .reduce((sum, c) => sum + netCents(c), 0);
  // Solo confirmadas: la fila del pie se llama "Total confirmado" y los
  // euros de al lado también son confirmados.
  const totalCubiertos = contributions
    .filter((c) => c.status === "confirmed")
    .reduce((sum, c) => sum + c.n_cubiertos, 0);

  return (
    <main className="bb-scope min-h-svh">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/panel"
              className="text-sm text-[var(--tinta)]/60 underline-offset-4 hover:text-[var(--tinta)] hover:underline"
            >
              ← Volver al panel
            </Link>
            <h1 className="bb-display mt-2 text-3xl font-semibold">
              Contribuciones
            </h1>
            <p className="mt-1 text-sm text-[var(--tinta)]/60">
              Todas las aportaciones de vuestros invitados, en un sitio.
            </p>
          </div>
          <CsvExportButton rows={contributions} plan={wedding.plan} />
        </header>

        <section className="rounded-none border border-[var(--tinta)]/10 bg-white">
          {contributions.length === 0 ? (
            <p className="p-6 text-sm text-[var(--tinta)]/60">
              Todavía no hay aportaciones. Compartid vuestra página de
              invitados y aquí aparecerá cada aportación.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Fecha</TableHead>
                  <TableHead>Invitado</TableHead>
                  <TableHead className="text-right">Personas</TableHead>
                  <TableHead className="text-right">Regalo</TableHead>
                  <TableHead className="text-right">Aportación</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contributions.map((contribution) => (
                  <TableRow key={contribution.id}>
                    <TableCell className="bb-tnum pl-4 text-[var(--tinta)]/70">
                      {dateFormatter.format(new Date(contribution.created_at))}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {contribution.guest_name}
                      </span>
                      {contribution.guest_email && (
                        <span className="block max-w-48 truncate text-xs text-[var(--tinta)]/50">
                          {contribution.guest_email}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="bb-tnum text-right">
                      {contribution.n_cubiertos}
                    </TableCell>
                    <TableCell className="bb-tnum text-right text-[var(--tinta)]/70">
                      {contribution.gift_cents > 0
                        ? formatEurCents(contribution.gift_cents)
                        : "—"}
                    </TableCell>
                    <TableCell className="bb-tnum text-right font-medium">
                      {formatEurCents(netCents(contribution))}
                    </TableCell>
                    <TableCell>
                      <MethodBadge method={contribution.method} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={contribution.status} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {contribution.method === "bizum_manual" &&
                        contribution.status === "pending" && (
                          <ConfirmBizumButton
                            contributionId={contribution.id}
                          />
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className="bg-[var(--papel)]/60">
                <TableRow className="hover:bg-transparent">
                  <TableCell className="pl-4" colSpan={2}>
                    Total confirmado
                  </TableCell>
                  <TableCell className="bb-tnum text-right">
                    {totalCubiertos}
                  </TableCell>
                  <TableCell />
                  <TableCell className="bb-tnum text-right font-semibold">
                    {formatEurCents(confirmedCents)}
                  </TableCell>
                  <TableCell colSpan={3} className="pr-4 text-right">
                    {pendingCents > 0 && (
                      <span className="bb-tnum text-[var(--tinta)]/60">
                        {formatEurCents(pendingCents)} pendientes
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </section>
      </div>
    </main>
  );
}
