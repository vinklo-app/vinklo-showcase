/** One writer per editor, including an explicit flush while debounce is pending. */
export function singleFlightSave(saveLatest: () => Promise<boolean>) {
  let inFlight: Promise<boolean> | null = null;
  return () => {
    if (!inFlight) inFlight = Promise.resolve().then(saveLatest).finally(() => { inFlight = null; });
    return inFlight;
  };
}

export interface CompanionDraft { key: string; id?: string; name: string; kid: boolean; byGuest: boolean; away: boolean }
interface StoredCompanion { id: string; name: string; isKid: boolean; byGuest: boolean; tableId: string | null }
export const companionDraftKey = (rows: readonly CompanionDraft[]) => JSON.stringify(rows.map(({ id, name, kid }) => ({ ...(id ? { id } : {}), name: name.trim(), kid })));

/** RPC returns input order. Attach new IDs by stable local key, preserving newer edits/removals. */
export function reconcileCompanionSave(snapshot: readonly CompanionDraft[], latest: readonly CompanionDraft[], stored: readonly StoredCompanion[]) {
  const byKey = new Map(snapshot.map((row, i) => [row.key, stored[i]]));
  return latest.map(row => {
    const saved = byKey.get(row.key);
    return saved ? { ...row, id: saved.id, byGuest: saved.byGuest, away: saved.tableId !== null } : row;
  });
}
