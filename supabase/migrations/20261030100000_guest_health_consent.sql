-- Consentimiento de salud guardado y nota logística aparte (revisión Fable, P1-5).
--
-- Hasta ahora el invitado tenía UN campo («Alergias, intolerancias o cualquier
-- cosa que deban saber») y el formulario exigía aceptar «datos de salud» para
-- cualquier nota, también una logística («vamos con carrito de bebé»). El
-- servidor lo exigía, pero el consentimiento no se guardaba en ninguna parte.
--
-- Decisión de columnas (ventana «migración en producción antes que el código»):
--  * rsvp_notes SIGUE SIENDO la nota de salud (alergias e intolerancias) del
--    invitado y, como hasta ahora, los apuntes de la pareja en la ficha
--    (rsvp_notes_by_guest = false). No se mueve nada: el código desplegado lee
--    rsvp_notes en la ficha, el catering, la impresión, el CSV y el plano, y
--    escribe ahí la nota del formulario (que ya exigía el consentimiento).
--    Mover las notas a una columna nueva las habría escondido de ese código
--    hasta el despliegue.
--  * rsvp_logistic_notes (nueva): «Algo más que debamos saber». Solo la escribe
--    el invitado por la RPC; no son datos de salud, no piden consentimiento.
--  * health_consent_at / health_consent_version (nuevas): cuándo y con qué
--    texto aceptó el invitado que la pareja conozca su nota de salud.
--
-- Invariante (CHECK): una nota del invitado (rsvp_notes_by_guest) siempre
-- lleva su consentimiento. Las notas de la pareja no lo necesitan (las escribe
-- ella misma) y no lo llevan: si la pareja sobrescribe la nota, el trigger de
-- autoría borra el consentimiento.
--
-- Datos existentes: las notas del invitado (by_guest = true) se recogieron con
-- el formulario que exigía la casilla → versión 'legacy-2026-10' y fecha de su
-- respuesta. Las de by_guest = false NO se marcan: son de la pareja o de antes
-- de 20261021120000 y no se pueden distinguir (marcarlas inventaría un
-- consentimiento).
--
-- guest_rsvp_respond:
--  * NUEVA sobrecarga de 9 argumentos, todos sin valor por defecto y con
--    nombres propios (p_health_notes, p_logistic_notes,
--    p_health_consent_version): PostgREST no la confunde con la de 7 (patrón
--    de 20261018100000). Cuerpo = 20261023110000 + notas separadas.
--  * La de 7 (código desplegado) pasa a envoltorio: p_notes es la nota de
--    salud con versión 'legacy-2026-10' (ese formulario no la deja enviar sin
--    la casilla) y no toca la nota logística. La de 5 sigue llamando a la de 7.
-- guest_rsvp_current: + logistic_notes, health_consent_at y
--   health_consent_version (solo con la nota del propio invitado); 'notes' igual.
-- anonymise_expired_guests: mismo cuerpo que 20261029100000 + las columnas nuevas.
-- Aditiva para el código desplegado.
begin;

-- ------------------------------------------------------------ columnas
alter table public.wedding_guests
  add column if not exists rsvp_logistic_notes text,
  add column if not exists health_consent_at timestamptz,
  add column if not exists health_consent_version text;

alter table public.wedding_guests drop constraint if exists rsvp_logistic_notes_length;
alter table public.wedding_guests
  add constraint rsvp_logistic_notes_length check (rsvp_logistic_notes is null or char_length(rsvp_logistic_notes) <= 500);
alter table public.wedding_guests drop constraint if exists health_consent_version_format;
alter table public.wedding_guests
  add constraint health_consent_version_format check (health_consent_version is null or health_consent_version ~ '^[a-z0-9.-]{1,40}$');

comment on column public.wedding_guests.rsvp_notes is
  'Alergias o intolerancias (datos de salud) que escribió el invitado con su consentimiento (rsvp_notes_by_guest = true), o apuntes de la pareja en la ficha (false).';
comment on column public.wedding_guests.rsvp_logistic_notes is
  '«Algo más que debamos saber»: nota logística del invitado (sin datos de salud, sin consentimiento). Solo la escribe guest_rsvp_respond.';
comment on column public.wedding_guests.health_consent_at is
  'Cuándo aceptó el invitado que la pareja conozca su nota de salud (rsvp_notes). NULL si la nota no es suya.';
