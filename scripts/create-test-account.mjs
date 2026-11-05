#!/usr/bin/env node
/**
 * Cuenta de prueba con contraseña (2026-10-04). Ver docs/ops/cuenta-de-prueba.md.
 *
 * Crea (o actualiza la contraseña de) un usuario de Supabase Auth CONFIRMADO
 * vía la API de administración. Idempotente: ejecutarlo dos veces deja la
 * misma cuenta con la última contraseña. Imprime solo el correo; nunca la
 * contraseña ni claves.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   TEST_EMAIL=prueba@vinklo.es \
 *   TEST_PASSWORD='…' \
 *   node scripts/create-test-account.mjs [--with-wedding]
 *
 * --with-wedding  además crea (si no existe) una boda de demo para ese
 *                 usuario, su web publicada (documentFromLegacy +
 *                 wedding_sites + RPC wedding_site_publish, como el creador)
 *                 y 12 invitados ficticios con estados variados.
 *                 Opcional: SUPABASE_ANON_KEY (si no, se usa la service key
 *                 como apikey para la sesión del usuario).
 *
 * Requiere Node ≥ 22.18 (importa el contrato TypeScript lib/site-document.ts
 * con type stripping nativo).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log("Uso: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… TEST_EMAIL=… TEST_PASSWORD=… node scripts/create-test-account.mjs [--with-wedding]");
  process.exit(0);
}
const WITH_WEDDING = args.has("--with-wedding");
for (const arg of args) {
  if (arg !== "--with-wedding") fail(`Argumento desconocido: ${arg}`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim() || SERVICE_KEY;
const EMAIL = process.env.TEST_EMAIL?.trim().toLowerCase();
const PASSWORD = process.env.TEST_PASSWORD ?? "";

if (!SUPABASE_URL || !SERVICE_KEY) fail("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
// Seguro: este script ESCRIBE datos. Se niega a tocar producción salvo ALLOW_PRODUCTION=1.
const PROD_REF = "viduzwynogimviwwnorg";
if (SUPABASE_URL?.includes(PROD_REF) && process.env.ALLOW_PRODUCTION !== "1") {
  console.error(`Abortado: la URL de Supabase apunta a PRODUCCIÓN (${PROD_REF}). Si es intencionado, repite con ALLOW_PRODUCTION=1.`);
  process.exit(1);
}
if (!EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL)) fail("TEST_EMAIL no es un correo válido.");
if (PASSWORD.length < 12) fail("TEST_PASSWORD debe tener al menos 12 caracteres.");
if (PASSWORD.length > 72) fail("TEST_PASSWORD puede tener como máximo 72 caracteres (límite de bcrypt).");

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Error de esquema sin migrar (tabla o columna inexistente). */
function isMissingSchema(error) {
  return Boolean(error) && ["42P01", "42703", "PGRST204", "PGRST205", "PGRST200"].includes(error.code);
}

// ---- 1. Usuario confirmado con contraseña -----------------------------------
async function findUserByEmail(email) {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`No se pudo listar usuarios (${error.status ?? "?"}).`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

let user = await findUserByEmail(EMAIL);
if (user) {
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true });
  if (error) fail(`No se pudo actualizar la contraseña (${error.status ?? "?"}).`);
  console.log(`✓ Contraseña actualizada: ${EMAIL}`);
} else {
  const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (error) fail(`No se pudo crear el usuario (${error.status ?? "?"}).`);
  user = data.user;
  console.log(`✓ Cuenta creada y confirmada: ${EMAIL}`);
}

if (!WITH_WEDDING) {
  console.log("  Entrad en /login?clave=1 con ese correo y la contraseña.");
  process.exit(0);
}

// ---- 2. Boda de demo (opcional) ---------------------------------------------
const NAMES = { partner_name_1: "Marta", partner_name_2: "Jorge" };
const weddingDate = new Date(Date.now() + 240 * 86_400_000).toISOString().slice(0, 10);

