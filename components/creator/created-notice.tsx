import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { LazoIcon } from "@/components/brand/icons";
import { PublishedShare } from "./published-share";
import type { SiteVisibility } from "@/components/panel/site-visibility";

/** Siguiente paso tras publicar: añadir a la primera persona (abre el formulario de alta). */
export const FIRST_GUESTS_HREF = "/panel/invitados?nuevo=1";

/**
 * Cierre del creador (`/onboarding/listo`), siempre tras crear la boda.
 * Presentación pura: la página resuelve sesión, boda, estado real de la web y
 * motivos (códigos fijos, nunca texto libre de la URL) y pasa el resultado.
 *  - Publicada y todo en su sitio: «¡Vuestra web ya está publicada!», su
 *    enlace (ver, copiar, WhatsApp) y el siguiente paso, los invitados.
 *  - Publicada pero sin alguna foto: lo mismo, con lo que falta y dónde.
 *  - Publicada con el estilo base (`failed`): sin celebración; el enlace
 *    funciona, así que se enseña, pero primero el aviso.
 *  - Sin publicar (`live`): el enlace ya abre la web con los datos guardados
 *    (site-visibility.ts), pero sin la foto ni los colores: se enseña el
 *    enlace y cómo publicarla.
 *  - Retirada (`withdrawn`): sin enlace (no se abre) y cómo volver a publicarla.
 */
export type ListoWeb = "failed" | "live" | "withdrawn";

export function CreatedNotice({ photo, web, gallery, publicUrl }: { photo?: string; web?: ListoWeb; gallery?: number; publicUrl?: string | null }) {
  const pending = (photo ? 1 : 0) + (web ? 1 : 0) + (gallery ? 1 : 0);
  const celebrate = !web && Boolean(publicUrl);
  const shareUrl = web === "withdrawn" ? null : publicUrl ?? null;
  const missing = pending === 1 ? "Falta un detalle:" : pending === 2 ? "Faltan dos detalles:" : "Faltan tres detalles:";
  const base = celebrate ? "Ya tenéis vuestro enlace y vuestro panel. Quien tenga este enlace ya puede verla." : "Ya tenéis vuestro enlace y vuestro panel.";
  const lead = pending === 0 ? base : `${base} ${missing}`;

  return <div className="wb-shell wb-done-shell">
    <header className="wb-header">
      <Link href="/" className="wb-brand" aria-label="vinklo, inicio"><LazoIcon className="wb-brand-mark" aria-hidden="true" /><span aria-hidden="true">v<span className="wb-brand-i">ı</span>nklo</span></Link>
    </header>
    <main className="wb-done">
      <span className="wb-done-mark" aria-hidden="true"><CheckIcon size={20} strokeWidth={2} /></span>
      {celebrate ? <h1>¡Vuestra web ya está <em>publicada!</em></h1> : <h1>Vuestra web está <em>creada.</em></h1>}
      <p className="wb-done-lead">{lead}</p>
      <ul className="wb-done-list">
        {photo && <li><strong>No hemos podido añadir vuestra foto:</strong> {photo}. La portada lleva vuestras iniciales hasta que la añadáis en Ajustes.</li>}
        {gallery ? <li><strong>{gallery === 1 ? "Una de vuestras fotos no se ha podido subir." : `${gallery} de vuestras fotos no se han podido subir.`}</strong> Las demás ya están en la galería; podéis añadir {gallery === 1 ? "esa" : "esas"} en Ajustes, en «Fotos».</li> : null}
        {web === "live" && <li><strong>Vuestra web todavía no está publicada.</strong> El enlace ya la abre con los datos que habéis guardado; la foto y los colores saldrán cuando entréis en Ajustes y pulséis «Publicar nuestra web».</li>}
        {web === "withdrawn" && <li><strong>Vuestra web está retirada:</strong> el enlace no se abre para los invitados. Entrad en Ajustes y pulsad «Volver a publicar» para mostrarla.</li>}
        {web === "failed" && <li><strong>No hemos podido guardar vuestros colores y cambios.</strong> La web está publicada con el estilo base; podéis elegirlos de nuevo en Ajustes.</li>}
        {!photo && !web && !gallery && <li>Todo está en su sitio. Podéis seguir desde vuestro panel.</li>}
      </ul>
      {shareUrl && <PublishedShare url={shareUrl} />}
      <div className="wb-actions wb-done-actions">
        {celebrate
          ? <>
            <Link href="/panel" className="wb-secondary">Ir al panel</Link>
            {pending > 0 && <Link href="/panel/ajustes" className="wb-secondary">{photo ? "Añadir la foto en Ajustes" : "Abrir Ajustes"}</Link>}
            <Link href={FIRST_GUESTS_HREF} className="wb-primary">Añadid a vuestros primeros invitados<ArrowRightIcon aria-hidden="true" size={18} strokeWidth={1.75} /></Link>
          </>
          : pending === 0
            ? <Link href="/panel" className="wb-primary">Ir al panel<ArrowRightIcon aria-hidden="true" size={18} strokeWidth={1.75} /></Link>
            : <>
              <Link href="/panel" className="wb-secondary">Ir al panel</Link>
              <Link href="/panel/ajustes" className="wb-primary">{photo ? "Añadir la foto en Ajustes" : "Abrir Ajustes"}<ArrowRightIcon aria-hidden="true" size={18} strokeWidth={1.75} /></Link>
            </>}
      </div>
    </main>
  </div>;
}

/**
 * Qué se cuenta de la web en `/onboarding/listo`, con lo que ven hoy los
 * invitados (`siteVisibility`, la misma regla que Ajustes, el editor y el
 * panel) cuando se pudo leer; null = no se pudo leer y se fía de la URL. Así
 * recargar la página más tarde nunca celebra una web que ya no está publicada.
 * Una web del creador que no llegó a publicarse (`?web=draft`) está «en vivo»:
 * el adaptador ya la sirve con los datos guardados.
 */
export function listoWebState(param: "draft" | "failed" | undefined, visibility: SiteVisibility | null): ListoWeb | undefined {
  if (visibility === "published") return param === "failed" ? "failed" : undefined;
  if (visibility !== null) return visibility;
  return param === "draft" ? "live" : param;
}
