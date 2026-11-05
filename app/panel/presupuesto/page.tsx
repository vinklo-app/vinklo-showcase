import { redirect } from "next/navigation";

/** El presupuesto vive junto a la agenda de proveedores (2026-10-06). */
export default function PanelPresupuestoPage() {
  redirect("/panel/proveedores?ver=presupuesto");
}
