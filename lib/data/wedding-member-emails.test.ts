import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { weddingMemberEmails } from "./wedding-member-emails";

type Reply = { data: unknown; error: unknown };

function admin(replies: Record<string, Reply[]>, users: Record<string, string | Error | null>) {
  const filters: Array<[string, unknown]> = [];
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.eq = (col: string, value: unknown) => { filters.push([col, value]); return self; };
    self.is = (col: string, value: unknown) => { filters.push([`is:${col}`, value]); return self; };
    const next = () => (replies[table] ?? []).shift() ?? { data: null, error: null };
    self.maybeSingle = async () => next();
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(next()).then(resolve);
    return self;
  };
  const client = {
    from: chain,
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const user = users[id];
          if (user instanceof Error) return { data: { user: null }, error: user };
          return { data: { user: user ? { email: user } : null }, error: null };
        },
      },
    },
  };
  return { client: client as never, filters };
}

describe("weddingMemberEmails", () => {
  it("devuelve el correo de todos los miembros, sin duplicados", async () => {
    const { client } = admin({ wedding_members: [{ data: [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u1" }], error: null }] }, { u1: "ana@ejemplo.es", u2: "luis@ejemplo.es" });
    expect(await weddingMemberEmails(client, "w1")).toEqual(["ana@ejemplo.es", "luis@ejemplo.es"]);
  });

  it("los avisos de servicio no filtran por digest_opt_out; el resumen sí", async () => {
    const service = admin({ wedding_members: [{ data: [{ user_id: "u1" }], error: null }] }, { u1: "ana@ejemplo.es" });
    await weddingMemberEmails(service.client, "w1");
    expect(service.filters.map(([col]) => col)).not.toContain("digest_opt_out");
    const digest = admin({ wedding_members: [{ data: [], error: null }] }, {});
    expect(await weddingMemberEmails(digest.client, "w1", { respectDigestOptOut: true })).toEqual([]);
    expect(digest.filters).toContainEqual(["digest_opt_out", false]);
  });

  it("sin la tabla de miembros cae al dueño original", async () => {
    const { client, filters } = admin({ wedding_members: [{ data: null, error: { code: "PGRST205" } }], weddings: [{ data: { couple_id: "u1" }, error: null }] }, { u1: "ana@ejemplo.es" });
    expect(await weddingMemberEmails(client, "w1")).toEqual(["ana@ejemplo.es"]);
    // Una boda marcada para borrar (P2-5) no tiene destinatarios.
    expect(filters).toContainEqual(["is:deleted_at", null]);
  });

  it("lanza si la consulta falla o ningún usuario se puede leer", async () => {
    const broken = admin({ wedding_members: [{ data: null, error: { code: "57014" } }] }, {});
    await expect(weddingMemberEmails(broken.client, "w1")).rejects.toThrow();
    const unreadable = admin({ wedding_members: [{ data: [{ user_id: "u1" }], error: null }] }, { u1: new Error("500") });
    await expect(weddingMemberEmails(unreadable.client, "w1")).rejects.toThrow();
  });

  it("si un usuario no se puede leer, avisa a los demás", async () => {
    const { client } = admin({ wedding_members: [{ data: [{ user_id: "u1" }, { user_id: "u2" }], error: null }] }, { u1: new Error("500"), u2: "luis@ejemplo.es" });
    expect(await weddingMemberEmails(client, "w1")).toEqual(["luis@ejemplo.es"]);
  });
});
