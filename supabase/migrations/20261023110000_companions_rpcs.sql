-- Nombres de acompañantes (§4.3) y restricciones de mesas (§3.5): RPC.
-- Necesita 20261023100000. Preparada y verificada en Postgres temporal. NO
-- aplicada en remoto. Aditiva para el código anterior:
--
--  * guest_rsvp_respond: la versión de 6 argumentos pasa a 7 con
--    p_companion_list jsonb DEFAULT NULL al final (drop + create: una sola
--    versión además del envoltorio de 5). Una llamada con los 6 nombres de
--    siempre sigue funcionando y no toca los nombres. Cuerpo = 20261021120000.
--      p_companion_list = [{ "name": "Lucía", "kid": true }, …] (≤ acompañantes)
--        · con nombres: el invitado manda; sustituyen a todos los de su
--          invitación (los que coinciden por nombre conservan su mesa);
--        · vacío o «no»: se borran solo los que escribió él (los de la
--          pareja se quedan, como su nota).
--  * guest_rsvp_current: + companion_list (solo los que escribió el invitado).
--  * set_guest_companions: la pareja guarda la lista de una invitación.
--  * wedding_seating: + companion_list y kids derivado (si hay nombres, los
--    marcados como niño/a; si no, rsvp_answers.kids) en cada invitado,
--    + pinned_group en cada mesa y + apart (pares «no sentar con…»).
--  * apply_seating: misma firma; p_assignments admite también
--    { "companionId": uuid, "tableId": uuid | "new:N" | null } (mesa infantil).
--    Con la versión anterior esos elementos se rechazan (no se ignoran).
begin;

-- ------------------------------------------------------------ helper
-- Lista de nombres que manda el invitado: array de objetos {name, kid?},
-- nombres recortados de 1 a 80 caracteres, sin repetir (sin mayúsculas).
create or replace function public.guest_companion_list_valid(p_list jsonb, p_max integer)
returns boolean language sql immutable set search_path = '' as $$
  select p_list is not null
     and pg_catalog.jsonb_typeof(p_list) = 'array'
     and pg_catalog.jsonb_array_length(p_list) <= least(coalesce(p_max, 0), 10)
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(p_list) e
        where pg_catalog.jsonb_typeof(e) <> 'object'
           or pg_catalog.jsonb_typeof(e->'name') is distinct from 'string'
           or pg_catalog.char_length(pg_catalog.btrim(e->>'name')) not between 1 and 80
           or (e ? 'kid' and pg_catalog.jsonb_typeof(e->'kid') <> 'boolean'))
     and (select count(distinct pg_catalog.lower(pg_catalog.btrim(e->>'name'))) from pg_catalog.jsonb_array_elements(p_list) e)
         = pg_catalog.jsonb_array_length(p_list);
$$;
revoke all on function public.guest_companion_list_valid(jsonb, integer) from public, anon;
grant execute on function public.guest_companion_list_valid(jsonb, integer) to authenticated, service_role;

-- ------------------------------------------------------------ guest_rsvp_respond
drop function if exists public.guest_rsvp_respond(text, text, text, integer, text, jsonb);
create function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_notes text,
  p_answers jsonb,
  p_companion_list jsonb default null
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
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_status is null or p_status not in ('si', 'no')
     or p_companions is null or p_companions < 0 or p_companions > 10
     or (p_notes is not null and pg_catalog.char_length(p_notes) > 500)
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
         -- La nota del invitado sustituye a la anterior. Si la deja en blanco,
         -- solo se borra la que escribió él: una nota de la pareja se queda.
         rsvp_notes = case
           when nullif(pg_catalog.btrim(coalesce(p_notes, '')), '') is not null then pg_catalog.btrim(p_notes)
           when g.rsvp_notes_by_guest then null
           else g.rsvp_notes
         end,
         rsvp_notes_by_guest = nullif(pg_catalog.btrim(coalesce(p_notes, '')), '') is not null,
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
comment on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb, jsonb) is
  'RSVP con enlace personal y respuestas de módulos (20261018100000) + responded_at (20261021100000) + tope de acompañantes (20261021110000) + autoría de la nota (20261021120000) + nombres de acompañantes (20261023110000). Solo service_role (server action submitRsvp).';
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text, jsonb, jsonb) to service_role;

-- ------------------------------------------------------------ guest_rsvp_current
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

  select g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.rsvp_notes_by_guest, g.rsvp_answers, g.responded_at, g.max_companions
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
  'Respuesta actual del invitado con enlace personal, su tope de acompañantes y los nombres que escribió (20261021100000, 20261021110000, 20261023110000). status NULL si aún no respondió. Solo service_role (página /b/[slug]).';
