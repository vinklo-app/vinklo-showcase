import { stashBuilderDraft } from "@/lib/actions/builder-stash";
import { BUILDER_STORAGE_KEY, hasBuilderProgress, restoreBuilderDraft } from "@/lib/wedding-builder";

/**
 * Antes de mandar un correo de acceso (enlace/código o confirmación de la
 * cuenta nueva): el correo puede abrirse en otro navegador (el de la app de
 * correo, otro dispositivo) que no tiene el borrador de /crear, así que se
 * deja una copia en el servidor para este correo. true si quedó guardada.
 * Si falla, el acceso sigue igual y el borrador sigue en este navegador.
 */
export async function keepBuilderDraft(email: string): Promise<boolean> {
  try {
    const draft = restoreBuilderDraft(localStorage.getItem(BUILDER_STORAGE_KEY));
    if (!hasBuilderProgress(draft)) return false;
    return (await stashBuilderDraft({ email, draft })).ok;
  } catch {
    return false;
  }
}
