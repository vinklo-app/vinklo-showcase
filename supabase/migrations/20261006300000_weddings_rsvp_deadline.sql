-- Fecha límite de confirmación elegida por la pareja (weddings.rsvp_deadline).
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
-- Aplicar ANTES de desplegar el código que la usa (ajustes la escriben y la
-- página pública la lee de weddings_public).
--
-- Decisión del propietario: los invitados no deben poder responder cuando la
-- boda ya pasó, y la pareja decide hasta cuándo acepta respuestas.
--   * rsvp_deadline: último día (incluido, hora de Madrid) para responder.
--     Nullable: sin fecha se mantiene la regla de 20261006100000 (H11): fin
--     del día siguiente a la boda o, sin fecha de boda, 365 días tras emitir
--     el token.
--   * Con fecha límite, el cierre es el final de ese día en Madrid, aunque no
--     haya fecha de boda.
--   * Invariante: si ambas existen, rsvp_deadline <= wedding_date (check).
--   * Si la fecha de la boda se adelanta por otra vía (publicar sincroniza
--     wedding_date desde la portada) y queda antes de la fecha límite, un
--     trigger ajusta la fecha límite al día de la boda en vez de hacer fallar
--     esa sincronización. Ajustes valida el par con Zod y avisa a la pareja;
--     el trigger solo actúa cuando quien actualiza no cambia también la fecha
--     límite en la misma sentencia.
--   * La pareja la edita con la misma ruta que el resto de ajustes: cliente
--     de sesión + RLS + privilegio de columna (20260907180000 pasó weddings a
--     grants por columna; 20261006102000 retiró slug).
--   * guest_rsvp_respond se recrea idéntica salvo que lee rsvp_deadline y usa
--     el nuevo guest_rsvp_closes_at de tres argumentos. El de dos argumentos
--     se conserva (compatibilidad y pruebas).
--   * weddings_public añade rsvp_deadline al final (create or replace solo
--     permite añadir columnas al final); se conservan columnas, orden,
--     security_invoker y grants (solo service_role).
begin;

-- ------------------------------------------------------------ columna
alter table public.weddings
  add column if not exists rsvp_deadline date;

alter table public.weddings
  drop constraint if exists weddings_rsvp_deadline_before_wedding;
alter table public.weddings
  add constraint weddings_rsvp_deadline_before_wedding
  check (rsvp_deadline is null or wedding_date is null or rsvp_deadline <= wedding_date);

comment on column public.weddings.rsvp_deadline is
  'Último día (incluido, Europe/Madrid) en que la invitación acepta respuestas. Null = regla por defecto (día siguiente a la boda o 365 días tras emitir el enlace).';

-- La pareja la fija y la borra desde ajustes (RLS couple_id sigue acotando la fila).
grant update (rsvp_deadline) on public.weddings to authenticated;

-- ---------------------------------- ajuste si la boda se adelanta
create or replace function public.weddings_rsvp_deadline_follow_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.wedding_date is distinct from old.wedding_date
     and new.rsvp_deadline is not distinct from old.rsvp_deadline
     and new.rsvp_deadline is not null
     and new.wedding_date is not null
     and new.rsvp_deadline > new.wedding_date then
    new.rsvp_deadline := new.wedding_date;
  end if;
  return new;
end;
$$;
revoke all on function public.weddings_rsvp_deadline_follow_date() from public, anon, authenticated;

drop trigger if exists weddings_rsvp_deadline_follow_date on public.weddings;
create trigger weddings_rsvp_deadline_follow_date
  before update of wedding_date on public.weddings
  for each row execute function public.weddings_rsvp_deadline_follow_date();

-- ------------------------------------------------------ cierre efectivo
create or replace function public.guest_rsvp_closes_at(
  p_wedding_date date,
  p_rsvp_deadline date,
  p_token_created_at timestamptz
)
returns timestamptz
language sql stable parallel safe set search_path = '' as $$
  select case
    when p_rsvp_deadline is not null
      then ((p_rsvp_deadline + 1)::timestamp at time zone 'Europe/Madrid')
    else public.guest_rsvp_closes_at(p_wedding_date, p_token_created_at)
  end;
$$;
comment on function public.guest_rsvp_closes_at(date, date, timestamptz) is
  'Momento en que un enlace personal deja de aceptar respuestas: fin del día rsvp_deadline (Europe/Madrid) si la pareja la fijó; si no, la regla de dos argumentos.';
