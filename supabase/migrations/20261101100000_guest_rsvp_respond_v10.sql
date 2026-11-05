-- Enlace personal sin datos privados, PASO 1 de 2 (revisión de seguridad M1,
-- 14-oct-2026; revisión del bloque 1, F1 y F5). ADITIVA: se aplica ANTES de
-- desplegar el código que llama a la sobrecarga de 10.
--
-- Por qué dos pasos: si guest_rsvp_current dejara de devolver los textos
-- mientras sigue en producción el formulario anterior, ese formulario saldría
-- vacío y, al reenviarlo, borraría la nota de salud (y su consentimiento), la
-- nota logística y los nombres de los acompañantes. Este paso no quita nada:
--
-- guest_rsvp_respond:
--  * NUEVA sobrecarga de 10 argumentos (+ p_keep_health_notes boolean, todos
--    con nombre y sin valor por defecto; patrón de 20261018100000). El
--    formulario nuevo ya no ve la nota, así que deja el campo vacío con un
--    aviso: p_keep_health_notes = true y nota en blanco conserva la que
--    escribió el invitado (con su consentimiento y su fecha original). Para la
--    nota logística y los nombres ya existía «NULL = no se toca».
--  * Con «no» no se guarda ninguna nota de salud y se borra la del invitado
--    (minimización: no hay menú que organizar).
--  * Las de 9, 7 y 5 NO se tocan: el código desplegado sigue exactamente
--    igual. Como en este paso guest_rsvp_current aún le devuelve los textos,
--    su formulario los precarga y los reenvía: un campo en blanco sigue siendo
--    un borrado deliberado del invitado.
--
-- guest_rsvp_current:
--  * Devuelve LO MISMO que en 20261030100000 (notes, logistic_notes,
--    health_consent_version, companion_list…) MÁS los booleanos que lee el
--    código nuevo: has_health_note (solo si la nota es del propio invitado),
--    has_logistic_note y has_companion_names. El código nuevo descarta los
--    textos en el servidor (lib/rsvp-previous.ts): no llegan al HTML.
--  * El plazo cerrado ({"closed": true}) y la retirada de los textos llegan en
--    el paso 2 (20261101110000), que se aplica DESPUÉS del despliegue.
begin;

