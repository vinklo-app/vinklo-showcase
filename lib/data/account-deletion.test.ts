import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("usar el admin falso"); } }));
import { finishPendingDeletion, markWeddingDeleted, planAccountDeletion, purgeEmailLeftovers, purgeWeddingStorage, queueUserDeletion, runPendingDeletion, runPendingDeletions, STUCK_ATTEMPTS, type PendingDeletion } from "./account-deletion";

const weddingId = "11111111-1111-4111-8111-111111111111";
type Reply = { data: unknown; error: unknown };

/** Storage en memoria: bucket -> nombres completos. */
function fakeStorage(objects: Record<string, string[]>, fail: { list?: string; remove?: string } = {}) {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const storage = {
    from: (bucket: string) => ({
      list: async (folder: string, opts: { limit: number; offset: number }) => {
        if (fail.list === bucket) return { data: null, error: { statusCode: "500" } };
        const inside = (objects[bucket] ?? []).filter((name) => name.startsWith(`${folder}/`));
        return { data: inside.slice(opts.offset, opts.offset + opts.limit).map((name) => ({ id: name, name: name.slice(folder.length + 1) })), error: null };
      },
      remove: async (paths: string[]) => {
        if (fail.remove === bucket) return { data: null, error: { statusCode: "500" } };
        removed.push({ bucket, paths });
        objects[bucket] = (objects[bucket] ?? []).filter((name) => !paths.includes(name));
        return { data: [], error: null };
      },
    }),
  };
  return { storage, removed };
}

function fakeAdmin(storage: unknown, replies: Record<string, Reply[]> = {}) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "limit"]) self[m] = () => self;
    const next = () => (replies[table] ?? []).shift() ?? { data: null, error: null };
    self.maybeSingle = async () => next();
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(next()).then(resolve);
    return self;
  };
  return { storage, from: chain } as never;
}

describe("purgeWeddingStorage", () => {
  it("vacía la carpeta de la boda en los dos buckets de fotos y las facturas de sus proveedores, y nada más", async () => {
    const objects = {
      "wedding-photos": [`${weddingId}/cover-a.jpg`, `${weddingId}/cover-b.jpg`, "otra-boda/cover-c.jpg"],
      "wedding-photos-drafts": [`${weddingId}/cover-d.jpg`, "otra-boda/cover-e.jpg"],
      invoices: ["vendor-1/factura.pdf", "vendor-x/ajena.pdf"],
    };
    const { storage, removed } = fakeStorage(objects);
    const result = await purgeWeddingStorage(weddingId, ["vendor-1"], fakeAdmin(storage));
    expect(result).toEqual({ ok: true });
    expect(objects["wedding-photos"]).toEqual(["otra-boda/cover-c.jpg"]);
    expect(objects["wedding-photos-drafts"]).toEqual(["otra-boda/cover-e.jpg"]);
    expect(objects.invoices).toEqual(["vendor-x/ajena.pdf"]);
    expect(removed.map((r) => r.bucket)).toEqual(["wedding-photos", "wedding-photos-drafts", "invoices"]);
  });

  it("pagina: más de 1000 objetos se borran en varias vueltas", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => `${weddingId}/cover-${i}.jpg`);
    const objects: Record<string, string[]> = { "wedding-photos": many, "wedding-photos-drafts": [], invoices: [] };
    const { storage, removed } = fakeStorage(objects);
    const result = await purgeWeddingStorage(weddingId, [], fakeAdmin(storage));
    expect(result).toEqual({ ok: true });
    expect(objects["wedding-photos"]).toEqual([]);
    expect(removed.filter((r) => r.bucket === "wedding-photos").length).toBe(3);
  });

  it("un fallo de Storage se informa con la fase y corta", async () => {
    const objects = { "wedding-photos": [`${weddingId}/cover-a.jpg`], "wedding-photos-drafts": [`${weddingId}/cover-d.jpg`] };
    const { storage } = fakeStorage(objects, { remove: "wedding-photos-drafts" });
    const result = await purgeWeddingStorage(weddingId, [], fakeAdmin(storage));
    expect(result).toEqual({ ok: false, phase: "wedding-photos-drafts" });
  });
});

