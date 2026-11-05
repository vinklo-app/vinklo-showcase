"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateWeddingSettings } from "@/lib/actions/wedding";
import { pageConfigSchema, type WeddingPageConfig, type WeddingSettingsInput } from "@/lib/wedding-settings";
import { SITE_SAVED_MESSAGE, type SiteVisibility } from "@/components/panel/site-visibility";
import { PlaceCombobox } from "@/components/places/place-combobox";
import { pickedIntoAddress, pickedIntoVenue } from "@/lib/places/places";

/**
 * Formulario de ajustes de la web. `visibility` (R-01) decide el copy: si
 * nunca se ha publicado una revisión, los invitados ya ven cada cambio
 * guardado; si hay revisión, ven la publicada hasta publicar de nuevo.
 */
export function WeddingSettings({ initial, slug, visibility = "live" }: { initial: WeddingSettingsInput; slug: string; visibility?: SiteVisibility }) {
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const config = { ...pageConfigSchema.parse({}), ...values.pageConfig };
  const setConfig = (patch: Partial<WeddingPageConfig>) => setValues({ ...values, pageConfig: { ...config, ...patch } });

  const footnote = visibility === "live"
    ? "Los nombres y la fecha aparecen en vuestra web. La estimación de invitados solo se muestra en vuestro panel. El enlace seguirá siendo el mismo cuando guardéis los cambios; vuestros invitados ya los ven."
    : visibility === "published"
      ? "Los nombres y la fecha aparecen en vuestra web. La estimación de invitados solo se muestra en vuestro panel. El enlace seguirá siendo el mismo cuando guardéis los cambios; los invitados ven la versión publicada."
      : "Los nombres y la fecha aparecerán en vuestra web cuando la volváis a publicar. La estimación de invitados solo se muestra en vuestro panel.";

  return <form className="pn-form" onSubmit={(event) => {
    event.preventDefault(); setError(null); setMessage(null);
    startTransition(async () => {
      try {
        const result = await updateWeddingSettings(values);
        if (result.ok) setMessage(SITE_SAVED_MESSAGE[visibility]);
        else setError(result.error);
      } catch { setError("No hemos podido guardar. Revisad la conexión y probad de nuevo."); }
    });
  }}>
    <fieldset disabled={pending} className="contents"><legend className="sr-only">Configuración de vuestra web</legend>
    {/* id: destino del atajo de la IA («Ir a Los datos», lib/ai/messages.ts). */}
    <h2 id="los-datos" className="pn-display pn-h2">Los datos</h2>
    <fieldset>
      {/* ids: destino de la edición desde la vista previa (lib/site-chat/live-edit.ts, PANEL_TARGETS). */}
      <label className="pn-field"><span>Primer nombre</span><input id="ajustes-nombre-1" required minLength={2} maxLength={80} value={values.partnerName1} onChange={(e) => setValues({ ...values, partnerName1: e.target.value })} /></label>
      <label className="pn-field"><span>Segundo nombre</span><input required minLength={2} maxLength={80} value={values.partnerName2} onChange={(e) => setValues({ ...values, partnerName2: e.target.value })} /></label>
      <label className="pn-field"><span>Fecha de la boda</span><input id="ajustes-fecha" type="date" required value={values.weddingDate} onChange={(e) => setValues({ ...values, weddingDate: e.target.value })} /></label>
      <label className="pn-field"><span>Fecha límite para confirmar (opcional)</span><input type="date" max={values.weddingDate || undefined} aria-describedby="rsvp-deadline-help" value={values.rsvpDeadline ?? ""} onChange={(e) => setValues({ ...values, rsvpDeadline: e.target.value })} /><small id="rsvp-deadline-help" className="pn-help">Después de esta fecha, la invitación deja de aceptar respuestas. Sin fecha, se aceptan hasta el día después de la boda.</small></label>
      <label className="pn-field"><span>Invitados estimados</span><input type="number" inputMode="numeric" required min={1} max={2000} step={1} value={Number.isNaN(values.guestCountEst) ? "" : values.guestCountEst} onChange={(e) => setValues({ ...values, guestCountEst: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>
    </fieldset>
    <h2 className="pn-display pn-h2 pn-rule mt-4 border-t pt-6">La invitación</h2>
    <fieldset>
      <label className="pn-field"><span>Estilo</span><select value={config.style} onChange={(e) => setConfig({ style: e.target.value as WeddingPageConfig["style"] })}><option value="editorial">Editorial</option><option value="clasico">Caligráfica</option><option value="natural">Serena</option></select></label>
      <label className="pn-field"><span>Hora de llegada</span><input type="time" value={config.time} onChange={(e) => setConfig({ time: e.target.value })} /></label>
      <label className="pn-field pn-span"><span>Vuestro mensaje</span><textarea rows={4} maxLength={400} value={config.welcomeMessage} onChange={(e) => setConfig({ welcomeMessage: e.target.value })} placeholder="Te invitamos a formar parte de la historia que estamos construyendo juntos." /></label>
      {/* Sugerencias de lugares: elegir una guarda el sitio exacto (place_id) para «Ver en el mapa»; escribir a mano lo quita. */}
      <PlaceCombobox id="ajustes-lugar" labelClassName="pn-field" label={<span>Lugar de la celebración</span>} maxLength={160} value={config.venue} onChange={(venue) => setConfig({ venue, placeId: undefined })} onPick={(place) => setConfig(pickedIntoVenue(place))} placeholder="Nombre de la finca o espacio" />
      <PlaceCombobox id="ajustes-direccion" labelClassName="pn-field" label={<span>Dirección</span>} maxLength={240} value={config.address} onChange={(address) => setConfig({ address, placeId: undefined })} onPick={(place) => setConfig(pickedIntoAddress(place, config.venue))} />
    </fieldset>
    <p className="pn-help">{footnote}</p>
    {error && <p role="alert" className="pn-row-error">{error}</p>}
    {message && <p role="status" className="pn-note pn-note--ok">{message}</p>}
    <div className="pn-form-actions">
      <button disabled={pending} className="pn-btn pn-press">{pending ? "Guardando…" : "Guardar cambios"}</button>
      <Link href={`/b/${slug}`} className="pn-link pn-press">Ver nuestra web</Link>
    </div>
    <div className="pn-rule border-t pt-6 text-sm"><p className="font-semibold">Horarios, lugares y cómo llegar</p><p className="pn-muted mt-1">Añadid los detalles que necesitan vuestros invitados en la agenda.</p><Link href="/panel/dia" className="pn-link pn-press">Editar el día de la boda →</Link></div>
    </fieldset>
  </form>;
}
