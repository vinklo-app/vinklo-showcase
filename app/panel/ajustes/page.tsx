import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWedding } from "@/lib/data/current-wedding";
import { PublishCard } from "@/components/panel/publish-card";
import { PageHead } from "@/components/panel/page-head";
import { SiteEditor } from "@/components/panel/site-editor";
import { WeddingSettings } from "@/components/panel/wedding-settings";
import { PartnerCard } from "@/components/panel/partner-card";
import { getPartnerState } from "@/lib/actions/partner";
import { DigestPrefCard } from "@/components/panel/digest-pref-card";
import { getDigestPref } from "@/lib/actions/digest";
import { DangerZone } from "@/components/panel/danger-zone";
import { SITE_VISIBILITY_NOTE, siteVisibility } from "@/components/panel/site-visibility";
import { getSiteEditorState } from "@/lib/data/site";
import { pageConfigSchema } from "@/lib/wedding-settings";
import { rsvpWindow } from "@/lib/rsvp-window";

export const metadata = { title: "Editar vuestra web" };

// «Pedid cambios» llama a la IA (5–25 s): las server actions heredan la
// duración de la página (datos-ia §3). Sin esto, Hobby corta a los 10 s.
export const maxDuration = 60;

// Antes en la portada del panel (revisión Jobs #12): cerrar sesión es un ajuste, no una tarea.
async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function WeddingSettingsPage() {
  const context = await getCurrentWedding();
  if (!context) redirect("/onboarding");
  const { supabase } = context;
  const { data: wedding, error } = await supabase.from("weddings").select("id, slug, partner_name_1, partner_name_2, wedding_date, rsvp_deadline, guest_count_est, page_config, plan").eq("id", context.wedding.id).maybeSingle();
  if (error) throw new Error("No se ha podido cargar la configuración de la boda.");
  if (!wedding) redirect("/onboarding");
  // null mientras el motor de webs no tenga fila para esta boda: la tarjeta
  // de publicación y el editor no se muestran y los ajustes funcionan como hasta ahora.
  const [siteState, partnerState, digestPref] = await Promise.all([getSiteEditorState(supabase, wedding.id), getPartnerState(), getDigestPref()]);
  // R-01: sin revisión publicada la web se sirve EN VIVO; el copy lo dice.
  const visibility = siteVisibility(siteState);
  const plan = wedding.plan === "premium" ? "premium" : "free";
  // El preview enseña el mismo estado del formulario que verá el invitado hoy.
  const rsvpState = rsvpWindow({ weddingDate: wedding.wedding_date, rsvpDeadline: wedding.rsvp_deadline });

  const settings = (
    <>
      <WeddingSettings
        key="datos"
        slug={wedding.slug}
        visibility={visibility}
        initial={{ partnerName1: wedding.partner_name_1, partnerName2: wedding.partner_name_2, weddingDate: wedding.wedding_date ?? "", rsvpDeadline: wedding.rsvp_deadline ?? "", guestCountEst: wedding.guest_count_est ?? 1, pageConfig: pageConfigSchema.catch(() => pageConfigSchema.parse({})).parse(wedding.page_config) }}
      />
      {/* Segunda cuenta de pareja (20261015100000): sin la migración no aparece. */}
      <div key="pareja" className="mt-8"><PartnerCard state={partnerState} /></div>
      {/* Resumen diario de respuestas (20261021100000): sin la migración no aparece. */}
      <div key="resumen" className="mt-8"><DigestPrefCard state={digestPref} /></div>
      <form key="sesion" action={signOut} className="mt-8"><button className="pn-btn pn-btn--ghost pn-btn--sm pn-press" type="submit">Cerrar sesión</button></form>
      {/* Borrar boda y cuenta (plan maestro §5.10): siempre al final. */}
      <div key="eliminar" className="mt-8">
        <DangerZone
          role={context.role}
          slug={wedding.slug}
          email={context.userEmail}
          hasPartner={partnerState.ok && partnerState.available && partnerState.members.length > 1}
        />
      </div>
    </>
  );

  return (
    <main className={`pn-wrap pn-page pn-page--tight ${siteState ? "" : "pn-narrow"}`}>
      <PageHead eyebrow="Vuestra web" title={<>Vuestra web <em>de boda</em></>} lead="Preparad los detalles, mirad cómo queda en el móvil y publicadla cuando esté lista." />
      {siteState ? (
        <div>
          <SiteEditor
            state={siteState}
            plan={plan}
            visibility={visibility}
            rsvpWindow={rsvpState}
            before={(
              <div className="grid gap-3">
                <PublishCard key="publicar" state={siteState} />
                <p key="visibilidad" className="pn-note">{SITE_VISIBILITY_NOTE[visibility]}</p>
              </div>
            )}
            after={<div className="pn-ed-section">{settings}</div>}
          />
        </div>
      ) : (
        <div>{settings}</div>
      )}
    </main>
  );
}
