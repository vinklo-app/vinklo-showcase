-- Plano del salón (mesas con IA, 9-oct-2026): forma y posición aproximada de
-- cada mesa, y guardar de una vez las mesas que la pareja revisa tras subir
-- una foto del plano. Preparada y verificada en Postgres temporal. NO
-- aplicada en remoto. Aditiva: columnas nuevas nullable y una función nueva;
-- el código anterior no las usa y el nuevo funciona sin ellas (no pinta el
-- plano y avisa de que falta la migración al guardar).
--
--  * wedding_tables.shape: 'redonda' | 'rectangular' | 'cuadrada' |
--    'imperial' | 'otra'. null = sin indicar.
--  * wedding_tables.pos_x / pos_y: centro de la mesa en el plano, de 0 a 1
--    (0,0 = arriba a la izquierda). null = sin posición. Los dos o ninguno.
--  * save_floor_plan(p_wedding_id, p_tables) → jsonb: crea o actualiza
--    (nombre, plazas, forma y posición) todas las mesas en UNA transacción.
--    No borra ninguna: las que no vienen en la lista quedan como estaban.
--    Invoker (RLS + grants por columna de la pareja). La imagen del plano
--    NUNCA llega a la base de datos: solo lo que la pareja revisó.
begin;

alter table public.wedding_tables add column if not exists shape text;
alter table public.wedding_tables drop constraint if exists wedding_tables_shape_check;
alter table public.wedding_tables add constraint wedding_tables_shape_check
  check (shape is null or shape in ('redonda', 'rectangular', 'cuadrada', 'imperial', 'otra'));
alter table public.wedding_tables add column if not exists pos_x real;
alter table public.wedding_tables add column if not exists pos_y real;
alter table public.wedding_tables drop constraint if exists wedding_tables_pos_check;
alter table public.wedding_tables add constraint wedding_tables_pos_check
  check ((pos_x is null and pos_y is null)
      or (pos_x is not null and pos_y is not null and pos_x between 0 and 1 and pos_y between 0 and 1));
comment on column public.wedding_tables.shape is
  'Forma de la mesa (redonda, rectangular, cuadrada, imperial u otra). null = sin indicar.';
comment on column public.wedding_tables.pos_x is
  'Centro de la mesa en el plano del salón, de 0 (izquierda) a 1 (derecha). null = sin posición.';
comment on column public.wedding_tables.pos_y is
  'Centro de la mesa en el plano del salón, de 0 (arriba) a 1 (abajo). null = sin posición.';

-- wedding_tables usa grants por columna (20261013100000, 20261023100000).
grant insert (shape, pos_x, pos_y) on public.wedding_tables to authenticated;
grant update (shape, pos_x, pos_y) on public.wedding_tables to authenticated;

