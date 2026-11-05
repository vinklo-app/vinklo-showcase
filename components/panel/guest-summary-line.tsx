import type { AttendanceSummary } from "@/lib/data/attendance";
import { AnimatedNumber } from "@/components/panel/animated-number";

/**
 * Línea de resumen bajo «Invitados» (server-safe). Totales de toda la lista
 * (no dependen de la búsqueda), así que sus cifras pueden animarse al
 * cambiar sin moverse mientras se escribe en el buscador. «por vosotros» es
 * el estado honesto (lo confirma la pareja); lo de WhatsApp vive en la ayuda
 * del estado «Enviada» (revisión Jobs #17).
 */
export function GuestSummaryLine({ summary }: { summary: AttendanceSummary | null }) {
  if (!summary || summary.total === 0) return <>Vuestra lista de asistencia empieza aquí.</>;
  const one = (count: number, singular: string, many: string) => (count === 1 ? singular : many);
  return (
    <>
      <AnimatedNumber value={summary.attendees} /> {one(summary.attendees, "viene", "vienen")} · <AnimatedNumber value={summary.prepared} /> {one(summary.prepared, "preparada", "preparadas")} · <AnimatedNumber value={summary.sent} /> {one(summary.sent, "enviada", "enviadas")} por vosotros
    </>
  );
}
