"use client";

/** Recarga la URL actual para conservar el enlace personal sin volver a mostrar sus datos. */
export function RsvpReadError() {
  return (
    <div className="sp-rule border-y py-5 text-[0.9375rem] leading-relaxed text-tinta/75" data-rsvp-read-error="">
      <p role="alert">No hemos podido cargar tu respuesta. Vuelve a intentarlo para confirmar o cambiar tu asistencia con tus datos guardados.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-11 rounded-lg border border-line px-5 text-sm font-medium text-tinta focus-visible:ring-3 focus-visible:ring-cava/50">
        Reintentar
      </button>
    </div>
  );
}