-- ------------------------------------------------------------ guest_rsvp_respond (10)
-- Cuerpo = 20261030100000 (9) + conservar la nota de salud + «no» sin salud.
create or replace function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_health_notes text,
  p_logistic_notes text,
  p_health_consent_version text,
  p_answers jsonb,
  p_companion_list jsonb,
  p_keep_health_notes boolean
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
  v_max_companions smallint;
  -- Con «no» la nota de salud no se guarda (ni se valida su consentimiento).
  v_health text := case when p_status = 'si' then nullif(pg_catalog.btrim(coalesce(p_health_notes, '')), '') end;
  -- Conservar solo con «sí» y sin nota nueva.
  v_keep boolean := coalesce(p_keep_health_notes, false) and p_status = 'si'
                    and nullif(pg_catalog.btrim(coalesce(p_health_notes, '')), '') is null;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_status is null or p_status not in ('si', 'no')
     or p_companions is null or p_companions < 0 or p_companions > 10
     or (p_health_notes is not null and pg_catalog.char_length(p_health_notes) > 500)
     or (p_logistic_notes is not null and pg_catalog.char_length(p_logistic_notes) > 500)
     -- Datos de salud (art. 9 RGPD): sin consentimiento con versión no se guardan.
     or (v_health is not null and (p_health_consent_version is null or p_health_consent_version !~ '^[a-z0-9.-]{1,40}$'))
     or (p_answers is not null and (pg_catalog.jsonb_typeof(p_answers) <> 'object' or pg_catalog.octet_length(p_answers::text) > 4096))
     or (p_companion_list is not null and (pg_catalog.octet_length(p_companion_list::text) > 4096
         or not public.guest_companion_list_valid(p_companion_list, case when p_status = 'si' then p_companions else 0 end))) then
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
  select g.max_companions into v_max_companions from public.wedding_guests g
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

  -- 3) Web retirada (publicada alguna vez y sin revisión vigente).
  select s.published_at, s.published_revision_id into v_published_at, v_revision
    from public.wedding_sites s where s.wedding_id = v_wedding_id
    for share;
  if found and v_published_at is not null and v_revision is null then return 'withdrawn'; end if;

  if pg_catalog.now() >= public.guest_rsvp_closes_at(v_wedding_date, v_rsvp_deadline, v_token_created) then
    return 'closed';
  end if;

  -- Tope de acompañantes de la invitación (NULL = libre hasta 10).
  if p_status = 'si' and v_max_companions is not null and p_companions > v_max_companions then
    return 'too_many';
  end if;

  if not public.rl_check(
    'rsvp-wedding:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_wedding_id::text, 'UTF8')), 'hex'),
    600, 3600) then
    return 'rate_limited';
  end if;

  -- Los triggers de autoría (nota y acompañantes) no deben tratar esta escritura como de la pareja.
  perform pg_catalog.set_config('vinklo.guest_rsvp_write', 'on', true);
  update public.wedding_guests g
     set rsvp_status = p_status,
         rsvp_companions = case when p_status = 'si' then p_companions else 0 end,
         -- La nota de salud del invitado sustituye a la anterior. Si la deja en
         -- blanco: con «conservar» se queda la suya; si no, solo se borra la que
         -- escribió él (una nota de la pareja se queda siempre).
         rsvp_notes = case
           when v_health is not null then v_health
           when v_keep and g.rsvp_notes_by_guest then g.rsvp_notes
           when g.rsvp_notes_by_guest then null
           else g.rsvp_notes
         end,
         rsvp_notes_by_guest = v_health is not null or (v_keep and g.rsvp_notes_by_guest),
         -- El consentimiento acompaña a SU nota: se renueva al enviarla, se
         -- conserva (con su fecha) si la conserva y se borra con ella.
         health_consent_at = case
           when v_health is not null then pg_catalog.now()
           when v_keep and g.rsvp_notes_by_guest then g.health_consent_at
         end,
         health_consent_version = case
           when v_health is not null then p_health_consent_version
           when v_keep and g.rsvp_notes_by_guest then g.health_consent_version
         end,
         -- NULL = no se toca; '' la borra.
         rsvp_logistic_notes = case
           when p_logistic_notes is null then g.rsvp_logistic_notes
           else nullif(pg_catalog.btrim(p_logistic_notes), '')
         end,
         -- Con «no» no quedan respuestas de módulos (ni autobús ni menú).
         rsvp_answers = case when p_status = 'si' and p_answers is not null and p_answers <> '{}'::jsonb then p_answers else null end,
         responded_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;

  -- Nombres de acompañantes (20261023110000). NULL = no se tocan.
  if p_companion_list is not null then
    if p_status = 'si' and pg_catalog.jsonb_array_length(p_companion_list) > 0 then
      -- El invitado manda: su lista sustituye a todas las de su invitación.
      -- Quien coincide por nombre (sin mayúsculas) conserva su fila y su mesa.
      -- Fuera los que no están (y los duplicados por nombre que hubiera escrito la pareja).
      delete from public.wedding_guest_companions c
       where c.guest_id = v_guest_id and c.wedding_id = v_wedding_id
         and (not exists (select 1 from pg_catalog.jsonb_array_elements(p_companion_list) e
                           where pg_catalog.lower(pg_catalog.btrim(e->>'name')) = pg_catalog.lower(c.name))
              or exists (select 1 from public.wedding_guest_companions d
                          where d.guest_id = c.guest_id and pg_catalog.lower(d.name) = pg_catalog.lower(c.name) and d.id < c.id));
      update public.wedding_guest_companions c
         set name = pg_catalog.btrim(e.value->>'name'), is_kid = coalesce((e.value->>'kid')::boolean, false),
             position = (e.ord - 1)::smallint, by_guest = true
        from pg_catalog.jsonb_array_elements(p_companion_list) with ordinality as e(value, ord)
       where c.guest_id = v_guest_id and c.wedding_id = v_wedding_id
         and pg_catalog.lower(c.name) = pg_catalog.lower(pg_catalog.btrim(e.value->>'name'));
      insert into public.wedding_guest_companions (wedding_id, guest_id, name, is_kid, position, by_guest)
      select v_wedding_id, v_guest_id, pg_catalog.btrim(e.value->>'name'), coalesce((e.value->>'kid')::boolean, false), (e.ord - 1)::smallint, true
        from pg_catalog.jsonb_array_elements(p_companion_list) with ordinality as e(value, ord)
       where not exists (select 1 from public.wedding_guest_companions c
                          where c.guest_id = v_guest_id and pg_catalog.lower(c.name) = pg_catalog.lower(pg_catalog.btrim(e.value->>'name')));
    else
      delete from public.wedding_guest_companions c
       where c.guest_id = v_guest_id and c.wedding_id = v_wedding_id and c.by_guest;
    end if;
  end if;
  return 'ok';
