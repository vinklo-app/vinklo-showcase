// Cliente con service role: SOLO para uso en servidor (server actions,
// route handlers, webhooks). Nunca importar desde código de cliente.
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Postgres no expone la nulabilidad de los parámetros de una función, así
// que el generador declara todos los argumentos de RPC no nulos. Estas RPC
// aceptan NULL a propósito (lib/actions/rsvp.ts: nota de salud, logística,
// respuestas y acompañantes; lib/crm/track-open.ts: visitante anónimo): sus
// argumentos admiten null aquí y el resto del esquema queda tal cual se genera.
type NullableArgsRpc = "guest_rsvp_respond" | "guest_invitation_opened";
type Functions = Database["public"]["Functions"];
type WithNullableArgs<F> = F extends { Args: infer A; Returns: infer R }
  ? Omit<F, "Args"> & { Args: { [K in keyof A]: A[K] | null }; Returns: R }
  : F;
export type AdminDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: { [K in keyof Functions]: K extends NullableArgsRpc ? WithNullableArgs<Functions[K]> : Functions[K] };
  };
};

export function createAdminClient() {
  return createSupabaseClient<AdminDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}
