import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { addGuest, updateGuest, deleteGuest, createGuestInvitation, confirmInvitationSent, createReminderLink, bulkCreateGuests, listGuestContacts, setGuestsGroup, searchGuestDirectory, setGuestsTags, setGuestsSide, setGuestsMaxCompanions, renameTag, deleteGuests, previewGuestsDeletion, setGuestsStatus, listGuestsInFilter } from "./guests";
import { MAX_GUEST_BULK } from "@/lib/crm/guest-bulk";
import { MAX_GROUP_MOVE } from "@/lib/crm/groups";
import { MAX_IMPORT_ROWS } from "./guest-import";

const weddingId = "11111111-1111-4111-8111-111111111111";
const guestId = "22222222-2222-4222-8222-222222222222";
const input = { name: "Ana", phone: "", status: "si" as const, companions: 2, notes: "" };
type Reply = { data: unknown; error: unknown };
let calls: Array<{ table: string; method: string; args: unknown[] }>;
function database(replies: Reply[], signedIn = true) {
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "owner-a" } : null } }) },
    rpc(name: string, args: unknown) {
      calls.push({ table: "rpc", method: name, args: [args] });
      return Promise.resolve(replies.shift() ?? { data: null, error: null });
    },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit", "insert", "update", "delete", "not", "in", "ilike", "order", "is"]) {
        chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      }
      chain.maybeSingle = async () => replies.shift() ?? { data: null, error: null };
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(replies.shift() ?? { data: null, error: null }).then(resolve);
      return chain;
    },
  };
}
const owner = () => ({ data: { id: weddingId, slug: "ana-y-luis" }, error: null });
beforeEach(() => { vi.clearAllMocks(); calls = []; });