-- ------------------------------------------------------------ save_floor_plan
-- p_tables: [{ "id": uuid | null, "name": text, "seats": 1-30,
--              "shape": text | null, "x": 0-1 | null, "y": 0-1 | null }, …]
-- id = mesa existente de ESTA boda (si no, error 42501 y nada cambia);
-- sin id = mesa nueva al final. Devuelve
-- { "tables": [{ "id", "name", "seats", "shape", "x", "y", "created" }] } en
-- el mismo orden. Los nombres se pueden intercambiar entre mesas (se
-- reasignan en dos pasos); un nombre repetido da 23505.
create or replace function public.save_floor_plan(p_wedding_id uuid, p_tables jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_list jsonb := coalesce(p_tables, '[]'::jsonb);
  v_item jsonb;
  v_existing integer;
  v_new integer;
  v_position integer;
  v_id uuid;
  v_name text;
  v_seats integer;
  v_shape text;
  v_x real;
  v_y real;
  v_out jsonb := '[]'::jsonb;
begin
  if p_wedding_id is null or not (select public.owns_wedding(p_wedding_id)) then
    raise exception 'boda ajena' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(v_list) <> 'array' or pg_catalog.jsonb_array_length(v_list) = 0 then
    raise exception 'formato no válido' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_list) e
     where pg_catalog.jsonb_typeof(e) <> 'object'
        or (e->'id' is not null and pg_catalog.jsonb_typeof(e->'id') <> 'null' and coalesce(e->>'id', '') !~ '^[0-9a-fA-F-]{36}$')
        or coalesce(e->>'seats', '') !~ '^[0-9]{1,2}$'
        or (e->'x' is not null and pg_catalog.jsonb_typeof(e->'x') not in ('number', 'null'))
        or (e->'y' is not null and pg_catalog.jsonb_typeof(e->'y') not in ('number', 'null'))
  ) then
    raise exception 'mesa no válida' using errcode = '22023';
  end if;
  -- Una mesa existente, una vez.
  if (select count(distinct e->>'id') from pg_catalog.jsonb_array_elements(v_list) e where e->>'id' is not null)
     <> (select count(*) from pg_catalog.jsonb_array_elements(v_list) e where e->>'id' is not null) then
    raise exception 'mesa repetida' using errcode = '22023';
  end if;
  -- Las existentes son de esta boda.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_list) e
     where e->>'id' is not null
       and not exists (select 1 from public.wedding_tables t where t.id = (e->>'id')::uuid and t.wedding_id = p_wedding_id)
  ) then
    raise exception 'mesa de otra boda' using errcode = '42501';
  end if;
  select count(*) into v_existing from public.wedding_tables t where t.wedding_id = p_wedding_id;
  select count(*) into v_new from pg_catalog.jsonb_array_elements(v_list) e where e->>'id' is null;
  if v_existing + v_new > 120 then
    raise exception 'demasiadas mesas' using errcode = '22023';
  end if;

  -- Paso 1: nombre provisional a las existentes (permite intercambiar nombres).
  update public.wedding_tables t
     set name = '~' || t.id::text
    from pg_catalog.jsonb_array_elements(v_list) e
   where e->>'id' is not null and t.id = (e->>'id')::uuid and t.wedding_id = p_wedding_id;

  -- Paso 2: valores finales, en orden.
  select coalesce(max(t.position), 0) into v_position from public.wedding_tables t where t.wedding_id = p_wedding_id;
  for v_item in select e from pg_catalog.jsonb_array_elements(v_list) e loop
    v_name := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_item->>'name', ''), '\s+', ' ', 'g'));
    v_seats := (v_item->>'seats')::int;
    v_shape := nullif(v_item->>'shape', '');
    v_x := (v_item->>'x')::real;
    v_y := (v_item->>'y')::real;
    if (v_x is null) <> (v_y is null) then
      raise exception 'posición incompleta' using errcode = '22023';
    end if;
    -- Los CHECK de la tabla validan nombre (1-40), plazas (1-30), forma y posición.
    if v_item->>'id' is null then
      v_position := v_position + 1;
      insert into public.wedding_tables (wedding_id, name, seats, position, shape, pos_x, pos_y)
      values (p_wedding_id, v_name, v_seats, v_position, v_shape, v_x, v_y)
      returning id into v_id;
      v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', v_id, 'name', v_name, 'seats', v_seats, 'shape', v_shape, 'x', v_x, 'y', v_y, 'created', true));
    else
      v_id := (v_item->>'id')::uuid;
      update public.wedding_tables t
         set name = v_name, seats = v_seats, shape = v_shape, pos_x = v_x, pos_y = v_y
       where t.id = v_id and t.wedding_id = p_wedding_id;
      if not found then
        raise exception 'mesa no encontrada' using errcode = '42501';
      end if;
      v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', v_id, 'name', v_name, 'seats', v_seats, 'shape', v_shape, 'x', v_x, 'y', v_y, 'created', false));
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('tables', v_out);
end;
$$;
revoke all on function public.save_floor_plan(uuid, jsonb) from public, anon;
grant execute on function public.save_floor_plan(uuid, jsonb) to authenticated, service_role;

commit;
