/**
 * Guardar un texto editado sobre la vista previa sin perderlo si falla
 * (components/site-chat/live-edit.tsx, revisión UX ítem 17).
 *
 * - `saveLiveText`: ejecuta el guardado y dice qué hacer. Si falla (también
 *   por red al cerrar el teclado en el móvil), el campo NO se cierra: se
 *   conserva lo escrito, se muestra el error en línea y, si tiene sentido,
 *   «Reintentar». Lo pendiente se guarda además en un borrador local.
 * - Borrador local (sessionStorage, con try/catch): sobrevive a recargar la
 *   página; al reabrir ese mismo campo se ofrece recuperarlo. Solo vale si el
 *   texto original sigue siendo el mismo con el que se escribió.
 *   Un texto que no pasa la validación (vacío, demasiado largo) no se guarda:
 *   no se ofrecería algo que tampoco se puede guardar.
 * - Dos textos de error: `error`, en línea con el campo abierto («Vuestro
 *   texto sigue aquí», y es verdad); `flash`, cuando el campo ya se cerró
 *   (se guardaba al pasar a otro texto): solo promete recuperarlo si de
 *   verdad quedó en el borrador local.
 */

export type LiveOutcome = { ok: true } | { ok: false; error: string; retryable?: boolean; conflict?: boolean };

/** Fallo de red o del servidor: lo escrito sigue ahí y se puede reintentar. */
export const SAVE_FAILED_INLINE = "No se ha podido guardar. Vuestro texto sigue aquí.";
const KEEP_NOTE = "Vuestro texto sigue aquí.";
/** Campo ya cerrado, con el texto en el borrador local. */
export const SAVE_FAILED_KEPT = "No se ha podido guardar este texto. Al volver a abrirlo podréis recuperarlo.";
/** Campo ya cerrado, sin borrador (validación o sin almacenamiento). */
export const SAVE_FAILED_LOST = "No se ha podido guardar este texto.";

export type SaveResult =
  | { status: "saved" }
  | { status: "failed"; error: string; retryable: boolean; /** Para cuando el campo ya se cerró. */ flash: string };

type Draft = { initial: string; value: string };
const PREFIX = "vinklo:live-edit:";

function store(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

/** true si quedó guardado. */
export function writeLiveDraft(path: string, initial: string, value: string, storage?: Storage | null): boolean {
  try {
    const target = store(storage);
    if (!target) return false;
    target.setItem(PREFIX + path, JSON.stringify({ initial, value } satisfies Draft));
    return true;
  } catch { return false; /* sin almacenamiento: solo queda el campo abierto */ }
}

export function clearLiveDraft(path: string, storage?: Storage | null): void {
  try { store(storage)?.removeItem(PREFIX + path); } catch { /* idem */ }
}

/** Texto pendiente de este campo, si lo hay y sigue siendo sobre el mismo original. */
export function readLiveDraft(path: string, initial: string, storage?: Storage | null): string | null {
  try {
    const raw = store(storage)?.getItem(PREFIX + path);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<Draft> | null;
    if (!draft || typeof draft.value !== "string" || draft.initial !== initial || draft.value === initial) return null;
    return draft.value;
  } catch { return null; }
}

/**
 * Guarda `value`. Éxito: borra el borrador. Fallo (resultado o excepción): lo
 * escrito queda en el borrador y se devuelve el error en línea. Solo es
 * reintentable lo que lo declara (red, servidor); un conflicto de versión o la
 * validación se explican y se corrigen, sin «Reintentar».
 */
export async function saveLiveText(
  opts: { path: string; initial: string; value: string; save(path: string, value: string): Promise<LiveOutcome>; storage?: Storage | null },
): Promise<SaveResult> {
  let outcome: LiveOutcome;
  try { outcome = await opts.save(opts.path, opts.value); } catch { outcome = { ok: false, error: "", retryable: true }; }
  if (outcome.ok) { clearLiveDraft(opts.path, opts.storage); return { status: "saved" }; }
  const retryable = outcome.retryable === true && !outcome.conflict;
  // Red/servidor o conflicto de versión: lo escrito vale y se guarda. Validación: no.
  const kept = retryable || outcome.conflict === true ? writeLiveDraft(opts.path, opts.initial, opts.value, opts.storage) : false;
  const flash = kept ? SAVE_FAILED_KEPT : retryable || !outcome.error ? SAVE_FAILED_LOST : `${outcome.error} ${SAVE_FAILED_LOST}`;
  return { status: "failed", retryable, error: retryable || !outcome.error ? SAVE_FAILED_INLINE : `${outcome.error} ${KEEP_NOTE}`, flash };
}