describe("autorización y persistencia del CRM", () => {
  it("rechaza todas las operaciones sin sesión antes de consultar tablas", async () => {
    mocks.client.mockResolvedValue(database([], false));
    for (const action of [() => addGuest(input), () => updateGuest(guestId, input), () => deleteGuest(guestId), () => createGuestInvitation(guestId), () => confirmInvitationSent(guestId)]) {
      expect((await action()).ok).toBe(false);
    }
    expect(calls).toEqual([]);
  });
  it("rechaza datos inválidos antes de crear un cliente", async () => {
    expect((await addGuest({ ...input, name: "" })).ok).toBe(false);
    expect((await updateGuest("invalid", input)).ok).toBe(false);
    expect((await deleteGuest("invalid")).ok).toBe(false);
    expect((await createGuestInvitation("invalid")).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("añade a la boda del usuario y elimina acompañantes si no asiste", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    expect(await addGuest({ ...input, status: "no" })).toEqual({ ok: true });
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["wedding_members.user_id", "owner-a"] });
    expect(calls.find(c => c.method === "insert")?.args[0]).toMatchObject({ wedding_id: weddingId, rsvp_status: "no", rsvp_companions: 0 });
  });
  it.each(["update", "delete", "not"])("%s exige que el invitado pertenezca a la boda y no informa éxito sin fila", async operation => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    const result = operation === "update" ? await updateGuest(guestId, input) : await deleteGuest(guestId);
    expect(result.ok).toBe(false);
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["id", guestId] });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  const issued = () => ({ data: [{ token_id: "33333333-3333-4333-8333-333333333333" }], error: null });
  const hashOf = (path: string) => createHash("sha256").update(new URL(path, "https://example.test").searchParams.get("invitacion")!).digest("hex");
  it("regenerar emite enlaces distintos y persiste solo el hash vía la RPC en modo regenerate", async () => {
    mocks.client.mockImplementation(async () => database([owner(), issued()]));
    const first = await createGuestInvitation(guestId);
    const second = await createGuestInvitation(guestId);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Invitation failed");
    const token = new URL(first.path, "https://example.test").searchParams.get("invitacion")!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(first.path).not.toEqual(second.path);
    const rpcs = calls.filter(c => c.table === "rpc");
    expect(rpcs.map(c => c.method)).toEqual(["issue_guest_token", "issue_guest_token"]);
    expect(rpcs[0].args[0]).toEqual({ p_guest_id: guestId, p_token_hash: hashOf(first.path), p_mode: "regenerate" });
    expect(JSON.stringify(calls)).not.toContain(token);
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("no entrega enlaces si la RPC no emite (ajeno), falla o falta la migración", async () => {
    for (const reply of [{ data: [], error: null }, { data: null, error: { code: "XX000" } }, { data: null, error: { code: "PGRST202" } }]) {
      mocks.client.mockResolvedValue(database([owner(), reply]));
      const result = await createGuestInvitation(guestId);
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("path");
    }
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { code: "PGRST202" } }]));
    expect(await createGuestInvitation(guestId)).toEqual({ ok: false, error: expect.stringContaining("migración") });
  });
  it("un fallo de persistencia no muestra éxito ni refresca el panel", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { message: "private database detail" } }]));
    const result = await addGuest(input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private database detail");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("confirma el envío solo para una invitación de la boda propia", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { id: guestId }, error: null }]));
    expect(await confirmInvitationSent(guestId)).toEqual({ ok: true });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "not", args: ["invitation_prepared_at", "is", null] });
    expect(calls.find(c => c.method === "update")?.args[0]).toMatchObject({ invitation_sent_at: expect.any(String) });
  });
  it("no confirma envío sin invitación existente ni para una fila ajena", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    expect((await confirmInvitationSent(guestId)).ok).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });


  it("el enlace del recordatorio AÑADE un token (modo reminder) sin tocar el estado de envío", async () => {
    mocks.client.mockResolvedValue(database([owner(), issued()]));
    const result = await createReminderLink(guestId);
    if (!result.ok) throw new Error("Reminder link failed");
    expect(new URL(result.path, "https://example.test").searchParams.get("invitacion")).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.find(c => c.table === "rpc")?.args[0]).toEqual({ p_guest_id: guestId, p_token_hash: hashOf(result.path), p_mode: "reminder" });
    // Ni siquiera para quien solo abrió su enlace: la RPC acepta la apertura sin escribir el envío (F3).
    expect(calls.some(c => c.method === "update")).toBe(false);
    expect(calls.some(c => c.table === "wedding_guests")).toBe(false);
    expect(JSON.stringify(calls)).not.toContain(new URL(result.path, "https://example.test").searchParams.get("invitacion")!);
  });
  it("sin entrega (ni envío ni apertura), sin sesión o con id inválido no hay enlace de recordatorio", async () => {
    expect((await createReminderLink("invalid")).ok).toBe(false);
    mocks.client.mockResolvedValue(database([owner(), { data: [], error: null }]));
    const result = await createReminderLink(guestId);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("path");
    calls = [];
    mocks.client.mockResolvedValue(database([], false));
    expect((await createReminderLink(guestId)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("importación masiva (bulkCreateGuests)", () => {
  const inserted = (n: number) => ({ data: Array.from({ length: n }, (_, i) => ({ id: `g${i}` })), error: null });
  it("valida cada fila con el mismo schema, inserta las válidas en UN lote con el wedding_id de la sesión y devuelve las inválidas por línea", async () => {
    mocks.client.mockResolvedValue(database([owner(), inserted(2)]));
    const result = await bulkCreateGuests([{ name: "Lucía", phone: "612000111" }, { name: "J" }, { name: "Abuela Carmen" }, { name: "Jo", phone: "6" }]);
    expect(result).toMatchObject({ ok: true, created: 2, skipped: 2 });
    expect(result.errors.map((e) => e.line)).toEqual([2, 4]);
    const inserts = calls.filter((c) => c.method === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("wedding_guests");
    expect(inserts[0].args[0]).toEqual([
      expect.objectContaining({ wedding_id: weddingId, source: "couple", name: "Lucía", phone: "612000111", rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null }),
      expect.objectContaining({ wedding_id: weddingId, name: "Abuela Carmen", phone: null }),
    ]);
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["wedding_members.user_id", "owner-a"] });
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("rechaza lotes vacíos, por encima del tope o sin filas válidas sin crear cliente", async () => {
    expect(await bulkCreateGuests([])).toMatchObject({ ok: false, created: 0 });
    expect(await bulkCreateGuests(Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `Invitado ${i}` })))).toMatchObject({ ok: false, created: 0 });
    const garbage = await bulkCreateGuests([{ name: 42 as unknown as string }, null as unknown as { name: string }]);
    expect(garbage).toMatchObject({ ok: false, created: 0 });
    expect(garbage.errors).toHaveLength(2);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("sin sesión o si falla el insert no se añade ninguno y no se revalida", async () => {
    mocks.client.mockResolvedValue(database([], false));
    expect(await bulkCreateGuests([{ name: "Lucía" }])).toMatchObject({ ok: false, created: 0 });
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { message: "rls" } }]));
    expect(await bulkCreateGuests([{ name: "Lucía" }])).toMatchObject({ ok: false, created: 0, skipped: 1 });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("listGuestContacts lee solo la boda del usuario", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ name: "Ana", phone: null }], error: null }]));
    expect(await listGuestContacts()).toEqual({ ok: true, guests: [{ name: "Ana", phone: null }] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
  });
});

