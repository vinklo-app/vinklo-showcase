-- Endurecimiento tras la auditoría del 2026-09-06 (docs/audits/2026-09-07-hardening.md).
-- Aplicada a producción a mano el 2026-09-07 con `supabase db query --linked -f`.
--
-- 1) CRÍTICO — las vistas públicas eran ACTUALIZABLES por `authenticated`:
--    `weddings_public` es una vista simple (auto-updatable) con
--    security_invoker=false, y el rol `authenticated` conservaba INSERT/UPDATE/
--    DELETE por los grants por defecto de Supabase. Cualquier pareja logueada
--    podía `UPDATE weddings_public SET plan='premium'` (o DELETE) sobre bodas
--    AJENAS, porque la vista corre como su owner y se salta RLS. La migración
--    20260714110000 solo revocó SELECT. Nadie lee estas vistas salvo el servidor
--    con service role (que salta RLS), así que se revoca TODO y además se pasan a
--    security_invoker=true por si algún día vuelven a exponerse.
-- 2) ALTO — RLS acota la boda, no las columnas: la pareja podía marcar su propio
--    `plan='premium'` sin pagar o pisar `stripe_account_id`/`stripe_onboarded`
--    vía PostgREST. Ahora los privilegios de escritura sobre `weddings` son POR
--    COLUMNA (solo lo que crea/edita el onboarding y las preferencias).
-- 3) `contributions`: la pareja solo puede tocar `status` (confirmar Bizum manual).
-- 4) Privilegios que RLS no cubre (TRUNCATE) o que nadie usa (REFERENCES,
--    TRIGGER), y tablas que solo escribe el servidor (waitlist, events).
-- 5) `rl_check` atómico: count+insert se serializan por clave (advisory lock
--    transaccional); antes, N peticiones paralelas veían todas cnt < max.
-- 6) RSVP: `rsvp_key_hash` para que solo el dispositivo que confirmó pueda
--    corregir su fila (antes bastaba conocer el nombre).

begin;

-- ---------------------------------------------------------------- 1) vistas
revoke all on public.weddings_public from public, anon, authenticated;
revoke all on public.wedding_agenda_public from public, anon, authenticated;
alter view public.weddings_public set (security_invoker = true);
alter view public.wedding_agenda_public set (security_invoker = true);

-- ------------------------------------------------ 4) privilegios sin uso
revoke truncate, references, trigger on all tables in schema public
  from anon, authenticated;
revoke all on public.waitlist from anon, authenticated;
revoke all on public.rate_limit_hits from anon, authenticated;
revoke insert, update, delete on public.events from authenticated;
-- El perfil lo crea el trigger handle_new_user; la pareja solo lee/edita el suyo.
revoke insert, delete on public.profiles from authenticated;

-- ------------------------------------------- 2) weddings por columna
revoke insert, update on public.weddings from authenticated;
grant insert (
  slug, couple_id, partner_name_1, partner_name_2, wedding_date,
  guest_count_est, cubierto_price_cents, cover_image_url, bizum_phone,
  notify_contribution
) on public.weddings to authenticated;
grant update (
  slug, partner_name_1, partner_name_2, wedding_date, guest_count_est,
  cubierto_price_cents, cover_image_url, bizum_phone, notify_contribution
) on public.weddings to authenticated;

-- --------------------------------------- 3) contributions: solo status
revoke insert, update, delete on public.contributions from authenticated;
grant update (status) on public.contributions to authenticated;

-- Tablas nuevas: sin grants implícitos para authenticated (igual que anon
-- desde 20260707161251). Cada migración concede lo que necesita, explícito.
alter default privileges in schema public revoke all on tables from authenticated;

-- ------------------------------------------------ 5) rl_check atómico
create or replace function public.rl_check(
  p_key text,
  p_max int,
  p_window_secs int
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cnt int;
begin
  -- Serializa las llamadas concurrentes de la misma clave dentro de la
  -- transacción: el count y el insert dejan de ser una carrera.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_key));

  select count(*) into cnt
  from public.rate_limit_hits
  where bucket_key = p_key
    and created_at > pg_catalog.now() - pg_catalog.make_interval(secs => p_window_secs);

  if cnt >= p_max then
    return false;
  end if;

  insert into public.rate_limit_hits (bucket_key) values (p_key);
  return true;
end;
$$;

revoke all on function public.rl_check(text, int, int) from public, anon, authenticated;

-- ------------------------------------------------------ 6) RSVP key
alter table public.wedding_guests
  add column if not exists rsvp_key_hash text;
comment on column public.wedding_guests.rsvp_key_hash is
  'SHA-256 (hex) de la cookie de dispositivo del invitado que envió el RSVP. Solo ese dispositivo puede corregir la fila; otro envío con el mismo nombre crea una fila nueva. NULL en filas del tracker de la pareja y en RSVPs anteriores a 2026-09-07.';

commit;
