import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "@/components/panel/onboarding-wizard";
import { loadStashedDraft } from "@/lib/actions/builder-stash";
import { postLoginPath } from "@/lib/auth/post-login";
import { PartnerInviteNotice } from "@/components/panel/partner-invite-notice";
import "@/components/panel/panel.css";

/** IA («Pedid cambios») y subida de la foto tras crear la boda: margen de
 *  duración para las server actions de esta página (datos-ia.md §3). */
export const maxDuration = 60;

/** Teclado virtual: en Android encoge el viewport (el compositor queda encima);
 *  iOS no lo soporta y lo resuelve `useKeyboardAwareShell` con visualViewport.
 *  Se repiten los valores del layout porque el viewport de la página lo sustituye. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };


export const metadata = {
  title: "Crear vuestra boda",
};

export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Invitación de pareja a medias (cookie de /unirse) o ya tienen boda
  // (propia o aceptada): el onboarding no pinta nada.
  const destination = await postLoginPath(supabase);
  if (destination !== "/onboarding") {
    redirect(destination);
  }

  // Invitación vigente para este correo abierta en otro navegador: se avisa
  // antes de que creen una segunda boda (sin datos de la boda que invita).
  const { data: pendingInvite } = await supabase.rpc("pending_wedding_invite_for_me");

  // Si el enlace del correo se abrió en otro navegador, este no trae el
  // borrador de /crear: se recupera la copia guardada al pedir el enlace.
  return (
    <>
      {pendingInvite === true ? <PartnerInviteNotice /> : null}
      <OnboardingWizard stashedDraft={await loadStashedDraft()} accountEmail={user.email ?? null} pendingInvite={pendingInvite === true} />
    </>
  );
}
