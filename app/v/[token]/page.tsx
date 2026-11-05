import "@/components/panel/panel.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getVendorByToken } from "@/lib/actions/vendors";
import { VENDOR_CATEGORY_LABELS, type VendorCategory } from "@/lib/vendors";
import { formatEurCents } from "@/lib/fees";
import { VendorSetupForm } from "@/components/vendor/vendor-setup-form";

export const metadata: Metadata = {
  title: "Portal de proveedores",
  robots: { index: false, follow: false },
};

const dateFormatter = new Intl.DateTimeFormat("es-ES", { dateStyle: "long" });

/**
 * Portal del proveedor (magic link, sin sesión). El token es la única
 * llave; caduca a los 30 días si no se completa el setup y, una vez
 * activo, sirve para consultar el estado de los cobros (el IBAN queda
 * bloqueado — lib/actions/vendors.ts).
 */
export default async function VendorPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getVendorByToken(token);
  if (!data) notFound();

  const { vendor, weddingPartnerNames, invoice, tranches } = data;
  const categoryLabel =
    VENDOR_CATEGORY_LABELS[vendor.category as VendorCategory] ??
    vendor.category;

  return (
    <main className="bb-scope min-h-svh px-5 py-12 sm:py-16">
      <div className="mx-auto max-w-xl">
        <p className="bb-folio">
          Portal de proveedores · {weddingPartnerNames}
        </p>
        <h1 className="bb-display mt-3 text-3xl text-[var(--tinta)] sm:text-4xl">
          {vendor.name}
        </h1>
        <p className="mt-1 text-sm text-[var(--tinta)]/65">{categoryLabel}</p>

        {vendor.status === "active" && (
          <section aria-labelledby="v-estado" className="bb-card mt-8 p-6">
            <h2 id="v-estado" className="bb-folio">
              Vuestra ficha con la pareja
            </h2>
            {invoice && (
              <p className="bb-display bb-tnum mt-3 text-3xl text-[var(--tinta)]">
                {formatEurCents(invoice.total_cents)}
              </p>
            )}
            {tranches.length > 0 && (
              <ul className="mt-4 space-y-2">
                {tranches.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-baseline justify-between gap-3 border-t border-[var(--tinta)]/12 pt-2 text-sm"
                  >
                    <span className="text-[var(--tinta)]/80">
                      {t.label}
                      {t.due_date && (
                        <span className="text-[var(--tinta)]/60">
                          {" "}
                          · vence el{" "}
                          {dateFormatter.format(
                            new Date(`${t.due_date}T12:00:00`),
                          )}
                        </span>
                      )}
                    </span>
                    <span className="bb-tnum whitespace-nowrap">
                      {formatEurCents(t.amount_cents)}{" "}
                      <span
                        className={
                          t.status === "paid"
                            ? "font-semibold text-[var(--salvia)]"
                            : "text-[var(--tinta)]/60"
                        }
                      >
                        {t.status === "paid" ? "· pagado" : "· pendiente"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs leading-relaxed text-[var(--tinta)]/65">
              ¿Algo ha cambiado? Podéis reenviar la ficha abajo — la pareja
              recibirá un aviso con cada envío.
            </p>
          </section>
        )}

        <section aria-labelledby="v-setup" className="bb-card mt-8 p-6">
          <h2 id="v-setup" className="bb-folio">
            {vendor.status === "active"
              ? "Actualizar factura y calendario"
              : "Subid vuestra factura y calendario de pagos"}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--tinta)]/75">
            {weddingPartnerNames} verán el importe, los plazos y la factura
            en su panel — y os tendrán al día de cada pago. Sin cuentas ni
            contraseñas: este enlace es vuestro acceso.
          </p>
          <VendorSetupForm
            token={token}
            ibanLocked={vendor.status === "active"}
          />
        </section>

        <p className="mt-8 text-center text-xs text-[var(--tinta)]/55">
          Portal seguro de vinklo — el sobre de boda.
        </p>
      </div>
    </main>
  );
}