revoke all on function public.guest_rsvp_current(text, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_current(text, text) to service_role;

-- ------------------------------------------------------------ set_guest_companions
-- La pareja guarda la lista entera de una invitación:
--   p_list = [{ "id"?: uuid, "name": text, "kid": bool }, …] (hasta 10, en orden)
-- Con id: se actualiza esa fila (conserva su mesa). Sin id: fila nueva. Las
-- que no vienen en la lista se borran. Invoker: RLS y grants por columna.
-- Devuelve la lista guardada.
create or replace function public.set_guest_companions(p_wedding_id uuid, p_guest_id uuid, p_list jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_list jsonb := coalesce(p_list, '[]'::jsonb);
begin
  if p_wedding_id is null or not (select public.owns_wedding(p_wedding_id)) then
    raise exception 'boda ajena' using errcode = '42501';
  end if;
  if not exists (select 1 from public.wedding_guests g where g.id = p_guest_id and g.wedding_id = p_wedding_id) then
    raise exception 'invitado de otra boda' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(v_list) <> 'array' or pg_catalog.jsonb_array_length(v_list) > 10
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(v_list) e
        where pg_catalog.jsonb_typeof(e) <> 'object'
           or pg_catalog.jsonb_typeof(e->'name') is distinct from 'string'
           or pg_catalog.char_length(pg_catalog.btrim(e->>'name')) not between 1 and 80
           or (e ? 'kid' and pg_catalog.jsonb_typeof(e->'kid') <> 'boolean')
           or (e ? 'id' and coalesce(e->>'id', '') !~ '^[0-9a-fA-F-]{36}$'))
     or (select count(distinct e->>'id') from pg_catalog.jsonb_array_elements(v_list) e where e ? 'id')
        <> (select count(*) from pg_catalog.jsonb_array_elements(v_list) e where e ? 'id') then
    raise exception 'lista no válida' using errcode = '22023';
  end if;
  -- Un id que no es de esta invitación no vale (ni de otra boda ni de otro invitado).
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_list) e
     where e ? 'id' and not exists (
       select 1 from public.wedding_guest_companions c
        where c.id = (e->>'id')::uuid and c.guest_id = p_guest_id and c.wedding_id = p_wedding_id)
  ) then
    raise exception 'acompañante ajeno' using errcode = '42501';
  end if;

  delete from public.wedding_guest_companions c
   where c.guest_id = p_guest_id and c.wedding_id = p_wedding_id
     and not exists (select 1 from pg_catalog.jsonb_array_elements(v_list) e where e ? 'id' and (e->>'id')::uuid = c.id);
  update public.wedding_guest_companions c
     set name = pg_catalog.btrim(e.value->>'name'), is_kid = coalesce((e.value->>'kid')::boolean, false), position = (e.ord - 1)::smallint
    from pg_catalog.jsonb_array_elements(v_list) with ordinality as e(value, ord)
   where e.value ? 'id' and c.id = (e.value->>'id')::uuid and c.wedding_id = p_wedding_id;
  insert into public.wedding_guest_companions (wedding_id, guest_id, name, is_kid, position)
  select p_wedding_id, p_guest_id, pg_catalog.btrim(e.value->>'name'), coalesce((e.value->>'kid')::boolean, false), (e.ord - 1)::smallint
    from pg_catalog.jsonb_array_elements(v_list) with ordinality as e(value, ord)
   where not (e.value ? 'id');

  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', c.id, 'name', c.name, 'is_kid', c.is_kid, 'table_id', c.table_id, 'by_guest', c.by_guest) order by c.position, c.id)
      from public.wedding_guest_companions c
     where c.guest_id = p_guest_id and c.wedding_id = p_wedding_id), '[]'::jsonb);
