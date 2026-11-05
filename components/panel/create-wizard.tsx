"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { OnboardingWizard } from "@/components/panel/onboarding-wizard";
import { landingIdeaParam } from "@/lib/creator-compose";
import { findBuilderTemplate } from "@/lib/templates";

/**
 * `?idea=` (prompt de la landing, recortado al límite del borrador) y
 * `?plantilla=` (desde su /demo) se leen aquí, en el cliente, para que /crear
 * sea estática. El wizard decide si los aplica (`planLandingIdea`: la lee con IA
 * al abrir y nunca pisa en silencio una idea ya guardada).
 */
function CreateWizardFromQuery() {
  const params = useSearchParams();
  const plantilla = params.get("plantilla");
  // Se fija al abrir: quitar `?idea=` de la URL (abajo) no debe cambiarla.
  const [initialIdea] = useState(() => landingIdeaParam(params.get("idea")));
  // La frase ya está en el borrador: fuera de la URL, para que recargar o
  // compartir el enlace no vuelva a leerla con la IA (revisión del bloque 1, F7).
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("idea")) return;
      url.searchParams.delete("idea");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch { /* Sin History API: la URL se queda como está. */ }
  }, []);
  // Estable entre renders: el wizard lo usa como dependencia de su efecto de montaje.
  const initialTemplate = useMemo(() => findBuilderTemplate(plantilla), [plantilla]);
  return <OnboardingWizard authenticated={false} initialIdea={initialIdea} initialTemplate={initialTemplate} />;
}

export function CreateWizard() {
  // El prerender sirve el wizard vacío; en el navegador entra el que trae la query.
  return (
    <Suspense fallback={<OnboardingWizard authenticated={false} />}>
      <CreateWizardFromQuery />
    </Suspense>
  );
}