// El trigger handle_new_user crea el perfil; por si el usuario es anterior al trigger.
await admin.from("profiles").upsert({ id: user.id, full_name: "Cuenta de prueba", role: "couple" }, { onConflict: "id", ignoreDuplicates: true });

let wedding;
{
  const { data, error } = await admin
    .from("weddings")
    .select("id, slug, partner_name_1, partner_name_2, wedding_date, cover_image_url, page_config")
    .eq("couple_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) fail(`No se pudo leer la boda (${error.code ?? "?"}).`);
  wedding = data;
}

if (wedding) {
  console.log(`✓ La cuenta ya tenía boda: /b/${wedding.slug}`);
} else {
  const base = "marta-y-jorge-prueba";
  for (let i = 0; i < 20 && !wedding; i += 1) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const { data, error } = await admin
      .from("weddings")
      .insert({ slug, couple_id: user.id, ...NAMES, wedding_date: weddingDate, guest_count_est: 120 })
      .select("id, slug, partner_name_1, partner_name_2, wedding_date, cover_image_url, page_config")
      .single();
    if (!error) wedding = data;
    else if (error.code !== "23505") fail(`No se pudo crear la boda (${error.code ?? "?"}).`);
  }
  if (!wedding) fail("No se encontró un slug libre para la boda de demo.");
  console.log(`✓ Boda de demo creada: /b/${wedding.slug}`);
}

// ---- 3. Web publicada (mismo contrato que el creador) -----------------------
/** Importa lib/site-document.ts (TS) resolviendo imports sin extensión y `@/`. */
async function loadSiteDocument() {
  if (!process.features?.typescript) fail("Este Node no ejecuta TypeScript (type stripping). Usad Node ≥ 22.18.");
  const root = fileURLToPath(new URL("..", import.meta.url));
  registerHooks({
    resolve(specifier, context, next) {
      let spec = specifier.startsWith("@/") ? pathToFileURL(root + specifier.slice(2)).href : specifier;
      if ((spec.startsWith(".") || spec.startsWith("file:")) && !/\.[cm]?[jt]sx?$/.test(spec)) {
        const candidate = new URL(spec, context.parentURL);
        if (existsSync(`${fileURLToPath(candidate)}.ts`)) spec = `${candidate.href}.ts`;
      }
      return next(spec, context);
    },
  });
  return import(pathToFileURL(`${root}lib/site-document.ts`).href);
}

async function publishSite() {
  const { data: site, error } = await admin
    .from("wedding_sites")
    .select("draft_document, draft_version, published_revision_id")
    .eq("wedding_id", wedding.id)
    .maybeSingle();
  if (isMissingSchema(error)) {
    console.log("· Sin tabla wedding_sites en este entorno: la web se sirve con el adaptador v1.");
    return;
  }
  if (error) fail(`No se pudo leer la web (${error.code ?? "?"}).`);
  if (site?.published_revision_id) {
    console.log("✓ La web ya estaba publicada.");
    return;
  }

  const { documentFromLegacy, publishIssues } = await loadSiteDocument();
  let document = site?.draft_document;
  let version = site?.draft_version;
  if (!site) {
    document = documentFromLegacy({ ...wedding, agenda: [] });
    const issues = publishIssues(document);
    if (issues.length > 0) fail(`La web no se puede publicar: ${issues[0].message}`);
    const { data: created, error: insertError } = await admin
      .from("wedding_sites")
      .insert({ wedding_id: wedding.id, draft_document: document, draft_version: 1 })
      .select("draft_document, draft_version")
      .single();
    if (insertError) fail(`No se pudo crear la web (${insertError.code ?? "?"}).`);
    document = created.draft_document;
    version = created.draft_version;
  }

  // La RPC exige auth.uid() = dueño de la boda: se llama con la sesión del
  // propio usuario de prueba (Authorization explícito), no con service_role.
  const login = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: session, error: signInError } = await login.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInError || !session.session) fail(`No se pudo iniciar sesión como la cuenta de prueba (${signInError?.status ?? "?"}).`);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });
  // Mismo documento que está en draft_document (la RPC compara igualdad jsonb).
  const { error: rpcError } = await asUser.rpc("wedding_site_publish", {
    p_wedding_id: wedding.id,
    p_expected_version: version,
    p_document: document,
  });
  if (rpcError) fail(`No se pudo publicar la web (${rpcError.code ?? "?"} ${rpcError.message ?? ""}).`);
  console.log("✓ Web publicada.");
}

