-- Importar cualquier Excel al CRM (backlog del dueño 13-oct-2026, punto 13).
--
--  * wedding_guests.extra_fields (nueva): campos propios del invitado, uno por
--    cada columna del Excel que no encaja en un campo del CRM («Email»,
--    «Mesa», «Menú», «Dirección»…). Así nada del archivo se pierde. Objeto
--    JSON plano { "Título": "valor" } con topes (CHECK guest_extra_fields_valid):
--    hasta 25 claves de 1–40 caracteres, valores de texto de 1–300 y 6 KB en
--    total. Privado de la pareja: no lo devuelve ninguna RPC del invitado.
--    La pareja puede escribirlo (grant por columna, patrón de 20261025100000).
--  * wedding_guest_imports (nueva): una fila por importación confirmada (id
--    generado en el navegador). Es la marca de idempotencia: repetir la misma
--    importación (doble clic, reintento tras un corte) no duplica invitados.
--  * import_wedding_guests (nueva, security invoker): toda la importación en
--    UNA transacción (invitados + acompañantes con nombre + marca). Invoker:
--    RLS (owns_wedding) y permisos por columna siguen mandando.
--  * anonymise_expired_guests: mismo cuerpo que 20261030100000 + vaciar
--    extra_fields (puede llevar correos, direcciones…).
-- Aditiva para el código desplegado: nada de lo anterior lee estas columnas.
begin;