describe("planAccountDeletion", () => {
  it("una boda ya marcada (fase 1 hecha) no cuenta como suya", async () => {
    const filters: unknown[][] = [];
    const admin = {
      from: (table: string) => {
        const self: Record<string, unknown> = {};
        for (const m of ["select", "eq", "neq", "is", "limit"]) self[m] = (...args: unknown[]) => { filters.push([table, m, ...args]); return self; };
        self.maybeSingle = async () => ({ data: null, error: null });
        return self;
      },
    } as never;
    expect(await planAccountDeletion("u1", admin)).toEqual({ kind: "none" });
    expect(filters).toContainEqual(["weddings", "is", "deleted_at", null]);
  });

  it("sin boda", async () => {
    const plan = await planAccountDeletion("u1", fakeAdmin(null, { weddings: [{ data: null, error: null }], wedding_members: [{ data: null, error: null }] }));
    expect(plan).toEqual({ kind: "none" });
  });

  it("pareja secundaria", async () => {
    const plan = await planAccountDeletion("u2", fakeAdmin(null, { weddings: [{ data: null, error: null }], wedding_members: [{ data: { wedding_id: weddingId }, error: null }] }));
    expect(plan).toEqual({ kind: "partner", weddingId });
  });

  it("dueño con pareja", async () => {
    const plan = await planAccountDeletion("u1", fakeAdmin(null, { weddings: [{ data: { id: weddingId }, error: null }], wedding_members: [{ data: [{ user_id: "u2" }], error: null }] }));
    expect(plan).toEqual({ kind: "owner-with-partner", weddingId, partnerId: "u2" });
  });

  it("dueño solo", async () => {
    const plan = await planAccountDeletion("u1", fakeAdmin(null, { weddings: [{ data: { id: weddingId }, error: null }], wedding_members: [{ data: [], error: null }] }));
    expect(plan).toEqual({ kind: "owner-alone", weddingId });
  });

  it("lanza si no se puede leer", async () => {
    await expect(planAccountDeletion("u1", fakeAdmin(null, { weddings: [{ data: null, error: { code: "57014" } }] }))).rejects.toThrow();
  });
});

describe("purgeEmailLeftovers", () => {
  /** Admin falso que anota cada borrado (tabla + filtros). */
  function fakeAdmin(failOn?: string) {
    const deletes: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
    const admin = {
      from: (table: string) => ({
        delete: () => {
          const entry = { table, filters: [] as Array<[string, string, unknown]> };
          deletes.push(entry);
          const chain = {
            eq: (col: string, value: unknown) => { entry.filters.push(["eq", col, value]); return chain; },
            is: (col: string, value: unknown) => { entry.filters.push(["is", col, value]); return chain; },
            then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => (failOn === table ? reject(new Error("no existe")) : resolve({ error: null })),
          };
          return chain;
        },
      }),
    };
    return { admin: admin as unknown as Parameters<typeof purgeEmailLeftovers>[1], deletes };
  }

  it("borra borrador, invitaciones pendientes y alta en la lista de espera por correo normalizado", async () => {
    const { admin, deletes } = fakeAdmin();
    await purgeEmailLeftovers("  Ana@Example.COM ", admin);
    expect(deletes.map((d) => d.table)).toEqual(["builder_draft_stash", "wedding_member_invites", "waitlist"]);
    expect(deletes.find((d) => d.table === "waitlist")!.filters).toEqual([["eq", "email", "ana@example.com"]]);
  });
  it("si una tabla falla sigue con las demás", async () => {
    const { admin, deletes } = fakeAdmin("wedding_member_invites");
    await purgeEmailLeftovers("ana@example.com", admin);
    expect(deletes.map((d) => d.table)).toContain("waitlist");
  });
  it("sin correo no hace nada", async () => {
    const { admin, deletes } = fakeAdmin();
    await purgeEmailLeftovers(null, admin);
    expect(deletes).toEqual([]);
  });
});

/**
 * Admin falso para la fase 2: cola en memoria, weddings vivas o no, Auth y
 * Storage configurables. Registra cada operación en orden.
 */