end;
$$;
revoke all on function public.set_guest_companions(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_guest_companions(uuid, uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------ wedding_seating
-- Igual que 20261020100000 y además:
--  · en cada invitado, companion_list [{id,name,is_kid,table_id}] y kids
--    derivado: si tiene nombres, los marcados como niño/a; si no, rsvp_answers.kids;
--  · en cada mesa, pinned_group;
--  · apart: pares [a, b] de «no sentar con…».
-- Los agregados de cada mesa (attending…) siguen siendo orientativos: el
-- panel los recalcula (lib/crm/seating.ts), también con los que se sientan aparte.
create or replace function public.wedding_seating(p_wedding_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  with w as (
    select w.id from public.weddings w
    where w.id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  ),
  c as (
    select c.guest_id,
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'name', c.name, 'is_kid', c.is_kid, 'table_id', c.table_id)
                           order by c.position, c.created_at, c.id) as list,
      count(*) filter (where c.is_kid)::int as kids
    from public.wedding_guest_companions c join w on w.id = c.wedding_id
    group by c.guest_id
  ),
  g as (
    select g.id, g.name, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.group_name, g.table_id,
      g.tags, g.side, coalesce(c.list, '[]'::jsonb) as companion_list,
      case when c.guest_id is not null then c.kids
           when g.rsvp_answers->>'kids' ~ '^[0-9]{1,2}$' then (g.rsvp_answers->>'kids')::int else 0 end as kids,
      case g.rsvp_status when 'si' then 0 when 'pendiente' then 1 else 2 end as rank
    from public.wedding_guests g join w on w.id = g.wedding_id
    left join c on c.guest_id = g.id
  ),
  gj as (
    select g.*, pg_catalog.jsonb_build_object(
      'id', g.id, 'name', g.name, 'rsvp_status', g.rsvp_status,
      'companions', g.rsvp_companions, 'notes', g.rsvp_notes, 'group_name', g.group_name,
      'tags', pg_catalog.to_jsonb(g.tags), 'side', g.side, 'kids', g.kids,
      'companion_list', g.companion_list) as doc
    from g
  )
  select pg_catalog.jsonb_build_object(
    'tables', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', t.id, 'name', t.name, 'seats', t.seats, 'position', t.position, 'pinned_group', t.pinned_group,
          'attending', coalesce((select sum(1 + x.rsvp_companions) from g x where x.table_id = t.id and x.rsvp_status = 'si'), 0),
          'pending', (select count(*) from g x where x.table_id = t.id and x.rsvp_status = 'pendiente'),
          'declined', (select count(*) from g x where x.table_id = t.id and x.rsvp_status = 'no'),
          'guests', coalesce((select pg_catalog.jsonb_agg(x.doc order by x.rank, pg_catalog.lower(x.name), x.id)
                              from gj x where x.table_id = t.id), '[]'::jsonb))
        order by t.position, t.created_at, t.id)
      from public.wedding_tables t join w on w.id = t.wedding_id), '[]'::jsonb),
    'unseated', coalesce((
      select pg_catalog.jsonb_agg(x.doc order by x.rank, x.group_name is null, pg_catalog.lower(x.group_name),
                                  pg_catalog.lower(x.name), x.id)
      from gj x where x.table_id is null), '[]'::jsonb)
  )
  -- Solo a quien es de la boda (una boda ajena sigue viendo el plano vacío de siempre).
  || case when exists (select 1 from w) then pg_catalog.jsonb_build_object('apart', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.guest_a, a.guest_b) order by a.guest_a, a.guest_b)
      from public.wedding_guest_apart a join w on w.id = a.wedding_id), '[]'::jsonb)) else '{}'::jsonb end;
$function$;

