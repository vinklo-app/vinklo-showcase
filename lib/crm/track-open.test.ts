import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), serverClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.serverClient }));
import { isLinkPreviewAgent, supabaseSessionCookies, trackInvitationOpened } from "./track-open";

const token = "a".repeat(64);
const hash = createHash("sha256").update(token).digest("hex");
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const signal = (over: Partial<Parameters<typeof trackInvitationOpened>[0]> = {}) => ({ slug: "ana-y-luis", token, userAgent: iphone, sessionCookies: [], ...over });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: "ok", error: null });
  mocks.serverClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
});

describe("agentes de vista previa", () => {
  it.each([
    "WhatsApp/2.24.1 A", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Twitterbot/1.0)", "TelegramBot (like TwitterBot)", "Slackbot-LinkExpanding 1.0",
    "Mozilla/5.0 (compatible; Discordbot/2.0)", "Googlebot/2.1", "curl/8.4.0", "", null,
  ])("%j se ignora", (ua) => expect(isLinkPreviewAgent(ua)).toBe(true));
  it("navegadores reales cuentan", () => {
    expect(isLinkPreviewAgent(iphone)).toBe(false);
    expect(isLinkPreviewAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36")).toBe(false);
  });
  it("solo las cookies de sesión de Supabase", () => {
    expect(supabaseSessionCookies([
      { name: "sb-abc-auth-token.0", value: "x" }, { name: "sb-abc-auth-token.1", value: "y" }, { name: "_ga", value: "z" },
    ]).map((c) => c.name)).toEqual(["sb-abc-auth-token.0", "sb-abc-auth-token.1"]);
  });
});

describe("trackInvitationOpened", () => {
  it("invitado sin sesión: envía el hash (nunca el token) y sin visor", async () => {
    await trackInvitationOpened(signal());
    expect(mocks.rpc).toHaveBeenCalledWith("guest_invitation_opened", { p_slug: "ana-y-luis", p_token_hash: hash, p_viewer_id: null });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
    expect(mocks.serverClient).not.toHaveBeenCalled();
  });
  it("con sesión: pasa el usuario para que la RPC descarte la vista previa de la pareja", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "couple-1" } }, error: null });
    await trackInvitationOpened(signal({ sessionCookies: [{ name: "sb-abc-auth-token", value: "x" }] }));
    expect(mocks.rpc).toHaveBeenCalledWith("guest_invitation_opened", expect.objectContaining({ p_viewer_id: "couple-1" }));
  });
  it("sesión que no se puede resolver: no cuenta", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    await trackInvitationOpened(signal({ sessionCookies: [{ name: "sb-abc-auth-token", value: "x" }] }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("vista previa de WhatsApp, token o slug malformados: no llama a la base", async () => {
    await trackInvitationOpened(signal({ userAgent: "WhatsApp/2.24.1 A" }));
    await trackInvitationOpened(signal({ token: "corto" }));
    await trackInvitationOpened(signal({ slug: "Ana Y Luis" }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("nunca lanza", async () => {
    mocks.rpc.mockRejectedValue(new Error("red caída"));
    await expect(trackInvitationOpened(signal())).resolves.toBeUndefined();
  });
});