function phaseTwoAdmin(opts: {
  queue?: PendingDeletion[];
  alive?: string[];
  weddingsDeleteError?: { code: string } | null;
  authError?: { status?: number; code?: string } | null;
  storageFail?: string;
  queueError?: { code: string } | null;
} = {}) {
  const log: string[] = [];
  const queue = [...(opts.queue ?? [])];
  const objects: Record<string, string[]> = { "wedding-photos": [`${weddingId}/cover-a.jpg`], "wedding-photos-drafts": [], invoices: [] };
  const { storage } = fakeStorage(objects, opts.storageFail ? { remove: opts.storageFail } : {});
  const updates: Array<Record<string, unknown>> = [];
  const upserts: Array<{ row: unknown; options: unknown }> = [];
  const admin = {
    storage,
    auth: { admin: { deleteUser: async (id: string) => { log.push(`auth:${id}`); return { error: opts.authError ?? null }; } } },
    rpc: async (fn: string, args: unknown) => { log.push(`rpc:${fn}:${JSON.stringify(args)}`); return { data: "ok", error: null }; },
    from: (table: string) => {
      const filters: Array<[string, unknown[]]> = [];
      let op = "select";
      const self: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "is", "order", "limit"]) self[m] = (...args: unknown[]) => { if (m !== "select" || op === "select") filters.push([m, args]); return self; };
      self.delete = () => { op = "delete"; return self; };
      self.update = (row: Record<string, unknown>) => { op = "update"; updates.push(row); return self; };
      self.upsert = async (row: unknown, options: unknown) => { upserts.push({ row, options }); return { error: opts.queueError ?? null }; };
      const resolve = () => {
        const eq = Object.fromEntries(filters.filter(([m]) => m === "eq").map(([, a]) => [a[0], a[1]]));
        if (table === "weddings" && op === "delete") {
          log.push(`weddings:delete:${eq.id}:${JSON.stringify(filters.find(([m]) => m === "not")?.[1])}`);
          return { data: null, error: opts.weddingsDeleteError ?? null };
        }
        if (table === "weddings") return { data: opts.alive?.includes(eq.id as string) ? { id: eq.id } : null, error: null };
        if (table === "pending_deletions" && op === "delete") { log.push(`queue:delete:${eq.id}`); return { error: null }; }
        if (table === "pending_deletions" && op === "update") { log.push(`queue:update:${eq.id}`); return { error: null }; }
        if (opts.queueError) return { data: null, error: opts.queueError };
        const rows = queue.filter((r) => (eq.kind === undefined || r.kind === eq.kind) && (eq.target_id === undefined || r.target_id === eq.target_id));
        return { data: rows, error: null };
      };
      self.maybeSingle = async () => { const r = resolve() as { data: unknown; error: unknown }; return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
      self.then = (ok: (v: unknown) => unknown) => Promise.resolve(resolve()).then(ok);
      return self;
    },
  };
  return { admin: admin as never, log, updates, upserts, objects };
}

const weddingEntry: PendingDeletion = { id: "q1", kind: "wedding", target_id: weddingId, vendor_ids: [], attempts: 0 };
const userEntry: PendingDeletion = { id: "q2", kind: "user", target_id: "user-a", vendor_ids: [], attempts: 2 };

