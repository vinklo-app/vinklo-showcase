import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(), trackView: vi.fn(), trackOpened: vi.fn(), headers: vi.fn(), cookies: vi.fn(), previous: vi.fn(), site: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/product-scope", () => ({ RSVP_MVP: true }));
vi.mock("@/components/guest/contribution-envelope", () => ({ ContributionEnvelope: () => null }));
vi.mock("@/components/invitation/renderer", () => ({ InvitationRenderer: () => null }));
vi.mock("@/components/invitation/format", () => ({ coupleInitials: () => "AL" }));
vi.mock("@/lib/data/site-public", () => ({ getPublicSiteResult: mocks.site }));
vi.mock("./guest-unavailable", () => ({ GuestUnavailable: () => null }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: async () => "1.2.3.4" }));
vi.mock("@/lib/track", () => ({ trackGuestPageView: mocks.trackView }));
vi.mock("@/lib/crm/track-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crm/track-open")>()),
  trackInvitationOpened: mocks.trackOpened,
}));
vi.mock("./wedding-public", () => ({ getWeddingPublic: async () => null, getWeddingRsvpDates: async () => null, getGuestRsvpCurrent: mocks.previous }));
import GuestPage, { generateMetadata } from "./page";
import { GuestUnavailable } from "./guest-unavailable";

const token = "b".repeat(64);
const render = (invitacion?: string) => GuestPage({ params: Promise.resolve({ slug: "ana-y-luis" }), searchParams: Promise.resolve({ invitacion }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ "user-agent": "Mozilla/5.0 (iPhone)" }));
  mocks.cookies.mockResolvedValue({ getAll: () => [{ name: "sb-x-auth-token", value: "s" }, { name: "_ga", value: "1" }] });
  mocks.previous.mockResolvedValue(null);
  mocks.site.mockResolvedValue({ status: "ok", site: { slug: "ana-y-luis", document: {}, plan: "free" } });
});

describe("página pública: fallo de lectura ≠ boda no encontrada (perf P1-3)", () => {
  it("fallo de lectura: vista «Reintentar», sin 404, sin leer el enlace ni contar la visita", async () => {
    mocks.site.mockResolvedValue({ status: "unavailable" });
    const element = (await render(token)) as { type: unknown };
    expect(element.type).toBe(GuestUnavailable);
    expect(mocks.previous).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("no encontrada: 404 como siempre", async () => {
    mocks.site.mockResolvedValue({ status: "not_found" });
    await expect(render(token)).rejects.toThrow("notFound");
  });
  it("metadata: con el fallo no dice «Boda no encontrada»", async () => {
    mocks.site.mockResolvedValue({ status: "unavailable" });
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "ana-y-luis" }), searchParams: Promise.resolve({}) });
    expect(metadata.title).toBe("Invitación no disponible ahora mismo");
    mocks.site.mockResolvedValue({ status: "not_found" });
    expect((await generateMetadata({ params: Promise.resolve({ slug: "ana-y-luis" }), searchParams: Promise.resolve({}) })).title).toBe("Boda no encontrada");
  });
});

describe("página pública: tarjeta de WhatsApp honesta (#10)", () => {
  const cover = { id: "portada", type: "cover", enabled: true, props: { partnerName1: "Ana", partnerName2: "Luis" } };
  const meta = (invitacion?: string) => generateMetadata({ params: Promise.resolve({ slug: "ana-y-luis" }), searchParams: Promise.resolve({ invitacion }) });
  beforeEach(() => {
    mocks.site.mockResolvedValue({ status: "ok", site: { slug: "ana-y-luis", document: { scenes: [cover] }, plan: "free", revisionId: "r1" } });
  });
  it("enlace general: solo «consulta los detalles», sin prometer confirmar", async () => {
    const metadata = await meta();
    expect(metadata.description).toBe("Consulta los detalles de la boda de Ana y Luis.");
    expect(mocks.previous).not.toHaveBeenCalled();
  });
  it("enlace personal válido: promete confirmar", async () => {
    mocks.previous.mockResolvedValue({ status: "valid", current: { previous: null, maxCompanions: null } });
    expect((await meta(token)).description).toContain("confirma tu asistencia a Ana y Luis sin crear una cuenta");
  });
  it.each([["invalid"], ["closed"], ["error"]])("enlace personal %s: no promete confirmar", async (status) => {
    mocks.previous.mockResolvedValue({ status });
    expect((await meta(token)).description).toBe("Consulta los detalles de la boda de Ana y Luis.");
  });
});