-- ------------------------------------------------------------ extra_fields
create or replace function public.guest_extra_fields_valid(p_fields jsonb)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select p_fields is not null
     and pg_catalog.jsonb_typeof(p_fields) = 'object'
     and pg_catalog.octet_length(p_fields::text) <= 6144
     and (select count(*) from pg_catalog.jsonb_object_keys(p_fields)) <= 25
     and not exists (
       select 1 from pg_catalog.jsonb_each(p_fields) e
        where e.key <> pg_catalog.btrim(e.key)
           or pg_catalog.char_length(e.key) not between 1 and 40
           or pg_catalog.jsonb_typeof(e.value) <> 'string'
           or pg_catalog.char_length(e.value #>> '{}') not between 1 and 300);
$$;
comment on function public.guest_extra_fields_valid(jsonb) is
  'CHECK de wedding_guests.extra_fields: objeto plano de hasta 25 claves (1–40 caracteres, recortadas) con valores de texto de 1–300 caracteres y 6 KB en total.';
revoke all on function public.guest_extra_fields_valid(jsonb) from public, anon;
grant execute on function public.guest_extra_fields_valid(jsonb) to authenticated, service_role;

alter table public.wedding_guests add column if not exists extra_fields jsonb not null default '{}'::jsonb;
alter table public.wedding_guests drop constraint if exists wedding_guests_extra_fields_valid;
alter table public.wedding_guests add constraint wedding_guests_extra_fields_valid check (public.guest_extra_fields_valid(extra_fields));
comment on column public.wedding_guests.extra_fields is
  'Campos propios del invitado (columnas importadas de un Excel que no son campos del CRM): { "Título": "valor" }. Privado de la pareja.';

-- La pareja los escribe con su sesión (importación y, más adelante, la ficha).
grant insert (extra_fields) on public.wedding_guests to authenticated;
grant update (extra_fields) on public.wedding_guests to authenticated;

-- ------------------------------------------------------------ marca de importación
create table if not exists public.wedding_guest_imports (
  id uuid primary key,
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  guests integer not null check (guests between 1 and 2000),
  people integer not null check (people between 1 and 22000),
  created_at timestamptz not null default now()
);
comment on table public.wedding_guest_imports is
  'Importaciones de invitados confirmadas (id del navegador = idempotencia de import_wedding_guests). Solo recuentos: ningún dato personal.';
create index if not exists wedding_guest_imports_wedding_idx on public.wedding_guest_imports (wedding_id, created_at desc);

alter table public.wedding_guest_imports enable row level security;
drop policy if exists "wedding_guest_imports_select_couple" on public.wedding_guest_imports;
drop policy if exists "wedding_guest_imports_insert_couple" on public.wedding_guest_imports;
create policy "wedding_guest_imports_select_couple" on public.wedding_guest_imports for select
  to authenticated using ((select public.owns_wedding(wedding_id)));
create policy "wedding_guest_imports_insert_couple" on public.wedding_guest_imports for insert
  to authenticated with check ((select public.owns_wedding(wedding_id)));
revoke all on public.wedding_guest_imports from public, anon, authenticated;
grant select on public.wedding_guest_imports to authenticated;
grant insert (id, wedding_id, guests, people) on public.wedding_guest_imports to authenticated;
grant all on public.wedding_guest_imports to service_role;

-- ------------------------------------------------------------ import_wedding_guests
-- p_rows = [{ name, phone?, status, companions, max_companions?, notes?,
--             group?, tags?, side?, extra?, companion_names? }, …] (1–2000)
-- Devuelve { status: 'ok' | 'duplicate', guests, people }. Lo que no cumple
-- el contrato aborta TODO (22023, «fila N»): nunca queda una importación a medias.
create or replace function public.import_wedding_guests(p_wedding_id uuid, p_import_id uuid, p_rows jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_row jsonb;
  v_ord bigint;
  v_guest uuid;
  v_status text;
  v_companions integer;
  v_people integer := 0;
  v_count integer;
  v_prev record;
begin
  if p_wedding_id is null or not (select public.owns_wedding(p_wedding_id)) then
    raise exception 'boda ajena' using errcode = '42501';
  end if;
  if p_import_id is null or p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'importación no válida' using errcode = '22023';
  end if;
  v_count := pg_catalog.jsonb_array_length(p_rows);
  if v_count not between 1 and 2000 then
    raise exception 'importación no válida' using errcode = '22023';
  end if;

  -- Contrato de cada fila antes de escribir nada.
  for v_row, v_ord in select e.value, e.ord from pg_catalog.jsonb_array_elements(p_rows) with ordinality e(value, ord) loop
    if pg_catalog.jsonb_typeof(v_row) <> 'object'
       or pg_catalog.jsonb_typeof(v_row->'name') is distinct from 'string'
       or pg_catalog.char_length(pg_catalog.btrim(v_row->>'name')) not between 2 and 120
       or (v_row ? 'phone' and v_row->'phone' <> 'null'::jsonb and (pg_catalog.jsonb_typeof(v_row->'phone') <> 'string'
           or pg_catalog.char_length(v_row->>'phone') not between 6 and 20))
       or coalesce(v_row->>'status', '') not in ('pendiente', 'si', 'no')
       or pg_catalog.jsonb_typeof(v_row->'companions') is distinct from 'number'
       or (v_row->>'companions') !~ '^([0-9]|10)$'
       or (v_row ? 'max_companions' and v_row->'max_companions' <> 'null'::jsonb and coalesce(v_row->>'max_companions', '') !~ '^([0-9]|10)$')
       or (v_row ? 'notes' and v_row->'notes' <> 'null'::jsonb and (pg_catalog.jsonb_typeof(v_row->'notes') <> 'string'
           or pg_catalog.char_length(v_row->>'notes') > 500))
       or (v_row ? 'group' and v_row->'group' <> 'null'::jsonb and (pg_catalog.jsonb_typeof(v_row->'group') <> 'string'
           or v_row->>'group' <> pg_catalog.btrim(v_row->>'group') or pg_catalog.char_length(v_row->>'group') not between 1 and 40))
       or (v_row ? 'tags' and (pg_catalog.jsonb_typeof(v_row->'tags') <> 'array'
           or exists (select 1 from pg_catalog.jsonb_array_elements(v_row->'tags') t where pg_catalog.jsonb_typeof(t) <> 'string')
           or not public.guest_tags_valid(array(select pg_catalog.jsonb_array_elements_text(v_row->'tags')))))
       or (v_row ? 'side' and v_row->'side' <> 'null'::jsonb and coalesce(v_row->>'side', '') not in ('p1', 'p2', 'ambos'))
       or (v_row ? 'extra' and not public.guest_extra_fields_valid(v_row->'extra'))
       or (v_row ? 'companion_names' and (pg_catalog.jsonb_typeof(v_row->'companion_names') <> 'array'
           or pg_catalog.jsonb_array_length(v_row->'companion_names') > 10
           or exists (select 1 from pg_catalog.jsonb_array_elements(v_row->'companion_names') c
                       where pg_catalog.jsonb_typeof(c) <> 'string'
                          or pg_catalog.char_length(pg_catalog.btrim(c #>> '{}')) not between 1 and 80))) then
      raise exception 'fila %', v_ord using errcode = '22023';
    end if;
    v_people := v_people + 1 + greatest((v_row->>'companions')::integer,
      coalesce(pg_catalog.jsonb_array_length(v_row->'companion_names'), 0));
  end loop;

  -- Marca primero: un reintento con el mismo id (o uno simultáneo, que espera
  -- al primero por la clave primaria) devuelve el resumen y no escribe nada.
  begin
    insert into public.wedding_guest_imports (id, wedding_id, guests, people)
    values (p_import_id, p_wedding_id, v_count, least(v_people, 22000));
  exception when unique_violation then
    select i.guests, i.people into v_prev from public.wedding_guest_imports i
     where i.id = p_import_id and i.wedding_id = p_wedding_id;
    if not found then raise exception 'importación ajena' using errcode = '42501'; end if;
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'guests', v_prev.guests, 'people', v_prev.people);
  end;

  for v_row in select e.value from pg_catalog.jsonb_array_elements(p_rows) with ordinality e(value, ord) order by e.ord loop
    v_status := v_row->>'status';
    v_companions := (v_row->>'companions')::integer;
    insert into public.wedding_guests (
      wedding_id, source, name, phone, rsvp_status, rsvp_companions, rsvp_notes, updated_at,
      group_name, tags, side, max_companions, extra_fields)
    values (
      p_wedding_id, 'couple', pg_catalog.btrim(v_row->>'name'), nullif(pg_catalog.btrim(coalesce(v_row->>'phone', '')), ''),
      v_status, case when v_status = 'si' then v_companions else 0 end,
      nullif(pg_catalog.btrim(coalesce(v_row->>'notes', '')), ''), pg_catalog.now(),
      v_row->>'group',
      coalesce(array(select pg_catalog.jsonb_array_elements_text(v_row->'tags')), '{}'::text[]),
      v_row->>'side',
      (v_row->>'max_companions')::smallint,
      coalesce(v_row->'extra', '{}'::jsonb))
    returning id into v_guest;

    insert into public.wedding_guest_companions (wedding_id, guest_id, name, position)
    select p_wedding_id, v_guest, pg_catalog.btrim(c.value #>> '{}'), (c.ord - 1)::smallint
      from pg_catalog.jsonb_array_elements(coalesce(v_row->'companion_names', '[]'::jsonb)) with ordinality c(value, ord);
  end loop;

  return pg_catalog.jsonb_build_object('status', 'ok', 'guests', v_count, 'people', least(v_people, 22000));
end;
$$;
comment on function public.import_wedding_guests(uuid, uuid, jsonb) is
  'Importación de invitados (Excel) en una transacción: invitados + acompañantes con nombre + marca de idempotencia (wedding_guest_imports). Invoker: RLS y grants por columna (20261031100000).';
revoke all on function public.import_wedding_guests(uuid, uuid, jsonb) from public, anon;
grant execute on function public.import_wedding_guests(uuid, uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------ retención
-- Mismo cuerpo que 20261030100000 + extra_fields = '{}' (campos importados).
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
         invitation_token_hash = null,
         -- Campos importados del Excel (20261031100000): correos, direcciones…
         extra_fields = '{}'::jsonb
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
