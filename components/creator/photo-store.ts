/**
 * La foto elegida en el creador, guardada SOLO en este navegador (IndexedDB)
 * para que sobreviva al paso por /login (el enlace mágico suele abrir otra
 * pestaña y un `File` en memoria se perdería). Es un Blob ya reducido y sin
 * metadatos (`photo-prepare.ts`); nunca va a localStorage ni al borrador.
 *
 * Todo es tolerante a fallos: navegación privada, almacenamiento bloqueado o
 * IndexedDB ausente → se comporta como «no hay foto guardada».
 *
 * Se guardan los BYTES (ArrayBuffer), no el Blob: Safari en navegación
 * privada rechaza Blobs en IndexedDB («Error preparing Blob/File data…») y la
 * foto se perdía al volver atrás o recargar (backlog 13-oct, punto 8). Se
 * sigue leyendo la forma antigua ({ blob }) de quien ya tenía una guardada.
 */
import type { PreparedPhoto } from "./photo-prepare";

const DB_NAME = "vinklo-creator";
const STORE = "photo";
const KEY = "cover";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      // Se resuelve al CONFIRMARSE la transacción: un fallo de cuota o un
      // aborto llegan después del éxito de la petición y antes daban «guardado».
      let result: T | null = null;
      request.onsuccess = () => { result = (request.result as T) ?? null; };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { /* llega también onabort */ };
      tx.onabort = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** Lo que se guarda por foto: bytes + tipo + medidas (clonable en cualquier motor). */
export type StoredPhotoRecord = { bytes: ArrayBuffer; type: string; width: number; height: number };

export async function packPhoto(photo: PreparedPhoto): Promise<StoredPhotoRecord> {
  return { bytes: await photo.blob.arrayBuffer(), type: photo.blob.type || "image/jpeg", width: photo.width, height: photo.height };
}

/** Lee un registro guardado (bytes o, de antes, Blob). Cualquier otra cosa → null. */
export function unpackPhoto(value: unknown): PreparedPhoto | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { bytes?: unknown; type?: unknown; blob?: unknown; width?: unknown; height?: unknown };
  if (typeof record.width !== "number" || typeof record.height !== "number") return null;
  if (record.bytes instanceof ArrayBuffer && record.bytes.byteLength > 0) {
    return { blob: new Blob([record.bytes], { type: typeof record.type === "string" && record.type ? record.type : "image/jpeg" }), width: record.width, height: record.height };
  }
  if (record.blob instanceof Blob) return { blob: record.blob, width: record.width, height: record.height };
  return null;
}

export async function saveStoredPhoto(photo: PreparedPhoto): Promise<boolean> {
  let record: StoredPhotoRecord;
  try { record = await packPhoto(photo); } catch { return false; }
  const result = await run<IDBValidKey>("readwrite", (store) => store.put(record, KEY));
  return result !== null;
}

export async function loadStoredPhoto(): Promise<PreparedPhoto | null> {
  return unpackPhoto(await run<unknown>("readonly", (store) => store.get(KEY)));
}

export async function clearStoredPhoto(): Promise<void> {
  await run("readwrite", (store) => store.delete(KEY));
}

/**
 * «Más fotos» del creador (la galería que forma el mosaico de la portada), en
 * el mismo almacén con otra clave: sin subir la versión de la base de datos.
 */
const GALLERY_KEY = "gallery";

export async function saveStoredGallery(photos: readonly PreparedPhoto[]): Promise<boolean> {
  let value: StoredPhotoRecord[];
  try { value = await Promise.all(photos.map(packPhoto)); } catch { return false; }
  const result = await run<IDBValidKey>("readwrite", (store) => store.put(value, GALLERY_KEY));
  return result !== null;
}

export async function loadStoredGallery(): Promise<PreparedPhoto[]> {
  const value = await run<unknown>("readonly", (store) => store.get(GALLERY_KEY));
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const photo = unpackPhoto(item);
    return photo ? [photo] : [];
  });
}

export async function clearStoredGallery(): Promise<void> {
  await run("readwrite", (store) => store.delete(GALLERY_KEY));
}