describe("grupos de invitados", () => {
  const otherId = "33333333-3333-4333-8333-333333333333";
  const missingColumn = { data: null, error: { code: "PGRST204", message: "Could not find the 'group_name' column" } };
  it("añadir con grupo: espacios colapsados y recortados", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    expect(await addGuest({ ...input, group: "  Familia   de Elena " })).toEqual({ ok: true });
    expect(calls.find(c => c.method === "insert")?.args[0]).toMatchObject({ wedding_id: weddingId, group_name: "Familia de Elena" });
  });
  it("editar sin campo grupo no lo pisa; con \"\" lo quita", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { id: guestId }, error: null }]));
    expect(await updateGuest(guestId, input)).toEqual({ ok: true });
    expect(calls.find(c => c.method === "update")?.args[0]).not.toHaveProperty("group_name");
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: { id: guestId }, error: null }]));
    expect(await updateGuest(guestId, { ...input, group: "   " })).toEqual({ ok: true });
    expect(calls.find(c => c.method === "update")?.args[0]).toMatchObject({ group_name: null });
  });
  it("rechaza un grupo de más de 40 caracteres antes de crear cliente", async () => {
    const result = await addGuest({ ...input, group: "x".repeat(41) });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("40") });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("sin la migración: editar sin grupo concreto se repite sin la columna; con grupo avisa", async () => {
    mocks.client.mockResolvedValue(database([owner(), missingColumn, { data: { id: guestId }, error: null }]));
    expect(await updateGuest(guestId, { ...input, group: "" })).toEqual({ ok: true });
    const updates = calls.filter(c => c.method === "update");
    expect(updates).toHaveLength(2);
    expect(updates[1].args[0]).not.toHaveProperty("group_name");
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), missingColumn]));
    expect(await addGuest({ ...input, group: "Trabajo" })).toEqual({ ok: false, error: expect.stringContaining("migración") });
    expect(calls.filter(c => c.method === "insert")).toHaveLength(1);
  });
  it("importación masiva: un grupo para todo el lote", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: "g1" }, { id: "g2" }], error: null }]));
    const result = await bulkCreateGuests([{ name: "Lucía" }, { name: "Pedro" }], " Amigos de Marcos ");
    expect(result).toMatchObject({ ok: true, created: 2 });
    expect(calls.find(c => c.method === "insert")?.args[0]).toEqual([
      expect.objectContaining({ name: "Lucía", group_name: "Amigos de Marcos" }),
      expect.objectContaining({ name: "Pedro", group_name: "Amigos de Marcos" }),
    ]);
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: "g1" }], error: null }]));
    await bulkCreateGuests([{ name: "Lucía" }]);
    expect((calls.find(c => c.method === "insert")?.args[0] as object[])[0]).not.toHaveProperty("group_name");
    expect(await bulkCreateGuests([{ name: "Lucía" }], "y".repeat(41))).toMatchObject({ ok: false, created: 0 });
  });
  it("mover a grupo: solo ids de la boda de la sesión, sin tocar updated_at", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestId }], error: null }]));
    expect(await setGuestsGroup([guestId, otherId, guestId], "Vecinos")).toEqual({ ok: true, moved: 1, missing: 1 });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "in", args: ["id", [guestId, otherId]] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "weddings", method: "eq", args: ["wedding_members.user_id", "owner-a"] });
    expect(calls.find(c => c.method === "update")?.args[0]).toEqual({ group_name: "Vecinos" });
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("mover a grupo: \"\" quita el grupo", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestId }], error: null }]));
    expect(await setGuestsGroup([guestId], "")).toMatchObject({ ok: true, moved: 1 });
    expect(calls.find(c => c.method === "update")?.args[0]).toEqual({ group_name: null });
  });
  it("mover a grupo: rechaza ids inválidos, lista vacía o enorme y nombre largo sin crear cliente", async () => {
    for (const args of [[[], "A"], [["no-uuid"], "A"], [Array.from({ length: MAX_GROUP_MOVE + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`), "A"], [[guestId], "z".repeat(41)]] as Array<[string[], string]>) {
      expect((await setGuestsGroup(...args)).ok).toBe(false);
    }
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("mover a grupo: sin sesión, ajenos (0 filas), error o sin migración → no informa éxito", async () => {
    mocks.client.mockResolvedValue(database([], false));
    expect((await setGuestsGroup([guestId], "A")).ok).toBe(false);
    expect(calls).toEqual([]);
    for (const reply of [{ data: [], error: null }, { data: null, error: { message: "rls" } }, missingColumn]) {
      mocks.client.mockResolvedValue(database([owner(), reply]));
      expect((await setGuestsGroup([guestId], "A")).ok).toBe(false);
    }
    mocks.client.mockResolvedValue(database([owner(), missingColumn]));
    expect(await setGuestsGroup([guestId], "A")).toEqual({ ok: false, error: expect.stringContaining("migración") });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("searchGuestDirectory (R05)", () => {
  it("busca solo en la boda de la sesión, con los comodines escapados y como mucho 20", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestId, name: "Ana 100%" }], error: null }]));
    expect(await searchGuestDirectory("100%_")).toEqual([{ id: guestId, name: "Ana 100%" }]);
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "ilike", args: ["name", "%100\\%\\_%"] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "limit", args: [20] });
  });
  it("sin sesión o sin texto no consulta nada", async () => {
    mocks.client.mockResolvedValue(database([], false));
    expect(await searchGuestDirectory("Ana")).toEqual([]);
    expect(await searchGuestDirectory("   ")).toEqual([]);
    expect(calls.some((c) => c.table === "wedding_guests")).toBe(false);
  });
});

describe("etiquetas y lado (20261020100000)", () => {
  const otherId = "33333333-3333-4333-8333-333333333333";
  const missingColumn = { data: null, error: { code: "PGRST204", message: "Could not find the 'tags' column" } };
  const missingRpc = { data: null, error: { code: "PGRST202", message: "no function" } };
  it("añadir con etiquetas y lado: normalizadas, sin repetidas", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    expect(await addGuest({ ...input, tags: [" Amigos  de la uni ", "amigos de la uni", "Pueblo"], side: "p2" })).toEqual({ ok: true });
    expect(calls.find(c => c.method === "insert")?.args[0]).toMatchObject({ wedding_id: weddingId, tags: ["Amigos de la uni", "Pueblo"], side: "p2" });
  });
  it("editar sin etiquetas ni lado no los pisa; [] y null los quitan", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: { id: guestId }, error: null }]));
    await updateGuest(guestId, input);
    const first = calls.find(c => c.method === "update")?.args[0];
    expect(first).not.toHaveProperty("tags");
    expect(first).not.toHaveProperty("side");
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: { id: guestId }, error: null }]));
    await updateGuest(guestId, { ...input, tags: [], side: null });
    expect(calls.find(c => c.method === "update")?.args[0]).toMatchObject({ tags: [], side: null });
  });
  it("rechaza etiquetas largas, más de 8 o un lado desconocido antes de crear cliente", async () => {
    expect(await addGuest({ ...input, tags: ["x".repeat(31)] })).toEqual({ ok: false, error: expect.stringContaining("30") });
    expect(await addGuest({ ...input, tags: Array.from({ length: 9 }, (_, i) => `t${i}`) })).toEqual({ ok: false, error: expect.stringContaining("8") });
    expect((await addGuest({ ...input, side: "novio" as never })).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("sin la migración: sin etiquetas pedidas se repite sin ellas; con etiquetas avisa", async () => {
    mocks.client.mockResolvedValue(database([owner(), missingColumn, { data: { id: guestId }, error: null }]));
    expect(await updateGuest(guestId, { ...input, group: "Trabajo", tags: [], side: null })).toEqual({ ok: true });
    const updates = calls.filter(c => c.method === "update");
    expect(updates).toHaveLength(2);
    expect(updates[1].args[0]).not.toHaveProperty("tags");
    expect(updates[1].args[0]).toMatchObject({ group_name: "Trabajo" });
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), missingColumn]));
    expect(await addGuest({ ...input, tags: ["Uni"] })).toEqual({ ok: false, error: expect.stringContaining("etiquetas") });
    expect(calls.filter(c => c.method === "insert")).toHaveLength(1);
  });
  it("importación masiva: etiquetas y lado para todo el lote", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: "g1" }], error: null }]));
    expect(await bulkCreateGuests([{ name: "Lucía" }], "", { tags: ["Uni"], side: "ambos" })).toMatchObject({ ok: true, created: 1 });
    expect((calls.find(c => c.method === "insert")?.args[0] as object[])[0]).toMatchObject({ tags: ["Uni"], side: "ambos" });
    expect(await bulkCreateGuests([{ name: "Lucía" }], "", { tags: ["x".repeat(31)] })).toMatchObject({ ok: false, created: 0 });
  });
  it("setGuestsTags: una RPC con la boda de la sesión y las listas normalizadas", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: 2, error: null }]));
    expect(await setGuestsTags([guestId, otherId, guestId], { add: [" uni ", "Uni"], remove: ["Trabajo"] })).toEqual({ ok: true, changed: 2 });
    const rpc = calls.find(c => c.table === "rpc");
    expect(rpc).toEqual({ table: "rpc", method: "set_guest_tags", args: [{ p_wedding_id: weddingId, p_ids: [guestId, otherId], p_add: ["uni"], p_remove: ["Trabajo"] }] });
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("setGuestsTags: rechaza vacío, ids inválidos o etiquetas largas sin cliente; sin migración avisa", async () => {
    expect((await setGuestsTags([guestId], {})).ok).toBe(false);
    expect((await setGuestsTags(["no-uuid"], { add: ["a"] })).ok).toBe(false);
    expect((await setGuestsTags([guestId], { add: ["x".repeat(31)] })).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
    mocks.client.mockResolvedValue(database([owner(), missingRpc]));
    expect(await setGuestsTags([guestId], { add: ["a"] })).toEqual({ ok: false, error: expect.stringContaining("migración") });
    mocks.client.mockResolvedValue(database([], false));
    expect((await setGuestsTags([guestId], { add: ["a"] })).ok).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("setGuestsSide: solo la boda de la sesión; 0 filas no es éxito", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestId }], error: null }]));
    expect(await setGuestsSide([guestId, otherId], "p1")).toEqual({ ok: true, moved: 1, missing: 1 });
    expect(calls.find(c => c.method === "update")?.args[0]).toEqual({ side: "p1" });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    mocks.client.mockResolvedValue(database([owner(), { data: [], error: null }]));
    expect((await setGuestsSide([guestId], null)).ok).toBe(false);
    expect((await setGuestsSide([guestId], "x" as never)).ok).toBe(false);
  });
  it("renameTag: RPC rename_guest_tag; vacío quita; nombres largos o sin origen se rechazan", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: 3, error: null }]));
    expect(await renameTag(" Uni ", "  Amigos   de la uni ")).toEqual({ ok: true, changed: 3 });
    expect(calls.find(c => c.table === "rpc")?.args[0]).toEqual({ p_wedding_id: weddingId, p_from: "Uni", p_to: "Amigos de la uni" });
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: 1, error: null }]));
    expect(await renameTag("Uni", "")).toEqual({ ok: true, changed: 1 });
    expect(calls.find(c => c.table === "rpc")?.args[0]).toMatchObject({ p_to: "" });
    mocks.client.mockClear();
    expect((await renameTag("", "x")).ok).toBe(false);
    expect((await renameTag("Uni", "x".repeat(31))).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("tope de acompañantes (20261021110000)", () => {
  const otherId = "33333333-3333-4333-8333-333333333333";
  const missingColumn = { data: null, error: { code: "PGRST204", message: "Could not find the 'max_companions' column" } };
  it("añadir y editar: número, 0 y null se guardan; sin campo no se pisa", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: null }]));
    expect(await addGuest({ ...input, maxCompanions: 0 })).toEqual({ ok: true });
    expect(calls.find(c => c.method === "insert")?.args[0]).toMatchObject({ max_companions: 0 });
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: { id: guestId }, error: null }]));
    await updateGuest(guestId, input);
    expect(calls.find(c => c.method === "update")?.args[0]).not.toHaveProperty("max_companions");
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), { data: { id: guestId }, error: null }]));
    await updateGuest(guestId, { ...input, maxCompanions: null });
    expect(calls.find(c => c.method === "update")?.args[0]).toMatchObject({ max_companions: null });
  });
  it("rechaza topes fuera de 0–10 o con decimales antes de crear cliente", async () => {
    expect((await addGuest({ ...input, maxCompanions: 11 })).ok).toBe(false);
    expect((await addGuest({ ...input, maxCompanions: -1 })).ok).toBe(false);
    expect((await addGuest({ ...input, maxCompanions: 1.5 })).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("sin la migración: sin tope pedido se repite sin la columna (conservando etiquetas); con tope avisa", async () => {
    mocks.client.mockResolvedValue(database([owner(), missingColumn, { data: { id: guestId }, error: null }]));
    expect(await updateGuest(guestId, { ...input, tags: ["Uni"], maxCompanions: null })).toEqual({ ok: true });
    const updates = calls.filter(c => c.method === "update");
    expect(updates).toHaveLength(2);
    expect(updates[1].args[0]).not.toHaveProperty("max_companions");
    expect(updates[1].args[0]).toMatchObject({ tags: ["Uni"] });
    calls = [];
    mocks.client.mockResolvedValue(database([owner(), missingColumn]));
    expect(await addGuest({ ...input, maxCompanions: 2 })).toEqual({ ok: false, error: expect.stringContaining("migración") });
    expect(calls.filter(c => c.method === "insert")).toHaveLength(1);
  });
  it("sin tope ni etiquetas en la base: se quita columna a columna hasta guardar", async () => {
    mocks.client.mockResolvedValue(database([owner(), missingColumn, missingColumn, { data: { id: guestId }, error: null }]));
    expect(await updateGuest(guestId, { ...input, tags: [], side: null, maxCompanions: null })).toEqual({ ok: true });
    const updates = calls.filter(c => c.method === "update");
    expect(updates).toHaveLength(3);
    expect(updates[2].args[0]).not.toHaveProperty("tags");
    expect(updates[2].args[0]).not.toHaveProperty("max_companions");
  });
  it("setGuestsMaxCompanions: solo la boda de la sesión, sin repetidos; 0 filas no es éxito; sin migración avisa", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestId }], error: null }]));
    expect(await setGuestsMaxCompanions([guestId, otherId, guestId], 2)).toEqual({ ok: true, moved: 1, missing: 1 });
    expect(calls.find(c => c.method === "update")?.args[0]).toEqual({ max_companions: 2 });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "in", args: ["id", [guestId, otherId]] });
    mocks.client.mockResolvedValue(database([owner(), { data: [], error: null }]));
    expect((await setGuestsMaxCompanions([guestId], null)).ok).toBe(false);
    mocks.client.mockResolvedValue(database([owner(), missingColumn]));
    expect(await setGuestsMaxCompanions([guestId], 1)).toEqual({ ok: false, error: expect.stringContaining("migración") });
    mocks.client.mockClear();
    expect((await setGuestsMaxCompanions([guestId], 11)).ok).toBe(false);
    expect((await setGuestsMaxCompanions(["no-uuid"], 1)).ok).toBe(false);
    expect((await setGuestsMaxCompanions([], 1)).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("acciones en bloque (Bloque 4)", () => {
  const otherId = "33333333-3333-4333-8333-333333333333";
  const many = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  it("borrar en bloque: un delete con los ids únicos de la boda de la sesión y recuento de ausentes", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestId }], error: null }]));
    expect(await deleteGuests([guestId, otherId, guestId])).toEqual({ ok: true, deleted: 1, missing: 1 });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "delete", args: [] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "in", args: ["id", [guestId, otherId]] });
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    expect(mocks.refresh).toHaveBeenCalledWith("/panel/mesas");
  });
  it("borrar en bloque: sin éxito con 0 filas, error o sin sesión; valida antes de crear cliente", async () => {
    for (const ids of [[], ["no-uuid"], many(MAX_GUEST_BULK + 1)]) expect((await deleteGuests(ids)).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
    for (const reply of [{ data: [], error: null }, { data: null, error: { message: "rls" } }]) {
      mocks.client.mockResolvedValue(database([owner(), reply]));
      expect((await deleteGuests([guestId])).ok).toBe(false);
    }
    calls = [];
    mocks.client.mockResolvedValue(database([], false));
    expect((await deleteGuests([guestId])).ok).toBe(false);
    expect(calls.some(c => c.method === "delete")).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("borrar en bloque: el tope admite exactamente MAX_GUEST_BULK", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: many(MAX_GUEST_BULK).map(id => ({ id })), error: null }]));
    expect(await deleteGuests(many(MAX_GUEST_BULK))).toEqual({ ok: true, deleted: MAX_GUEST_BULK, missing: 0 });
  });
  it("antes de borrar: cuenta los regalos que se van y los que se quedan con otras personas", async () => {
    const gift = (id: string, givers: string[]) => ({ id, kind: "bizum", amount_cents: 5000, description: null, note: null, received_on: null, thanked_at: null, created_at: "2026-10-01T10:00:00Z", givers: givers.map(guestId => ({ guestId, name: "X" })) });
    const third = "44444444-4444-4444-8444-444444444444";
    mocks.client.mockResolvedValue(database([owner(), { data: [gift("a", [guestId]), gift("b", [guestId, otherId]), gift("c", [guestId, third])], error: null }]));
    expect(await previewGuestsDeletion([guestId, otherId])).toEqual({ ok: true, giftsDeleted: 2, giftsKept: 1 });
    expect(calls).toContainEqual({ table: "rpc", method: "wedding_gift_list_for", args: [{ p_wedding_id: weddingId, p_guest_ids: [guestId, otherId] }] });
  });
  it("marcar asistencia: «Asiste» no toca acompañantes; «No asiste» y «Sin respuesta» los ponen a 0", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestId }, { id: otherId }], error: null }]));
    expect(await setGuestsStatus([guestId, otherId], "si")).toEqual({ ok: true, changed: 2, missing: 0 });
    const yes = calls.find(c => c.method === "update")?.args[0] as Record<string, unknown>;
    expect(yes).toMatchObject({ rsvp_status: "si" });
    expect(yes).not.toHaveProperty("rsvp_companions");
    expect(typeof yes.updated_at).toBe("string");
    expect(calls).toContainEqual({ table: "wedding_guests", method: "eq", args: ["wedding_id", weddingId] });
    for (const status of ["no", "pendiente"] as const) {
      calls = [];
      mocks.client.mockResolvedValue(database([owner(), { data: [{ id: guestId }], error: null }]));
      expect(await setGuestsStatus([guestId, otherId], status)).toEqual({ ok: true, changed: 1, missing: 1 });
      expect(calls.find(c => c.method === "update")?.args[0]).toMatchObject({ rsvp_status: status, rsvp_companions: 0 });
    }
  });
  it("marcar asistencia: estado inválido, ids inválidos o 0 filas → no informa éxito", async () => {
    expect((await setGuestsStatus([guestId], "quizas" as never)).ok).toBe(false);
    expect((await setGuestsStatus(["no-uuid"], "si")).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
    mocks.client.mockResolvedValue(database([owner(), { data: [], error: null }]));
    expect((await setGuestsStatus([guestId], "no")).ok).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  const pageRow = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: "Ana", phone: null, rsvp_status: "pendiente", rsvp_companions: 0, rsvp_notes: null, source: "couple",
    invitation_prepared_at: "2026-10-01T10:00:00Z", invitation_sent_at: null, last_reminder_at: null, reminder_count: 0, reminders_opt_out: false,
    created_at: "2026-10-01T10:00:00Z", group_name: "Primos", tags: ["Uni"], side: null, total_count: 2, ...extra,
  });
  it("elegir los N del filtro: mismo guest_page que la lista y solo lo que necesita la barra", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: [pageRow(guestId), pageRow(otherId, { invitation_sent_at: "2026-10-02T10:00:00Z" })], error: null }]));
    const result = await listGuestsInFilter({ filter: "sin_enviar", query: " ana ", group: { kind: "named", name: " Primos " }, tag: "Uni", side: "p1" });
    expect(result).toEqual({ ok: true, guests: [
      { id: guestId, name: "Ana", rsvp_status: "pendiente", invitation_prepared_at: "2026-10-01T10:00:00Z", invitation_sent_at: null, group_name: "Primos", tags: ["Uni"] },
      { id: otherId, name: "Ana", rsvp_status: "pendiente", invitation_prepared_at: "2026-10-01T10:00:00Z", invitation_sent_at: "2026-10-02T10:00:00Z", group_name: "Primos", tags: ["Uni"] },
    ] });
    expect(calls.find(c => c.method === "guest_page")?.args[0]).toMatchObject({ p_wedding_id: weddingId, p_filter: "sin_enviar", p_search: "ana", p_group: "Primos", p_tag: "Uni", p_side: "p1" });
  });
  it("elegir los N del filtro: más del tope o fallo de lectura → error claro", async () => {
    mocks.client.mockResolvedValue(database([owner(), { data: many(MAX_GUEST_BULK + 1).map(id => pageRow(id)), error: null }]));
    expect(await listGuestsInFilter({ filter: "todos", query: "", group: { kind: "all" }, tag: null, side: null })).toEqual({ ok: false, error: expect.stringContaining(String(MAX_GUEST_BULK)) });
    mocks.client.mockResolvedValue(database([owner(), { data: null, error: { message: "x" } }]));
    expect((await listGuestsInFilter({ filter: "todos", query: "", group: { kind: "all" }, tag: null, side: null })).ok).toBe(false);
    expect((await listGuestsInFilter({ filter: "todos", query: "", group: { kind: "otro" } as never, tag: null, side: null })).ok).toBe(false);
  });
});
