-- Mesas automáticas (plan maestro 8-oct-2026, §3.4): aplicar una propuesta de
-- plano de una vez. Preparada y verificada en Postgres temporal. NO aplicada
-- en remoto. Aditiva (función nueva): el código anterior no la usa y el nuevo
-- avisa si falta («Sentar automáticamente» no aplica nada sin ella).
--
-- apply_seating(p_wedding_id, p_new_tables, p_assignments) → jsonb
--   p_new_tables:  [{ "key": "new:1", "name": "Mesa 7", "seats": 10 }, …]
--   p_assignments: [{ "guestId": uuid, "tableId": uuid | "new:1" | null }, …]
--     tableId null = quitarle la mesa (lo usa «Deshacer la propuesta»).
-- Todo o nada (una transacción; cualquier error deshace también las mesas
-- creadas). Valida que la boda es de la sesión (owns_wedding), que cada
-- invitado y cada mesa existente son de ESA boda (si no, error: la RLS sola
-- se saltaría filas en silencio) y que las claves «new:…» están en
-- p_new_tables. Topes: 2.000 asignaciones y 120 mesas por boda (MAX_TABLES).
-- Devuelve { "created": [{ "key", "id" }], "seated": n }.
-- Invoker: inserta en wedding_tables con el grant por columnas de la pareja
-- (wedding_id, name, seats, position) y actualiza wedding_guests con su RLS.
-- Un nombre repetido de mesa da 23505 (unique wedding_id, name).
begin;

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

  -- Forma de cada asignación: guestId uuid; tableId uuid, clave «new:…» o null.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_assign) a
     where pg_catalog.jsonb_typeof(a) <> 'object'
        or coalesce(a->>'guestId', '') !~ '^[0-9a-fA-F-]{36}$'
        or (a->'tableId' is not null and pg_catalog.jsonb_typeof(a->'tableId') not in ('string', 'null'))
        or (a->>'tableId' is not null and a->>'tableId' !~ '^[0-9a-fA-F-]{36}$' and a->>'tableId' !~ '^new:[0-9]{1,4}$')
  ) then
    raise exception 'asignación no válida' using errcode = '22023';
  end if;
  -- Un invitado, una vez.
  if (select count(distinct a->>'guestId') from pg_catalog.jsonb_array_elements(v_assign) a) <> pg_catalog.jsonb_array_length(v_assign) then
    raise exception 'invitado repetido' using errcode = '22023';
  end if;
  -- Todos los invitados son de esta boda.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_assign) a
     where not exists (select 1 from public.wedding_guests g where g.id = (a->>'guestId')::uuid and g.wedding_id = p_wedding_id)
  ) then
    raise exception 'invitado de otra boda' using errcode = '42501';
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
  ), changed as (
    update public.wedding_guests g
       set table_id = wanted.table_id
      from wanted
     where g.id = wanted.guest_id and g.wedding_id = p_wedding_id
    returning 1
  )
  select count(*) into v_seated from changed;
  if v_seated <> pg_catalog.jsonb_array_length(v_assign) then
    raise exception 'no se han podido sentar todos' using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object('created', v_created, 'seated', v_seated);
end;
$$;
revoke all on function public.apply_seating(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_seating(uuid, jsonb, jsonb) to authenticated, service_role;

commit;
