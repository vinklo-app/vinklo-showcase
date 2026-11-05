import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVendorSummary } from "./wedding-vendors";

const weddingId = "11111111-1111-4111-8111-111111111111";
function client(reply: { data: unknown; error: unknown }) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const supabase = { rpc(name: string, args: unknown) { calls.push({ name, args }); return { maybeSingle: async () => reply }; } } as unknown as SupabaseClient;
  return { supabase, calls };
}

describe("getVendorSummary", () => {
  it("llama al agregado SQL con la boda y parsea los recuentos (bigint como texto)", async () => {
    const { supabase, calls } = client({ data: { total: "5", por_contactar: 1, contactado: 1, en_conversacion: 1, contratado: "2", descartado: 0 }, error: null });
    expect(await getVendorSummary(supabase, weddingId)).toEqual({ total: 5, por_contactar: 1, contactado: 1, en_conversacion: 1, contratado: 2, descartado: 0 });
    expect(calls).toEqual([{ name: "wedding_vendor_summary", args: { p_wedding_id: weddingId } }]);
  });
  it("boda ajena (0 filas), error o forma inesperada → null", async () => {
    expect(await getVendorSummary(client({ data: null, error: null }).supabase, weddingId)).toBeNull();
    expect(await getVendorSummary(client({ data: null, error: { message: "x" } }).supabase, weddingId)).toBeNull();
    expect(await getVendorSummary(client({ data: { total: -1 }, error: null }).supabase, weddingId)).toBeNull();
  });
});