-- ------------------------------------------------------------ apply_seating
-- Misma firma y reglas que 20261020110000. p_assignments admite además
-- { "companionId": uuid, "tableId": uuid | "new:N" | null }: un acompañante
-- sentado aparte (mesa infantil) o de vuelta con su invitado (null).
create or replace function public.apply_seating(p_wedding_id uuid, p_new_tables jsonb default '[]'::jsonb, p_assignments jsonb default '[]'::jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_new jsonb := coalesce(p_new_tables, '[]'::jsonb);
  v_assign jsonb := coalesce(p_assignments, '[]'::jsonb);
  v_existing integer;
  v_position integer;
  v_created jsonb := '[]'::jsonb;
  v_map jsonb := '{}'::jsonb;
  v_item jsonb;
  v_name text;
  v_seats integer;
  v_id uuid;
  v_seated integer;
  v_companions integer;
  v_guest_items integer;
  v_companion_items integer;
begin
  if p_wedding_id is null or not (select public.owns_wedding(p_wedding_id)) then
    raise exception 'boda ajena' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(v_new) <> 'array' or pg_catalog.jsonb_typeof(v_assign) <> 'array' then
    raise exception 'formato no válido' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(v_assign) > 2000 then
    raise exception 'demasiadas asignaciones' using errcode = '22023';
  end if;
  select count(*) into v_existing from public.wedding_tables t where t.wedding_id = p_wedding_id;
  if v_existing + pg_catalog.jsonb_array_length(v_new) > 120 then
    raise exception 'demasiadas mesas' using errcode = '22023';
  end if;

  -- Forma: guestId o companionId (uno de los dos, uuid); tableId uuid, «new:…» o null.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_assign) a
     where pg_catalog.jsonb_typeof(a) <> 'object'
        or (a ? 'guestId') = (a ? 'companionId')
        or coalesce(a->>'guestId', a->>'companionId', '') !~ '^[0-9a-fA-F-]{36}$'
        or (a->'tableId' is not null and pg_catalog.jsonb_typeof(a->'tableId') not in ('string', 'null'))
        or (a->>'tableId' is not null and a->>'tableId' !~ '^[0-9a-fA-F-]{36}$' and a->>'tableId' !~ '^new:[0-9]{1,4}$')
  ) then
    raise exception 'asignación no válida' using errcode = '22023';
  end if;
  select count(*) filter (where a ? 'guestId'), count(*) filter (where a ? 'companionId')
    into v_guest_items, v_companion_items
    from pg_catalog.jsonb_array_elements(v_assign) a;
  -- Cada invitado y cada acompañante, una vez.
  if (select count(distinct a->>'guestId') from pg_catalog.jsonb_array_elements(v_assign) a where a ? 'guestId') <> v_guest_items
     or (select count(distinct a->>'companionId') from pg_catalog.jsonb_array_elements(v_assign) a where a ? 'companionId') <> v_companion_items then
    raise exception 'invitado repetido' using errcode = '22023';
  end if;
  -- Todos los invitados y acompañantes son de esta boda.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_assign) a
     where a ? 'guestId'
       and not exists (select 1 from public.wedding_guests g where g.id = (a->>'guestId')::uuid and g.wedding_id = p_wedding_id)
  ) then
    raise exception 'invitado de otra boda' using errcode = '42501';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_assign) a
     where a ? 'companionId'
       and not exists (select 1 from public.wedding_guest_companions c where c.id = (a->>'companionId')::uuid and c.wedding_id = p_wedding_id)
  ) then
    raise exception 'acompañante de otra boda' using errcode = '42501';
  end if;
  -- Todas las mesas existentes son de esta boda.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_assign) a
     where a->>'tableId' ~ '^[0-9a-fA-F-]{36}$'
       and not exists (select 1 from public.wedding_tables t where t.id = (a->>'tableId')::uuid and t.wedding_id = p_wedding_id)
  ) then
    raise exception 'mesa de otra boda' using errcode = '42501';
  end if;

  -- Mesas nuevas, al final del orden actual.
  select coalesce(max(t.position), 0) into v_position from public.wedding_tables t where t.wedding_id = p_wedding_id;
  for v_item in select e from pg_catalog.jsonb_array_elements(v_new) e loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' or coalesce(v_item->>'key', '') !~ '^new:[0-9]{1,4}$' or v_map ? (v_item->>'key') then
      raise exception 'mesa nueva no válida' using errcode = '22023';
    end if;
    v_name := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_item->>'name', ''), '\s+', ' ', 'g'));
    v_seats := case when coalesce(v_item->>'seats', '') ~ '^[0-9]{1,2}$' then (v_item->>'seats')::int else 10 end;
    v_position := v_position + 1;
    -- El CHECK de la tabla valida nombre (1–40) y plazas (1–30).
    insert into public.wedding_tables (wedding_id, name, seats, position)
    values (p_wedding_id, v_name, v_seats, v_position)
    returning id into v_id;
    v_map := v_map || pg_catalog.jsonb_build_object(v_item->>'key', v_id::text);
    v_created := v_created || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key', v_item->>'key', 'id', v_id));
  end loop;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_assign) a
     where a->>'tableId' like 'new:%' and not (v_map ? (a->>'tableId'))
  ) then
    raise exception 'mesa nueva desconocida' using errcode = '22023';
  end if;

  with wanted as (
    select (a->>'guestId')::uuid as guest_id,
      case when a->>'tableId' is null then null
           when a->>'tableId' like 'new:%' then (v_map->>(a->>'tableId'))::uuid
           else (a->>'tableId')::uuid end as table_id
    from pg_catalog.jsonb_array_elements(v_assign) a
    where a ? 'guestId'
  ), changed as (
    update public.wedding_guests g
       set table_id = wanted.table_id
      from wanted
     where g.id = wanted.guest_id and g.wedding_id = p_wedding_id
    returning 1
  )
  select count(*) into v_seated from changed;
  if v_seated <> v_guest_items then
    raise exception 'no se han podido sentar todos' using errcode = '42501';
  end if;

  with wanted as (
    select (a->>'companionId')::uuid as companion_id,
      case when a->>'tableId' is null then null
           when a->>'tableId' like 'new:%' then (v_map->>(a->>'tableId'))::uuid
           else (a->>'tableId')::uuid end as table_id
    from pg_catalog.jsonb_array_elements(v_assign) a
    where a ? 'companionId'
  ), changed as (
    update public.wedding_guest_companions c
       set table_id = wanted.table_id
      from wanted
     where c.id = wanted.companion_id and c.wedding_id = p_wedding_id
    returning 1
  )
  select count(*) into v_companions from changed;
  if v_companions <> v_companion_items then
    raise exception 'no se han podido sentar todos' using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object('created', v_created, 'seated', v_seated, 'companions', v_companions);
end;
$$;
revoke all on function public.apply_seating(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_seating(uuid, jsonb, jsonb) to authenticated, service_role;

commit;
