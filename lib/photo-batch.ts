/**
 * Subida de varias fotos a la vez (panel y creador), sin DOM ni red: solo el
 * reparto. Lo usan `PhotoRow` (galería y capítulos) y `finishCreatedWedding`.
 *
 *  - `mapWithConcurrency`: como mucho `limit` trabajos en vuelo (2 en el móvil:
 *    más no acelera una subida por datos y multiplica la memoria del canvas),
 *    resultados en el ORDEN DE SELECCIÓN aunque terminen desordenados, y un
 *    fallo nunca tumba a los demás.
 *  - `takeSlots`: recorta la selección a los huecos que quedan (máx. por fila).
 *  - `orderedCommitter`: entrega los resultados en orden a medida que se
 *    completa el prefijo, para ir guardando sin desordenar la galería.
 */

/** Fotos subiendo a la vez. */
export const PHOTO_UPLOAD_CONCURRENCY = 2;

export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (result: Settled<R>, index: number) => void,
): Promise<Settled<R>[]> {
  const results: Settled<R>[] = new Array(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      let result: Settled<R>;
      try {
        result = { ok: true, value: await worker(items[index]!, index) };
      } catch (error) {
        result = { ok: false, error };
      }
      results[index] = result;
      try { onSettled?.(result, index); } catch { /* un aviso de la UI no para la cola */ }
    }
  }
  await Promise.all(Array.from({ length: items.length === 0 ? 0 : lanes }, lane));
  return results;
}

/** Cuántas de las elegidas caben (`take`) y cuántas se quedan fuera (`skipped`). */
export function takeSlots<T>(selected: readonly T[], used: number, max: number): { take: T[]; skipped: number } {
  const free = Math.max(0, max - Math.max(0, used));
  const take = selected.slice(0, free);
  return { take, skipped: selected.length - take.length };
}

/**
 * Devuelve `settle(index, value)`: cuando el prefijo 0..k ya está completo,
 * llama a `flush` con esos valores en orden (una vez cada uno). Así la foto 2
 * no entra antes que la 1 aunque termine antes.
 */
export function orderedCommitter<R>(count: number, flush: (values: R[], from: number) => void): (index: number, value: R) => void {
  const done: Array<{ value: R } | undefined> = new Array(count);
  let cursor = 0;
  return (index, value) => {
    if (index < 0 || index >= count || done[index]) return;
    done[index] = { value };
    const from = cursor;
    const ready: R[] = [];
    while (cursor < count && done[cursor]) ready.push(done[cursor++]!.value);
    if (ready.length > 0) flush(ready, from);
  };
}