revoke all on function public.guest_rsvp_closes_at(date, date, timestamptz) from public, anon, authenticated;
grant execute on function public.guest_rsvp_closes_at(date, date, timestamptz) to service_role;

-- ------------------------------------------- respuesta (igual + plazo)
-- Resultado (texto, nunca lanza por datos del invitado):
--   ok            respuesta guardada
--   invalid       datos fuera de contrato (la server action ya los valida)
--   unavailable   boda inexistente, token inexistente/revocado/de otra boda,
--                 o invitado borrado (misma respuesta: no enumera)
--   withdrawn     la pareja retiró la web
--   closed        fuera de plazo (fecha límite de la pareja o regla por defecto)
--   rate_limited  límite agregado de la boda superado
create or replace function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_notes text
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_wedding_id uuid;
  v_wedding_date date;
  v_rsvp_deadline date;
  v_guest_id uuid;
  v_token_created timestamptz;
  v_published_at timestamptz;
  v_revision uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_status is null or p_status not in ('si', 'no')
     or p_companions is null or p_companions < 0 or p_companions > 10
     or (p_notes is not null and pg_catalog.char_length(p_notes) > 500) then
    return 'invalid';
  end if;

  select w.id, w.wedding_date, w.rsvp_deadline into v_wedding_id, v_wedding_date, v_rsvp_deadline
    from public.weddings w where w.slug = p_slug;
  if v_wedding_id is null then return 'unavailable'; end if;

  -- Localiza el invitado (sin lock: aún no conocemos la fila a bloquear).
  select t.guest_id into v_guest_id
    from public.wedding_guest_tokens t
   where t.wedding_id = v_wedding_id and t.token_hash = p_token_hash and t.revoked_at is null;
  if v_guest_id is null then return 'unavailable'; end if;

  -- 1) Lock del invitado: mismo primer lock que issue_guest_token.
  perform 1 from public.wedding_guests g
    where g.id = v_guest_id and g.wedding_id = v_wedding_id
    for update;
  if not found then return 'unavailable'; end if;

  -- 2) Re-lectura del token bajo el lock (snapshot nuevo) + FOR SHARE: una
  --    revocación confirmada mientras esperábamos ya es visible aquí.
  select t.created_at into v_token_created
    from public.wedding_guest_tokens t
   where t.token_hash = p_token_hash and t.wedding_id = v_wedding_id
     and t.guest_id = v_guest_id and t.revoked_at is null
   for share;
  if not found then return 'unavailable'; end if;

  -- 3) Web retirada (publicada alguna vez y sin revisión vigente). Sin fila o
  --    nunca publicada = boda servida por el adaptador v1: se acepta, como en
  --    getPublicSite (que además valida el documento antes de llegar aquí).
  select s.published_at, s.published_revision_id into v_published_at, v_revision
    from public.wedding_sites s where s.wedding_id = v_wedding_id
    for share;
  if found and v_published_at is not null and v_revision is null then return 'withdrawn'; end if;

  if pg_catalog.now() >= public.guest_rsvp_closes_at(v_wedding_date, v_rsvp_deadline, v_token_created) then
    return 'closed';
  end if;

  if not public.rl_check(
    'rsvp-wedding:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_wedding_id::text, 'UTF8')), 'hex'),
    600, 3600) then
    return 'rate_limited';
  end if;

  update public.wedding_guests g
     set rsvp_status = p_status,
         rsvp_companions = case when p_status = 'si' then p_companions else 0 end,
         rsvp_notes = nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
         updated_at = pg_catalog.now()
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  return 'ok';
end;
$$;
comment on function public.guest_rsvp_respond(text, text, text, integer, text) is
  'Respuesta RSVP con enlace personal en una transacción: lock del invitado, token activo re-leído bajo lock, web no retirada, plazo (fecha límite de la pareja o regla por defecto) y límite por boda. Solo service_role.';
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text) to service_role;

-- -------------------------------------------- vista pública (+ plazo)
-- Mismas columnas y orden que 20260930220000; rsvp_deadline al final.
create or replace view public.weddings_public
with (security_invoker = true)
as select
  w.slug,
  w.partner_name_1,
  w.partner_name_2,
  w.wedding_date,
  w.cubierto_price_cents,
  w.cover_image_url,
  w.bizum_phone,
  w.stripe_onboarded,
  w.plan,
  w.page_config,
  w.rsvp_deadline
from public.weddings w;

revoke all on public.weddings_public from public, anon, authenticated;
grant select on public.weddings_public to service_role;

commit;
