import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), rateLimit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, clientIp: async () => "1.2.3.4" }));
import { getCouplePhotoPreview, uploadCouplePhoto } from "./photo";

const weddingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Imagen real (decodificable) generada con sharp. */
async function image(width: number, height: number, format: "jpeg" | "png" | "webp" = "jpeg", alpha = false): Promise<Uint8Array> {
  const base = sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 40, b: 40, alpha: 0 } : { r: 180, g: 120, b: 90 } } });
  const out = format === "jpeg" ? base.jpeg() : format === "png" ? base.png() : base.webp();
  return new Uint8Array(await out.toBuffer());
}

/** JPEG con EXIF de cámara y GPS (Madrid) y orientación 6 (girada 90°). */
async function jpegWithGps(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: "Vinklo Test Camera", Model: "GPS-1" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 25/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "3/1 42/1 0/1" },
    })
    .toBuffer();
  return new Uint8Array(buffer);
}

/** Cabecera PNG válida con cuerpo basura: los magic bytes no bastan. */
function fakePng(width: number, height: number, size = 64): Uint8Array {
  const out = new Uint8Array(size);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(out.buffer).setUint32(16, width);
  new DataView(out.buffer).setUint32(20, height);
  return out;
}

function form(bytes: Uint8Array | null, name = "foto.png", type = "image/png"): FormData {
  const fd = new FormData();
  if (bytes) fd.set("file", new File([bytes as BlobPart], name, { type }));
  return fd;
}

let sign: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>>;
let publicUrl: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
let upload: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>>;
let sessionUpload: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>>;
let weddingQuery: { data: unknown; error: unknown };

function storage(fn: (...args: unknown[]) => unknown) {
  return {
    from: (bucket: string) => ({
      upload: (...args: unknown[]) => fn(bucket, ...args),
      createSignedUrl: (...args: unknown[]) => sign(bucket, ...args),
      getPublicUrl: (path: string) => { publicUrl(bucket, path); return { data: { publicUrl: `https://sb.example.co/storage/v1/object/public/${bucket}/${path}` } }; },
    }),
  };
}

function client(signedIn = true) {
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "user-a" } : null } }) },
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () => weddingQuery;
      return chain;
    },
    storage: storage((...args) => sessionUpload(...args)),
  };
}

function uploaded(): { bucket: string; path: string; bytes: Buffer; options: Record<string, unknown> } {
  const [bucket, path, bytes, options] = upload.mock.calls.at(-1)!;
  return { bucket: bucket as string, path: path as string, bytes: bytes as Buffer, options: options as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.example.co");
  sign = vi.fn(async (_bucket: unknown, path: unknown) => ({ data: { signedUrl: `https://sb.example.co/storage/v1/object/sign/wedding-photos-drafts/${String(path)}?token=t` }, error: null }));
  publicUrl = vi.fn();
  upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
  sessionUpload = vi.fn(async () => ({ data: null, error: { name: "StorageApiError", statusCode: "403" } }));
  weddingQuery = { data: { id: weddingId }, error: null };
  mocks.client.mockImplementation(async () => client());
  mocks.admin.mockImplementation(() => ({ storage: storage((...args) => upload(...args)) }));
  mocks.rateLimit.mockResolvedValue(true);
});