await publishSite();

// ---- 4. Invitados ficticios -------------------------------------------------
const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
// [nombre, teléfono ficticio, estado: prep | sent | none, rsvp, acompañantes]
const GUESTS = [
  ["Tía Carmen", "+34600000101", "sent", "si", 1],
  ["Álvaro Ruiz", "+34600000102", "sent", "si", 0],
  ["Lucía Ortega", "+34600000103", "sent", "no", 0],
  ["Familia Pérez Soler", "+34600000104", "sent", "si", 3],
  ["Nerea Campos", "+34600000105", "sent", "pendiente", 0],
  ["Íñigo Beltrán", "+34600000106", "sent", "pendiente", 0],
  ["Rocío y Dani", "+34600000107", "prep", "pendiente", 1],
  ["Abuela Pilar", null, "prep", "pendiente", 0],
  ["Sergio Muñoz", "+34600000109", "prep", "pendiente", 0],
  ["Paula Etxeberria", "+34600000110", "none", "pendiente", 0],
  ["Compañeros de la oficina", null, "none", "pendiente", 0],
  ["Javier y Alba", "+34600000112", "sent", "si", 1],
];

function guestRow([name, phone, state, rsvp, companions], index) {
  const prepared = state !== "none";
  return {
    wedding_id: wedding.id,
    name,
    phone,
    rsvp_status: rsvp,
    rsvp_companions: rsvp === "si" ? companions : 0,
    source: "couple",
    // Hash de un token aleatorio que no se guarda: la pareja regenera el
    // enlace desde el panel cuando lo quiera compartir.
    invitation_token_hash: prepared ? createHash("sha256").update(randomBytes(32)).digest("hex") : null,
    invitation_prepared_at: prepared ? ago(14 - (index % 5)) : null,
    invitation_sent_at: state === "sent" ? ago(12 - (index % 5)) : null,
  };
}

{
  const { data: existing, error } = await admin.from("wedding_guests").select("name").eq("wedding_id", wedding.id);
  if (error) fail(`No se pudieron leer los invitados (${error.code ?? "?"}).`);
  const present = new Set((existing ?? []).map((g) => g.name));
  const missing = GUESTS.map(guestRow).filter((g) => !present.has(g.name));
  if (missing.length === 0) {
    console.log(`✓ Invitados de demo ya presentes (${present.size}).`);
  } else {
    let { error: insertError } = await admin.from("wedding_guests").insert(missing);
    if (isMissingSchema(insertError)) {
      // Entorno sin las columnas de invitación (migraciones 20260930/20261002 pendientes).
      const legacy = missing.map((row) => {
        const copy = { ...row };
        delete copy.invitation_token_hash;
        delete copy.invitation_prepared_at;
        delete copy.invitation_sent_at;
        return copy;
      });
      ({ error: insertError } = await admin.from("wedding_guests").insert(legacy));
      if (!insertError) console.log("· Sin columnas de invitación en este entorno: estados de envío omitidos.");
    }
    if (insertError) fail(`No se pudieron crear los invitados (${insertError.code ?? "?"}).`);
    console.log(`✓ ${missing.length} invitados ficticios añadidos.`);
  }
}

console.log(`  Entrad en /login?clave=1 con ${EMAIL}; la web pública está en /b/${wedding.slug}.`);