describe("página pública: apertura del enlace personal", () => {
  it("con token válido programa la señal en after() con UA y solo cookies de sesión", async () => {
    await render(token);
    expect(mocks.after).toHaveBeenCalledTimes(2);
    expect(mocks.trackOpened).not.toHaveBeenCalled(); // nada antes de responder
    for (const [task] of mocks.after.mock.calls) await task();
    expect(mocks.trackOpened).toHaveBeenCalledWith({
      slug: "ana-y-luis", token, userAgent: "Mozilla/5.0 (iPhone)", sessionCookies: [{ name: "sb-x-auth-token", value: "s" }],
    });
  });
  it.each([[undefined], ["corto"], ["Z".repeat(64)]])("sin token o malformado (%j): solo la visita", async (value) => {
    await render(value);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.headers).not.toHaveBeenCalled();
  });
  it("si leer cabeceras falla, la página se sirve igual", async () => {
    mocks.headers.mockRejectedValue(new Error("boom"));
    await expect(render(token)).resolves.toBeTruthy();
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });
});

describe("página pública: respuesta anterior (§2.5)", () => {
  const previous = { status: "si", companions: 1, notes: "", answers: {}, respondedAt: null };
  it("con enlace personal lee la respuesta anterior y el tope, y los pasa al formulario", async () => {
    mocks.previous.mockResolvedValue({ status: "valid", current: { previous, maxCompanions: 2 } });
    const element = (await render(token)) as { props: { rsvp: { previous: unknown; maxCompanions: unknown; linkInvalid: unknown } } };
    expect(mocks.previous).toHaveBeenCalledWith("ana-y-luis", token);
    expect(element.props.rsvp.previous).toEqual(previous);
    expect(element.props.rsvp.maxCompanions).toBe(2);
    expect(element.props.rsvp.linkInvalid).toBe(false);
  });
  it("saludo (ítem 11): al renderer solo llega el nombre de pila, nunca el nombre completo", async () => {
    mocks.previous.mockResolvedValue({ status: "valid", current: { previous: null, maxCompanions: null, guestName: "Carmen Ruiz Pardo" } });
    const element = (await render(token)) as { props: { rsvp: { guestName: unknown } } };
    expect(element.props.rsvp.guestName).toBe("Carmen");
    expect(JSON.stringify(element.props)).not.toContain("Ruiz");
  });
  it("sin nombre (o sin la migración) no hay saludo", async () => {
    mocks.previous.mockResolvedValue({ status: "valid", current: { previous: null, maxCompanions: null, guestName: null } });
    const element = (await render(token)) as { props: { rsvp: { guestName: unknown } } };
    expect(element.props.rsvp.guestName).toBeNull();
  });
  it("sin token no se lee nada ni hay aviso de enlace", async () => {
    const element = (await render(undefined)) as { props: { rsvp: { previous: unknown; linkInvalid: unknown } } };
    expect(mocks.previous).not.toHaveBeenCalled();
    expect(element.props.rsvp.previous).toBeNull();
    expect(element.props.rsvp.linkInvalid).toBe(false);
  });
});

describe("página pública: enlace personal no válido", () => {
  it("revocado (la RPC dice NULL): aviso en el RSVP, sin respuesta anterior; la invitación se pinta igual", async () => {
    mocks.previous.mockResolvedValue({ status: "invalid" });
    const element = (await render(token)) as { props: { document: unknown; rsvp: { previous: unknown; linkInvalid: unknown } } };
    expect(element.props.rsvp.linkInvalid).toBe(true);
    expect(element.props.rsvp.previous).toBeNull();
    expect(element.props.document).toEqual({});
  });
  it("mal copiado (no tiene forma de token): aviso sin consultar", async () => {
    const element = (await render("corto")) as { props: { rsvp: { linkInvalid: unknown } } };
    expect(mocks.previous).not.toHaveBeenCalled();
    expect(element.props.rsvp.linkInvalid).toBe(true);
  });
  it("cerrado según la RPC: aviso de enlace cerrado, sin formulario ni respuesta anterior", async () => {
    mocks.previous.mockResolvedValue({ status: "closed" });
    const element = (await render(token)) as { props: { rsvp: { previous: unknown; linkInvalid: unknown; linkClosed: unknown } } };
    expect(element.props.rsvp.linkClosed).toBe(true);
    expect(element.props.rsvp.linkInvalid).toBe(false);
    expect(element.props.rsvp.previous).toBeNull();
  });
  it("fallo de lectura: bloquea el formulario para no sustituir datos previos por valores vacíos", async () => {
    mocks.previous.mockResolvedValue({ status: "error" });
    const element = (await render(token)) as { props: { rsvp: { previous: unknown; linkInvalid: unknown; readError: unknown } } };
    expect(element.props.rsvp.linkInvalid).toBe(false);
    expect(element.props.rsvp.previous).toBeNull();
    expect(element.props.rsvp.readError).toBe(true);
  });
});