describe("uploadCouplePhoto", () => {
  it("H05: recodifica a JPEG en el bucket PRIVADO <wedding_id>/cover-<128 bits>.jpg; devuelve referencia estable, URL firmada y dimensiones", async () => {
    const result = await uploadCouplePhoto(form(await image(1200, 800, "png"), "foto.jpg", "image/jpeg"));
    expect(result).toMatchObject({ ok: true, width: 1200, height: 800 });
    expect(upload).toHaveBeenCalledTimes(1);
    // Escribe el servidor (service_role), nunca la sesión del navegador.
    expect(sessionUpload).not.toHaveBeenCalled();
    const { bucket, path, bytes, options } = uploaded();
    expect(bucket).toBe("wedding-photos-drafts");
    expect(path).toMatch(new RegExp(`^${weddingId}/cover-[0-9a-f]{32}\\.jpg$`));
    expect(options).toMatchObject({ contentType: "image/jpeg", cacheControl: "3600", upsert: false });
    expect((await sharp(bytes).metadata()).format).toBe("jpeg");
    if (!result.ok) throw new Error("expected ok");
    // Lo que se guarda en el borrador: estable, no servible sin token.
    expect(result.url).toBe(`https://sb.example.co/storage/v1/object/authenticated/wedding-photos-drafts/${path}`);
    // Lo que enseña el editor: URL firmada de 1 h del mismo objeto.
    expect(sign).toHaveBeenCalledWith("wedding-photos-drafts", path, 3600);
    expect(result.previewUrl).toContain(`/object/sign/wedding-photos-drafts/${path}`);
    expect(result.previewExpiresAt).toBeGreaterThan(Date.now());
    // Nunca una URL pública en la subida.
    expect(publicUrl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("/object/public/");
    expect(mocks.rateLimit).toHaveBeenCalledWith("photo", "user-a", 80, 3600);
  });

  it("H06: una subida directa con EXIF/GPS se sirve sin metadatos y con la orientación aplicada", async () => {
    const original = await jpegWithGps(300, 200);
    const before = await sharp(original).metadata();
    expect(before.exif).toBeDefined(); // el fixture sí lleva GPS y orientación
    expect(before.orientation).toBe(6);
    expect(before.exif!.includes(Buffer.from("Vinklo Test Camera"))).toBe(true);
    const result = await uploadCouplePhoto(form(original, "foto.jpg", "image/jpeg"));
    expect(result).toMatchObject({ ok: true, width: 200, height: 300 }); // orientación 6 → girada
    const after = await sharp(uploaded().bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(uploaded().bytes.includes(Buffer.from("Vinklo Test Camera"))).toBe(false);
  });

  it("reduce a 2400 px de lado largo y aplana la transparencia en blanco", async () => {
    const result = await uploadCouplePhoto(form(await image(3000, 1500, "webp")));
    expect(result).toMatchObject({ ok: true, width: 2400, height: 1200 });
    const transparent = await uploadCouplePhoto(form(await image(10, 10, "png", true)));
    expect(transparent).toMatchObject({ ok: true, width: 10, height: 10 });
    const { data } = await sharp(uploaded().bytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
  });

  it("rutas aleatorias distintas en cada subida", async () => {
    const photo = await image(10, 10);
    await uploadCouplePhoto(form(photo));
    await uploadCouplePhoto(form(photo));
    expect(upload.mock.calls[0]![1]).not.toBe(upload.mock.calls[1]![1]);
  });

  it("sin archivo, vacío o de más de 4 MB no llega a Storage", async () => {
    expect(await uploadCouplePhoto(form(null))).toEqual({ ok: false, error: "Elegid una foto para subir." });
    expect(await uploadCouplePhoto(form(new Uint8Array(0)))).toEqual({ ok: false, error: "Elegid una foto para subir." });
    const big = await uploadCouplePhoto(form(fakePng(10, 10, 4 * 1024 * 1024 + 1)));
    expect(big).toMatchObject({ ok: false, error: expect.stringContaining("4 MB") });
    expect(upload).not.toHaveBeenCalled();
  });

  it("rechaza por contenido lo que no es JPEG/PNG/WebP aunque diga image/png (SVG, GIF, HTML)", async () => {
    for (const text of ["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "GIF89a\u0001\u0000\u0001\u0000", "<html></html>"]) {
      const result = await uploadCouplePhoto(form(new TextEncoder().encode(text), "foto.png", "image/png"));
      expect(result).toEqual({ ok: false, error: "Ese archivo no es una foto válida. Usad JPG, PNG o WebP." });
    }
    // Un GIF real que sharp sabría leer tampoco entra.
    const gif = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).gif().toBuffer());
    expect(await uploadCouplePhoto(form(gif, "foto.jpg", "image/jpeg"))).toMatchObject({ ok: false, error: expect.stringContaining("JPG, PNG o WebP") });
    expect(upload).not.toHaveBeenCalled();
  });

  it("magic bytes correctos con cuerpo que no decodifica: rechazado", async () => {
    expect(await uploadCouplePhoto(form(fakePng(1200, 800, 2048)))).toEqual({ ok: false, error: "Ese archivo no es una foto válida. Usad JPG, PNG o WebP." });
    const jpeg = await image(50, 50);
    expect(await uploadCouplePhoto(form(jpeg.slice(0, 40), "foto.jpg", "image/jpeg"))).toMatchObject({ ok: false });
    expect(upload).not.toHaveBeenCalled();
  });

  it("rechaza más de 10 000 px por lado o más de 40 Mpx en total", async () => {
    expect(await uploadCouplePhoto(form(await image(10_001, 8, "png")))).toMatchObject({ ok: false, error: expect.stringContaining("10 000") });
    expect(await uploadCouplePhoto(form(await image(7000, 6000, "png")))).toMatchObject({ ok: false, error: expect.stringContaining("40 megapíxeles") });
    expect(upload).not.toHaveBeenCalled();
  });

  it("sin sesión o sin boda no sube", async () => {
    const photo = await image(10, 10);
    mocks.client.mockImplementation(async () => client(false));
    expect(await uploadCouplePhoto(form(photo))).toEqual({ ok: false, error: "La sesión ha caducado. Volved a entrar." });
    mocks.client.mockImplementation(async () => client());
    weddingQuery = { data: null, error: null };
    expect(await uploadCouplePhoto(form(photo))).toMatchObject({ ok: false, error: expect.stringContaining("boda") });
    expect(upload).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("límite de uso antes de decodificar y fallo de Storage sin detalles internos", async () => {
    const photo = await image(10, 10);
    mocks.rateLimit.mockResolvedValueOnce(false);
    expect(await uploadCouplePhoto(form(photo))).toMatchObject({ ok: false, error: expect.stringContaining("Esperad") });
    upload.mockResolvedValueOnce({ data: null, error: { name: "StorageApiError", statusCode: "403", message: "new row violates row-level security policy" } });
    const failed = await uploadCouplePhoto(form(photo));
    expect(failed).toEqual({ ok: false, error: "No hemos podido subir la foto. Probad de nuevo." });
  });
});

describe("getCouplePhotoPreview", () => {
  const own = `https://sb.example.co/storage/v1/object/authenticated/wedding-photos-drafts/${weddingId}/cover-${"a".repeat(32)}.jpg`;

  it("firma (1 h, service_role) solo la referencia canónica de la boda de la sesión", async () => {
    const result = await getCouplePhotoPreview(own);
    expect(result).toMatchObject({ ok: true, url: expect.stringContaining("/object/sign/wedding-photos-drafts/") });
    expect(sign).toHaveBeenCalledWith("wedding-photos-drafts", `${weddingId}/cover-${"a".repeat(32)}.jpg`, 3600);
  });

  it("nunca firma la foto de otra boda, otra forma de URL u otro host", async () => {
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    for (const url of [
      own.replace(weddingId, other),
      own.replace("/authenticated/", "/public/"),
      own.replace("sb.example.co", "evil.example.com"),
      own.replace(".jpg", ".jpg/../../x.jpg"),
      `${own}?download=1`,
      own.replace("wedding-photos-drafts", "wedding-photos"),
      "not a url",
    ]) {
      expect(await getCouplePhotoPreview(url)).toEqual({ ok: false });
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it("sin sesión o sin boda no firma", async () => {
    mocks.client.mockImplementation(async () => client(false));
    expect(await getCouplePhotoPreview(own)).toEqual({ ok: false });
    mocks.client.mockImplementation(async () => client());
    weddingQuery = { data: null, error: null };
    expect(await getCouplePhotoPreview(own)).toEqual({ ok: false });
    expect(sign).not.toHaveBeenCalled();
  });

  it("si Storage no firma, falla sin detalles", async () => {
    sign.mockResolvedValueOnce({ data: null, error: { name: "StorageApiError", statusCode: "404", message: "Object not found" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getCouplePhotoPreview(own)).toEqual({ ok: false });
  });
});