describe("markWeddingDeleted (fase 1)", () => {
  it("llama a la RPC con la sesión y devuelve su estado; un error o algo raro es 'error'", async () => {
    const session = (reply: { data: unknown; error: unknown }) => ({ rpc: vi.fn(async () => reply) }) as never as Parameters<typeof markWeddingDeleted>[0];
    const ok = session({ data: "ok", error: null });
    expect(await markWeddingDeleted(ok, weddingId)).toBe("ok");
    expect((ok as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("wedding_mark_deleted", { p_wedding_id: weddingId });
    expect(await markWeddingDeleted(session({ data: "forbidden", error: null }), weddingId)).toBe("forbidden");
    expect(await markWeddingDeleted(session({ data: null, error: { code: "42883" } }), weddingId)).toBe("error");
    expect(await markWeddingDeleted(session({ data: "raro", error: null }), weddingId)).toBe("error");
  });
});

describe("queueUserDeletion", () => {
  it("apunta el usuario una sola vez (idempotente)", async () => {
    const { admin, upserts } = phaseTwoAdmin();
    expect(await queueUserDeletion("user-a", admin)).toBe(true);
    expect(upserts).toEqual([{ row: { kind: "user", target_id: "user-a" }, options: { onConflict: "kind,target_id", ignoreDuplicates: true } }]);
    expect(await queueUserDeletion("user-a", phaseTwoAdmin({ queueError: { code: "42P01" } }).admin)).toBe(false);
  });
});

describe("runPendingDeletion (fase 2)", () => {
  it("boda: borra solo la fila marcada, vacía Storage y sale de la cola, en ese orden", async () => {
    const { admin, log, objects } = phaseTwoAdmin();
    expect(await runPendingDeletion(weddingEntry, admin)).toEqual({ ok: true });
    expect(log).toEqual([`weddings:delete:${weddingId}:["deleted_at","is",null]`, "queue:delete:q1"]);
    expect(objects["wedding-photos"]).toEqual([]);
  });
  it("boda que sigue viva (cola corrupta): no toca sus fotos ni la saca de la cola", async () => {
    const { admin, log, objects, updates } = phaseTwoAdmin({ alive: [weddingId] });
    expect(await runPendingDeletion(weddingEntry, admin)).toMatchObject({ ok: false, phase: "alive" });
    expect(objects["wedding-photos"]).toEqual([`${weddingId}/cover-a.jpg`]);
    expect(log).toContain("queue:update:q1");
    expect(updates[0]).toMatchObject({ attempts: 1, last_error: "alive:?" });
  });
  it("Storage falla: suma un intento con la fase y queda para el cron", async () => {
    const { admin, log, updates } = phaseTwoAdmin({ storageFail: "wedding-photos" });
    expect(await runPendingDeletion(weddingEntry, admin)).toEqual({ ok: false, phase: "wedding-photos" });
    expect(log).not.toContain("queue:delete:q1");
    expect(updates[0]).toMatchObject({ attempts: 1, last_error: "wedding-photos:?" });
    expect(typeof updates[0]!.last_attempt_at).toBe("string");
  });
  it("reintento de una boda ya borrada: sin fila no es error, termina", async () => {
    const { admin } = phaseTwoAdmin();
    expect(await runPendingDeletion({ ...weddingEntry, attempts: 3 }, admin)).toEqual({ ok: true });
  });
  it("usuario: borra en Auth; si ya no existe (404) cuenta como hecho", async () => {
    const done = phaseTwoAdmin();
    expect(await runPendingDeletion(userEntry, done.admin)).toEqual({ ok: true });
    expect(done.log).toEqual(["auth:user-a", "queue:delete:q2"]);
    const gone = phaseTwoAdmin({ authError: { status: 404, code: "user_not_found" } });
    expect(await runPendingDeletion(userEntry, gone.admin)).toEqual({ ok: true });
  });
  it("usuario: un fallo de Auth suma intento con el código, sin datos personales", async () => {
    const { admin, updates } = phaseTwoAdmin({ authError: { status: 500, code: "unexpected_failure" } });
    expect(await runPendingDeletion(userEntry, admin)).toEqual({ ok: false, phase: "auth", code: "unexpected_failure" });
    expect(updates[0]).toMatchObject({ attempts: 3, last_error: "auth:unexpected_failure" });
  });
});

describe("finishPendingDeletion", () => {
  it("usa la entrada de la cola (con sus proveedores)", async () => {
    const { admin, objects } = phaseTwoAdmin({ queue: [{ ...weddingEntry, vendor_ids: ["vendor-1"] }] });
    objects.invoices = ["vendor-1/f.pdf"];
    expect(await finishPendingDeletion("wedding", weddingId, admin)).toEqual({ ok: true });
    expect(objects.invoices).toEqual([]);
  });
  it("boda sin entrada: no la toca (quedarían facturas sueltas)", async () => {
    const { admin, log } = phaseTwoAdmin();
    expect(await finishPendingDeletion("wedding", weddingId, admin)).toEqual({ ok: false, phase: "queue" });
    expect(log).toEqual([]);
  });
  it("usuario sin entrada (no se pudo apuntar): se intenta igual", async () => {
    const { admin, log } = phaseTwoAdmin();
    expect(await finishPendingDeletion("user", "user-a", admin)).toEqual({ ok: true });
    expect(log).toEqual(["auth:user-a"]);
  });
});

describe("runPendingDeletions (cron)", () => {
  it("procesa el lote y cuenta hechos y fallidos", async () => {
    const { admin } = phaseTwoAdmin({ queue: [weddingEntry, userEntry], authError: { status: 500 } });
    expect(await runPendingDeletions(admin)).toEqual({ done: 1, failed: 1 });
  });
  it("para al agotar el tiempo", async () => {
    let clock = 0;
    const { admin, log } = phaseTwoAdmin({ queue: [userEntry, { ...userEntry, id: "q3", target_id: "user-b" }] });
    const result = await runPendingDeletions(admin, { budgetMs: 1000, now: () => { clock += 600; return clock; } });
    expect(result).toEqual({ done: 1, failed: 0 });
    expect(log).toEqual(["auth:user-a", "queue:delete:q2"]);
  });
  it("cuenta como atascadas las que fallan por quinta vez (o más), no antes", async () => {
    const { admin } = phaseTwoAdmin({
      queue: [{ ...userEntry, attempts: 3 }, { ...userEntry, id: "q4", attempts: 4 }, { ...userEntry, id: "q5", attempts: 9 }],
      authError: { status: 500 },
    });
    expect(await runPendingDeletions(admin)).toEqual({ done: 0, failed: 3, stuck: 2 });
    expect(STUCK_ATTEMPTS).toBe(5);
  });
  it("si la cola no se puede leer, informa el código y no lanza", async () => {
    const { admin } = phaseTwoAdmin({ queueError: { code: "42P01" } });
    expect(await runPendingDeletions(admin)).toEqual({ done: 0, failed: 0, error: "42P01" });
  });
});