end;
$$;
comment on function public.guest_rsvp_respond(text, text, text, integer, text, text, text, jsonb, jsonb, boolean) is
  'RSVP con enlace personal (cuerpo de 20261030100000) + p_keep_health_notes: nota en blanco conserva la del invitado y su consentimiento; con «no» no se guarda salud (20261101100000, paso 1 de 2). Solo service_role (server action submitRsvp).';
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text, text, text, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text, text, text, jsonb, jsonb, boolean) to service_role;

-- ------------------------------------------------------------ guest_rsvp_current
-- Cuerpo de 20261030100000 + has_health_note / has_logistic_note / has_companion_names.
create or replace function public.guest_rsvp_current(p_slug text, p_token_hash text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_wedding_id uuid;
  v_guest_id uuid;
  v_row record;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select w.id into v_wedding_id from public.weddings w where w.slug = p_slug;
  if v_wedding_id is null then return null; end if;
  -- El token solo vale dentro de SU boda y si sigue activo.
  select t.guest_id into v_guest_id
    from public.wedding_guest_tokens t
   where t.wedding_id = v_wedding_id and t.token_hash = p_token_hash and t.revoked_at is null;
  if v_guest_id is null then return null; end if;

  select g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.rsvp_notes_by_guest, g.rsvp_logistic_notes,
         g.health_consent_at, g.health_consent_version, g.rsvp_answers, g.responded_at, g.max_companions
    into v_row
    from public.wedding_guests g
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  if not found then return null; end if;

  -- Pendiente: sin respuesta que rellenar (nada de la ficha), solo el tope.
  if v_row.rsvp_status is null or v_row.rsvp_status not in ('si', 'no') then
    return pg_catalog.jsonb_build_object('status', null, 'max_companions', v_row.max_companions);
  end if;

  return pg_catalog.jsonb_build_object(
    'max_companions', v_row.max_companions,
    'status', v_row.rsvp_status,
    'companions', coalesce(v_row.rsvp_companions, 0),
    -- Solo la nota que escribió el propio invitado: la pareja usa el mismo
    -- campo para apuntes privados que el invitado nunca debe ver.
    'notes', case when v_row.rsvp_notes_by_guest then v_row.rsvp_notes else null end,
    'health_consent_at', case when v_row.rsvp_notes_by_guest then v_row.health_consent_at else null end,
    'health_consent_version', case when v_row.rsvp_notes_by_guest then v_row.health_consent_version else null end,
    -- La logística solo la escribe él (la RPC): se le devuelve para corregirla.
    'logistic_notes', v_row.rsvp_logistic_notes,
    'answers', v_row.rsvp_answers,
    'responded_at', v_row.responded_at,
    -- Igual con los nombres: solo los que escribió él.
    'companion_list', case when v_row.rsvp_status = 'si' then coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', c.name, 'kid', c.is_kid) order by c.position, c.created_at, c.id)
        from public.wedding_guest_companions c
       where c.guest_id = v_guest_id and c.wedding_id = v_wedding_id and c.by_guest), '[]'::jsonb) else '[]'::jsonb end,
    -- 20261101100000: lo que lee el código nuevo (sin textos).
    'has_health_note', coalesce(v_row.rsvp_notes_by_guest and v_row.rsvp_notes is not null, false),
    'has_logistic_note', v_row.rsvp_logistic_notes is not null,
    'has_companion_names', v_row.rsvp_status = 'si' and exists (
      select 1 from public.wedding_guest_companions c
       where c.guest_id = v_guest_id and c.wedding_id = v_wedding_id and c.by_guest)
  );
end;
$$;
comment on function public.guest_rsvp_current(text, text) is
  'Respuesta actual del invitado con enlace personal (cuerpo de 20261030100000) + has_health_note / has_logistic_note / has_companion_names (20261101100000, paso 1 de 2: los textos se retiran en 20261101110000). status NULL si aún no respondió. Solo service_role (página /b/[slug]).';
revoke all on function public.guest_rsvp_current(text, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_current(text, text) to service_role;

notify pgrst, 'reload schema';
commit;
