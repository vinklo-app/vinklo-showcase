import { addDays, type IsoDate } from "@/lib/planning/dates";
import type { BudgetData } from "@/lib/planning/budget";
import { suggestTasks, type WeddingTask } from "@/lib/planning/tasks";
import type { VendorContact } from "@/lib/vendors/contacts";

/**
 * Datos de muestra de «Planificar» para /borrador/panel (solo desarrollo).
 * Las fechas se calculan desde «hoy» para que siempre haya algo vencido,
 * algo de esta semana y algo más adelante. Nombres ficticios.
 */
const id = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-09-01T10:00:00.000Z";

export function sampleTasks(today: IsoDate, weddingDate: IsoDate | null, worst = false): WeddingTask[] {
  const base: Array<Partial<WeddingTask> & { title: string }> = [
    { title: "Pedir presupuesto a dos floristas", dueOn: addDays(today, -3), category: "proveedores" },
    { title: "Llamar al juzgado para la fecha", dueOn: addDays(today, -1), category: "papeleo", notes: "Preguntar por los papeles de empadronamiento." },
    { title: "Probar el menú con el catering", dueOn: addDays(today, 2), category: "proveedores" },
    { title: "Elegir la canción de entrada", dueOn: addDays(today, 5), category: "ceremonia" },
    { title: "Reservar el autobús para los invitados", dueOn: addDays(today, 25), category: "dia" },
    { title: "Comprar las alianzas", dueOn: addDays(today, 60), category: "vestuario", templateKey: "alianzas" },
    { title: "Pensar en los detalles para los invitados", dueOn: null, category: null },
    { title: "Reservar la finca", dueOn: addDays(today, -40), category: "finca", templateKey: "reservar-finca", done: true, doneAt: `${addDays(today, -35)}T10:00:00.000Z` },
    { title: "Contratar fotografía y vídeo", dueOn: addDays(today, -10), category: "proveedores", templateKey: "contratar-fotografia", done: true, doneAt: `${addDays(today, -12)}T10:00:00.000Z` },
  ];
  if (worst) {
    base.push(
      { title: "Hablar con la tía Mari-Carmen sobre si viene con los primos de Albacete y si se quedan a dormir en la casa rural o en el hotel", dueOn: addDays(today, 1), category: "invitados", notes: "x".repeat(400) },
      { title: "Supercalifragilisticoespialidosoparaprobarpalabraslarguísimassinespacios", dueOn: addDays(today, -200), category: "otros" },
      ...Array.from({ length: 30 }, (_, i) => ({ title: `Tarea ${i + 1}`, dueOn: addDays(today, 10 + i * 9), category: null })),
    );
  }
  void weddingDate;
  return base.map((task, i) => ({
    id: id("7a", i + 1), notes: null, done: false, doneAt: null, position: i, templateKey: null, createdAt: stamp, dueOn: null, category: null, ...task,
  }) as WeddingTask);
}

/** Tareas de muestra a partir de las sugerencias (lo que devolvería addSuggestedTasks). */
export function tasksFromSuggestions(keys: string[], today: IsoDate, weddingDate: IsoDate | null, start: number): WeddingTask[] {
  const byKey = new Map(suggestTasks(weddingDate, today).map((s) => [s.key, s]));
  return keys.flatMap((key, i) => {
    const s = byKey.get(key);
    return s ? [{ id: id("7b", start + i), title: s.title, notes: null, dueOn: s.dueOn, done: false, doneAt: null, category: s.category, position: i, templateKey: s.key, createdAt: new Date().toISOString() }] : [];
  });
}

export function sampleContacts(worst = false): VendorContact[] {
  const rows: Array<Partial<VendorContact> & Pick<VendorContact, "name" | "category" | "status">> = [
    { name: "Finca El Olivar", category: "lugar", status: "contratado", contactName: "Marta Ruiz", phone: "+34 600 111 222", email: "eventos@fincaelolivar.example", paymentNote: "Señal del 30 % al firmar; resto 15 días antes." },
    { name: "Catering Sabores", category: "catering", status: "en_conversacion", contactName: "Jorge", phone: "600 333 444" },
    { name: "Luz y Grano Fotografía", category: "fotografia", status: "contratado", email: "hola@luzygrano.example" },
    { name: "Dúo Cuerdas del Sur", category: "musica", status: "contactado" },
    { name: "Floristería La Camelia", category: "flores", status: "por_contactar" },
    { name: "Otro fotógrafo", category: "fotografia", status: "descartado", notes: "Sin fecha libre." },
  ];
  if (worst) {
    rows.push({ name: "Peluquería y Estética Integral Hermanas Fernández-Villanueva de los Monteros", category: "belleza", status: "en_conversacion", contactName: "María de las Mercedes Fernández-Villanueva", email: "reservas.bodas.y.eventos.especiales@peluqueriahermanasfernandezvillanueva.example", paymentNote: "x".repeat(300) });
  }
  return rows.map((row, i) => ({ id: id("7c", i + 1), contactName: null, phone: null, email: null, paymentNote: null, notes: null, createdAt: stamp, updatedAt: stamp, ...row }));
}

export function sampleBudget(today: IsoDate, contacts: VendorContact[], empty = false, worst = false): BudgetData {
  if (empty) return { totalCents: null, items: [], payments: [] };
  const finca = contacts[0]?.id ?? null;
  const foto = contacts[2]?.id ?? null;
  const items: BudgetData["items"] = [
    { id: id("7d", 1), category: "finca", label: "Finca y banquete", vendorContactId: finca, budgetedCents: 1_200_000, agreedCents: 1_280_000, notes: "Incluye 110 cubiertos.", position: 1 },
    { id: id("7d", 2), category: "fotografia", label: "Reportaje y vídeo", vendorContactId: foto, budgetedCents: 250_000, agreedCents: 230_000, notes: null, position: 2 },
    { id: id("7d", 3), category: "musica", label: "Música de la ceremonia", vendorContactId: null, budgetedCents: 60_000, agreedCents: null, notes: null, position: 3 },
    { id: id("7d", 4), category: "vestido", label: "Vestido", vendorContactId: null, budgetedCents: 180_000, agreedCents: 165_050, notes: null, position: 4 },
    { id: id("7d", 5), category: "traje", label: "Traje", vendorContactId: null, budgetedCents: 90_000, agreedCents: null, notes: null, position: 5 },
  ];
  const payments: BudgetData["payments"] = [
    { id: id("7e", 1), itemId: id("7d", 1), amountCents: 384_000, dueOn: addDays(today, -60), paidOn: addDays(today, -58), note: "Señal 30 %" },
    { id: id("7e", 2), itemId: id("7d", 1), amountCents: 896_000, dueOn: addDays(today, 120), paidOn: null, note: "Resto" },
    { id: id("7e", 3), itemId: id("7d", 2), amountCents: 69_000, dueOn: addDays(today, -2), paidOn: null, note: "Reserva de fecha" },
    { id: id("7e", 4), itemId: id("7d", 4), amountCents: 50_000, dueOn: addDays(today, 9), paidOn: null, note: "Primera prueba" },
  ];
  if (worst) {
    items.push({ id: id("7d", 9), category: "otros", label: "Detalles para los invitados, papelería, transporte y un montón de cosas pequeñas que suman", vendorContactId: null, budgetedCents: 999_999_999, agreedCents: 999_999_999, notes: null, position: 9 });
  }
  return { totalCents: 2_000_000, items, payments };
}
