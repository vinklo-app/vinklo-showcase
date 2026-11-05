/**
 * Semilla de demo (2026-07-08): crea/completa la boda de prueba para ver
 * toda la simulación — usuario demo, boda ana-y-luis, aportaciones,
 * proveedor con tramos e invitados en el tracker — y genera un enlace
 * mágico de acceso directo al panel.
 *
 * Uso: node scripts/seed-demo.mjs   (lee .env.local)
 * OJO: .env.local apunta a PRODUCCIÓN; el script se niega salvo ALLOW_PRODUCTION=1.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

// Seguro: este script ESCRIBE datos. Se niega a tocar producción salvo ALLOW_PRODUCTION=1.
const PROD_REF = "viduzwynogimviwwnorg";
if (env.NEXT_PUBLIC_SUPABASE_URL?.includes(PROD_REF) && process.env.ALLOW_PRODUCTION !== "1") {
  console.error(`Abortado: la URL de Supabase apunta a PRODUCCIÓN (${PROD_REF}). Si es intencionado, repite con ALLOW_PRODUCTION=1.`);
  process.exit(1);
}

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const DEMO_EMAIL = "demo@vinklo.es";
const SLUG = "ana-y-luis";

// ---- 1. Usuario demo ------------------------------------------------------
let userId;
{
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const existing = data.users.find((u) => u.email === DEMO_EMAIL);
  if (existing) {
    userId = existing.id;
    console.log("usuario demo ya existía:", userId);
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: DEMO_EMAIL,
      email_confirm: true,
    });
    if (error) throw error;
    userId = created.user.id;
    console.log("usuario demo creado:", userId);
  }
}

// ---- 2. Boda ana-y-luis ---------------------------------------------------
const weddingDate = new Date(Date.now() + 73 * 86400_000)
  .toISOString()
  .slice(0, 10);

let weddingId;
{
  const { data: existing } = await admin
    .from("weddings")
    .select("id, couple_id")
    .eq("slug", SLUG)
    .maybeSingle();

  if (existing) {
    weddingId = existing.id;
    // La boda demo pasa a manos del usuario demo para poder entrar al panel.
    await admin
      .from("weddings")
      .update({ couple_id: userId })
      .eq("id", weddingId);
    console.log("boda existente reasignada al usuario demo:", weddingId);
  } else {
    const { data: created, error } = await admin
      .from("weddings")
      .insert({
        slug: SLUG,
        couple_id: userId,
        partner_name_1: "Ana",
        partner_name_2: "Luis",
        wedding_date: weddingDate,
        guest_count_est: 120,
        cubierto_price_cents: 15000,
      })
      .select("id")
      .single();
    if (error) throw error;
    weddingId = created.id;
    console.log("boda demo creada:", weddingId);
  }
}

// perfil (por si el trigger de profiles no existe para usuarios admin-created)
await admin
  .from("profiles")
  .upsert({ id: userId, full_name: "Ana y Luis (demo)", role: "couple" });

// ---- 3. Aportaciones de ejemplo -------------------------------------------
const CONTRIBUTIONS = [
  ["Marta Jiménez", 20000, "confirmed", "¡Enhorabuena pareja!"],
  ["Tía Carmen", 15000, "confirmed", "Con todo mi cariño"],
  ["Álvaro Ruiz", 10000, "confirmed", null],
  ["Familia Pérez Soler", 30000, "confirmed", "¡Nos vemos en la pista!"],
  ["Lucía Ortega", 12000, "pending", null],
];
{
  const { count } = await admin
    .from("contributions")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", weddingId);
  if ((count ?? 0) >= CONTRIBUTIONS.length) {
    console.log("aportaciones demo ya presentes:", count);
  } else {
    for (const [name, cents, status, message] of CONTRIBUTIONS) {
      await admin.from("contributions").insert({
        wedding_id: weddingId,
        guest_name: name,
        n_cubiertos: 1,
        cubierto_cents: cents,
        gift_cents: 0,
        total_cents: cents,
        service_fee_cents: 0,
        message,
        method: status === "pending" ? "bizum_manual" : "card",
        status,
      });
    }
    console.log("aportaciones demo insertadas");
  }
}

// ---- 4. Proveedor con calendario ------------------------------------------
{
  const { data: vendor } = await admin
    .from("vendors")
    .select("id")
    .eq("wedding_id", weddingId)
    .eq("email", "finca@demo.vinklo.es")
    .maybeSingle();
  let vendorId = vendor?.id;
  if (!vendorId) {
    const { data: created, error } = await admin
      .from("vendors")
      .insert({
        wedding_id: weddingId,
        name: "Finca La Alameda",
        email: "finca@demo.vinklo.es",
        category: "finca",
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw error;
    vendorId = created.id;
    const due1 = new Date(Date.now() + 12 * 86400_000).toISOString().slice(0, 10);
    const due2 = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    await admin.from("payment_tranches").insert([
      { vendor_id: vendorId, label: "señal", amount_cents: 300000, due_date: null, status: "paid", paid_at: new Date().toISOString() },
      { vendor_id: vendorId, label: "prueba de menú", amount_cents: 140000, due_date: due1, status: "pending" },
      { vendor_id: vendorId, label: "pago final", amount_cents: 800000, due_date: due2, status: "pending" },
    ]);
    console.log("proveedor + tramos demo creados");
  } else {
    console.log("proveedor demo ya existía");
  }
}

// ---- 5. Invitados en el tracker -------------------------------------------
{
  const { count, error } = await admin
    .from("wedding_guests")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", weddingId);
  if (error) {
    console.log("tracker no disponible (¿migración aplicada?):", error.message);
  } else if ((count ?? 0) > 0) {
    console.log("invitados demo ya presentes:", count);
  } else {
    await admin.from("wedding_guests").insert([
      { wedding_id: weddingId, name: "Marta Jiménez", phone: "600 111 222", gift_status: "enlace", amount_cents: 20000 },
      { wedding_id: weddingId, name: "Tía Carmen", phone: "600 333 444", gift_status: "enlace", amount_cents: 15000 },
      { wedding_id: weddingId, name: "Jorge y Elena", phone: "600 555 666", gift_status: "bizum", amount_cents: 25000 },
      { wedding_id: weddingId, name: "Abuelo Paco", phone: null, gift_status: "efectivo", amount_cents: 50000 },
      { wedding_id: weddingId, name: "Compis del trabajo", phone: "600 777 888", gift_status: "pendiente", amount_cents: null },
    ]);
    console.log("invitados demo insertados");
  }
}

// ---- 6. Enlace mágico ------------------------------------------------------
const redirectTo = `${(process.env.DEMO_APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3210").replace(/\/$/, "")}/auth/callback`;
const { data: link, error: linkError } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: DEMO_EMAIL,
  options: { redirectTo },
});
if (linkError) throw linkError;
console.log("\n=== CUENTA DEMO LISTA ===");
console.log("email:", DEMO_EMAIL);
console.log("enlace mágico (un solo uso):\n" + link.properties.action_link);
