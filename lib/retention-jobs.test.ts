import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), sentry: vi.fn(), emails: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.sentry }));
vi.mock("@/lib/emails/send", () => ({ sendEmail: mocks.send }));
vi.mock("@/lib/data/wedding-member-emails", () => ({ weddingMemberEmails: mocks.emails }));
import { formatRetentionDate, purgeOldEvents, RETENTION_NOTICE_SUBJECT, runRetentionJobs, sendRetentionNotices } from "./retention-jobs";
import { retentionNoticeHtml } from "@/lib/emails/templates";

type Reply = { data: unknown; error: unknown };
let rpcCalls: Array<{ name: string; args: unknown }>;
function admin(replies: Record<string, Reply[]>) {
  return {
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return (replies[name] ?? []).shift() ?? { data: null, error: null };
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls = [];
  mocks.send.mockResolvedValue({ skipped: false, id: "x" });
});

describe("sendRetentionNotices", () => {
  it("escribe a TODOS los miembros y marca el aviso una vez", async () => {
    mocks.emails.mockResolvedValue(["ana@ejemplo.es", "luis@ejemplo.es"]);
    const n = await sendRetentionNotices(
      admin({ retention_notice_candidates: [{ data: [{ wedding_id: "w1", anonymise_on: "2027-07-15" }], error: null }], mark_retention_notice: [{ data: true, error: null }] }),
      "2027-06-15",
      "https://vinklo.es",
    );
    expect(n).toBe(1);
    expect(mocks.send.mock.calls.map((c) => c[0].to)).toEqual(["ana@ejemplo.es", "luis@ejemplo.es"]);
    expect(mocks.send.mock.calls[0][0].html).toContain("15 de julio de 2027");
    expect(rpcCalls.map((c) => c.name)).toEqual(["retention_notice_candidates", "mark_retention_notice"]);
    expect(rpcCalls[0].args).toEqual({ p_today: "2027-06-15", p_limit: 25 });
  });

  it("sin RESEND_API_KEY (envío saltado) no marca: se reintenta mañana", async () => {
    mocks.emails.mockResolvedValue(["ana@ejemplo.es"]);
    mocks.send.mockResolvedValue({ skipped: true });
    const n = await sendRetentionNotices(admin({ retention_notice_candidates: [{ data: [{ wedding_id: "w1", anonymise_on: "2027-07-15" }], error: null }] }), "2027-06-15", "https://vinklo.es");
    expect(n).toBe(0);
    expect(rpcCalls.map((c) => c.name)).not.toContain("mark_retention_notice");
  });

  it("si leer los miembros falla, no marca (no se anonimiza sin aviso)", async () => {
    mocks.emails.mockRejectedValue(new Error("wedding_members:500"));
    const n = await sendRetentionNotices(admin({ retention_notice_candidates: [{ data: [{ wedding_id: "w1", anonymise_on: "2027-07-15" }], error: null }] }), "2027-06-15", "https://vinklo.es");
    expect(n).toBe(0);
    expect(rpcCalls.map((c) => c.name)).not.toContain("mark_retention_notice");
    expect(mocks.sentry).toHaveBeenCalled();
  });

  it("boda sin nadie a quien escribir: se marca para no bloquear la anonimización", async () => {
    mocks.emails.mockResolvedValue([]);
    const n = await sendRetentionNotices(admin({ retention_notice_candidates: [{ data: [{ wedding_id: "w1", anonymise_on: "2027-07-15" }], error: null }], mark_retention_notice: [{ data: true, error: null }] }), "2027-06-15", "https://vinklo.es");
    expect(n).toBe(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sin la migración: aviso a Sentry sin datos personales y 0", async () => {
    const n = await sendRetentionNotices(admin({ retention_notice_candidates: [{ data: null, error: { code: "PGRST202" } }] }), "2027-06-15", "https://vinklo.es");
    expect(n).toBe(0);
    expect(mocks.sentry).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ extra: { code: "PGRST202" } }));
  });
});