comment on column public.wedding_guests.health_consent_version is
  'Versión del texto de consentimiento aceptado («legacy-2026-10» = formulario anterior a 20261030100000).';

-- ------------------------------------------------------------ datos existentes
update public.wedding_guests g
   set health_consent_at = coalesce(g.responded_at, g.updated_at, pg_catalog.now()),
       health_consent_version = 'legacy-2026-10'
 where g.rsvp_notes_by_guest and g.rsvp_notes is not null and g.health_consent_at is null;

-- Una nota del invitado siempre lleva su consentimiento; fecha y versión van juntas.
alter table public.wedding_guests drop constraint if exists wedding_guests_health_consent;
alter table public.wedding_guests
  add constraint wedding_guests_health_consent check (
    (health_consent_at is null) = (health_consent_version is null)
    and (not rsvp_notes_by_guest or rsvp_notes is null or health_consent_at is not null)
  );

-- ------------------------------------------------------------ trigger de autoría
-- Igual que 20261021120000 y, si la nota pasa a ser de la pareja, fuera el
-- consentimiento: no se refiere a un texto que el invitado no escribió.
create or replace function public.wedding_guests_notes_owner()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.rsvp_notes is distinct from old.rsvp_notes
     and coalesce(pg_catalog.current_setting('vinklo.guest_rsvp_write', true), '') <> 'on' then
    new.rsvp_notes_by_guest := false;
    new.health_consent_at := null;
    new.health_consent_version := null;
  end if;
  return new;
end;
$$;
revoke all on function public.wedding_guests_notes_owner() from public, anon, authenticated;

-- ------------------------------------------------------------ guest_rsvp_respond (9)
create or replace function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_health_notes text,
  p_logistic_notes text,
  p_health_consent_version text,
  p_answers jsonb,
  p_companion_list jsonb
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
  v_health text := nullif(pg_catalog.btrim(coalesce(p_health_notes, '')), '');
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
         -- blanco, solo se borra la que escribió él: una nota de la pareja se queda.
         rsvp_notes = case
           when v_health is not null then v_health
           when g.rsvp_notes_by_guest then null
           else g.rsvp_notes
         end,
         rsvp_notes_by_guest = v_health is not null,
         -- El consentimiento acompaña a SU nota: se renueva al enviarla y se
         -- borra con ella (una nota de la pareja no lo lleva).
         health_consent_at = case when v_health is not null then pg_catalog.now() end,
         health_consent_version = case when v_health is not null then p_health_consent_version end,
         -- NULL = no se toca (envoltorio del formulario anterior); '' la borra.
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
comment on function public.guest_rsvp_respond(text, text, text, integer, text, text, text, jsonb, jsonb) is
  'RSVP con enlace personal (cuerpo de 20261023110000) + nota de salud con consentimiento versionado y nota logística aparte (20261030100000). Solo service_role (server action submitRsvp).';
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text, text, text, jsonb, jsonb) to service_role;

-- ------------------------------------------------------------ guest_rsvp_respond (7)
-- Envoltorio para el código desplegado: su único campo exigía la casilla de
-- salud (submitRsvp lo rechaza sin ella), así que p_notes es la nota de salud
-- con la versión del formulario anterior. La nota logística no se toca.
create or replace function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_notes text,
  p_answers jsonb,
  p_companion_list jsonb default null
) returns text
language sql volatile security definer set search_path = '' as $$
  select public.guest_rsvp_respond(
    p_slug, p_token_hash, p_status, p_companions,
    p_notes, null::text,
    case when nullif(pg_catalog.btrim(coalesce(p_notes, '')), '') is not null then 'legacy-2026-10' end,
    p_answers, p_companion_list);
$$;
comment on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb, jsonb) is
  'Envoltorio (20261030100000) del formulario anterior: p_notes = nota de salud con consentimiento «legacy-2026-10». Solo service_role.';
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb, jsonb) to service_role;

-- ------------------------------------------------------------ guest_rsvp_current
-- Mismo cuerpo que 20261023110000 + nota logística y consentimiento (solo de
-- su propia nota de salud: los apuntes de la pareja nunca le llegan).
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
       where c.guest_id = v_guest_id and c.wedding_id = v_wedding_id and c.by_guest), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
comment on function public.guest_rsvp_current(text, text) is
  'Respuesta actual del invitado con enlace personal, su tope de acompañantes, los nombres que escribió y su nota logística y consentimiento de salud (20261021100000, 20261021110000, 20261023110000, 20261030100000). status NULL si aún no respondió. Solo service_role (página /b/[slug]).';
revoke all on function public.guest_rsvp_current(text, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_current(text, text) to service_role;

-- ------------------------------------------------------------ retención
-- Mismo cuerpo que 20261029100000; en invitados además la nota logística, el
-- consentimiento y la autoría (si no, el CHECK de consentimiento no cuadra).
create or replace function public.anonymise_expired_guests(p_today date, p_limit integer default 200)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_has_companions boolean := pg_catalog.to_regclass('public.wedding_guest_companions') is not null;
begin
  if p_today is null then
    raise exception 'p_today is required';
  end if;

  select coalesce(array_agg(x.id), '{}') into v_ids
  from (
    select w.id
    from public.weddings w
    join public.wedding_retention r on r.wedding_id = w.id
    where w.wedding_date is not null
      and (w.wedding_date + interval '12 months')::date <= p_today
      and r.notice_sent_at is not null
      and (r.notice_sent_at at time zone 'Europe/Madrid')::date + 30 <= p_today
      and r.anonymised_at is null
    order by w.wedding_date, w.id
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
    for update of r skip locked
  ) x;

  if pg_catalog.cardinality(v_ids) = 0 then
    return 0;
  end if;

  -- Primero la marca: el trigger de huérfanos de regalos la consulta para no
  -- borrar los regalos al quitarles los regalantes (20261026100000).
  update public.wedding_retention r
     set anonymised_at = pg_catalog.now()
   where r.wedding_id = any(v_ids);

  -- Acompañantes con nombre (tabla de otra rama): si existe, sus filas se
  -- borran. Se localizan por wedding_id si la tabla lo tiene; si no, por guest_id.
  if v_has_companions then
    if exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.wedding_guest_companions'::regclass and a.attname = 'wedding_id' and not a.attisdropped
    ) then
      execute 'delete from public.wedding_guest_companions where wedding_id = any($1)' using v_ids;
    elsif exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.wedding_guest_companions'::regclass and a.attname = 'guest_id' and not a.attisdropped
    ) then
      execute 'delete from public.wedding_guest_companions c using public.wedding_guests g
               where c.guest_id = g.id and g.wedding_id = any($1)' using v_ids;
    end if;
  end if;

  delete from public.wedding_guest_tokens t where t.wedding_id = any(v_ids);

  update public.wedding_guests g
     set phone = null,
         notes = null,
         rsvp_notes = null,
         rsvp_notes_by_guest = false,
         rsvp_logistic_notes = null,
         health_consent_at = null,
         health_consent_version = null,
         rsvp_answers = null,
         rsvp_key_hash = null,
         invitation_token_hash = null
   where g.wedding_id = any(v_ids);

  -- Regalos (20261026100000): fuera quién y el texto libre; se quedan tipo,
  -- importe, fechas y «agradecido».
  delete from public.wedding_gift_givers gg where gg.wedding_id = any(v_ids);

  update public.wedding_gifts f
     set note = null,
         description = null
   where f.wedding_id = any(v_ids)
     and (f.note is not null or f.description is not null);

  -- Contribuciones (20261029100000): fuera correo y mensaje; el nombre queda
  -- en «primer nombre + inicial del siguiente» («María G.») o «Invitado».
  -- Se conservan importes, método, estado y ids de Stripe (contabilidad).
  update public.contributions c
     set guest_email = null,
         message = null,
         guest_name = coalesce(
           nullif(
             pg_catalog.concat_ws(' ',
               nullif(pg_catalog.split_part(pg_catalog.btrim(c.guest_name), ' ', 1), ''),
               nullif(pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(c.guest_name), ' ', 2), 1), '') || '.'),
             ''),
           'Invitado')
   where c.wedding_id = any(v_ids);

  return pg_catalog.cardinality(v_ids);
end;
$$;
revoke all on function public.anonymise_expired_guests(date, integer) from public, anon, authenticated;
grant execute on function public.anonymise_expired_guests(date, integer) to service_role;

notify pgrst, 'reload schema';
commit;