describe("purgeOldEvents y runRetentionJobs", () => {
  it("purga por lotes hasta que un lote sale incompleto", async () => {
    const n = await purgeOldEvents(admin({ purge_old_events: [{ data: 10000, error: null }, { data: 3, error: null }] }));
    expect(n).toBe(10003);
    expect(rpcCalls.filter((c) => c.name === "purge_old_events")).toHaveLength(2);
  });

  it("los tres pasos corren aunque uno falle", async () => {
    mocks.emails.mockResolvedValue([]);
    const result = await runRetentionJobs(
      admin({
        retention_notice_candidates: [{ data: null, error: { code: "PGRST202" } }],
        anonymise_expired_guests: [{ data: 2, error: null }],
        purge_old_events: [{ data: 5, error: null }],
      }),
      "2027-06-15",
      "https://vinklo.es",
    );
    expect(result).toEqual({ notices: 0, anonymised: 2, eventsPurged: 5 });
    expect(rpcCalls.find((c) => c.name === "anonymise_expired_guests")?.args).toEqual({ p_today: "2027-06-15", p_limit: 200 });
  });
});

describe("plantilla y fechas", () => {
  it("formatea la fecha civil sin desfase de zona", () => {
    expect(formatRetentionDate("2027-01-01")).toBe("1 de enero de 2027");
    expect(formatRetentionDate("2027-07-15")).toBe("15 de julio de 2027");
  });

  it("el correo usa el botón arcilla, escapa y no lleva datos de invitados", () => {
    const html = retentionNoticeHtml({ anonymiseOnFormatted: "15 de julio de 2027<script>", panelUrl: "https://vinklo.es/panel/invitados", giftsUrl: "https://vinklo.es/panel#regalos", privacyUrl: "https://vinklo.es/privacidad" });
    expect(html).toContain("background-color:#573B62");
    expect(html).toContain("15 de julio de 2027&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("https://vinklo.es/panel/invitados");
  });

  it("avisa de invitados Y regalos, con un botón para cada descarga (20261026100000)", () => {
    const html = retentionNoticeHtml({ anonymiseOnFormatted: "15 de julio de 2027", panelUrl: "https://vinklo.es/panel/invitados", giftsUrl: "https://vinklo.es/panel#regalos", privacyUrl: "https://vinklo.es/privacidad" });
    const text = html.replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í").replace(/&ntilde;/g, "ñ");
    expect(text).toContain("Dentro de 30 días");
    expect(text).toContain("borraremos los datos personales de vuestros invitados");
    expect(text).toContain("de los regalos que habéis anotado quién os hizo cada uno");
    expect(text).toContain("Conservaremos el tipo, el importe, la fecha y si lo agradecisteis");
    expect(html).toContain('href="https://vinklo.es/panel/invitados"');
    expect(html).toContain('href="https://vinklo.es/panel#regalos"');
    expect(html).toContain(">Descargar la lista de invitados</a>");
    expect(html).toContain(">Descargar regalos y agradecimientos</a>");
    expect(text).toContain("entrar con vuestra cuenta");
  });

  it("el cron enlaza a las dos descargas del panel y avisa de los regalos en el asunto", async () => {
    mocks.emails.mockResolvedValue(["ana@ejemplo.es"]);
    await sendRetentionNotices(
      admin({ retention_notice_candidates: [{ data: [{ wedding_id: "w1", anonymise_on: "2027-07-15" }], error: null }], mark_retention_notice: [{ data: true, error: null }] }),
      "2027-06-15",
      "https://vinklo.es",
    );
    const sent = mocks.send.mock.calls[0][0];
    expect(sent.subject).toBe(RETENTION_NOTICE_SUBJECT);
    expect(sent.subject).toContain("regalos");
    expect(sent.html).toContain('href="https://vinklo.es/panel/invitados"');
    expect(sent.html).toContain('href="https://vinklo.es/panel#regalos"');
  });
});
