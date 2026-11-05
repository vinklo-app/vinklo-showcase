-- Campos propios e importación de Excel (20261031100000): CHECK de
-- extra_fields, permisos por columna, RPC import_wedding_guests (pertenencia,
-- contrato, transacción única e idempotencia) y retención. Dos parejas
-- ficticias en una base DE PRUEBAS vacía con todas las migraciones; ROLLBACK.
begin;
insert into auth.users(id) values ('e1111111-1111-4111-8111-111111111111'), ('e2222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','extra-pareja-a','e1111111-1111-4111-8111-111111111111','Lucia','Juan',current_date + 90),
 ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','extra-pareja-b','e2222222-2222-4222-8222-222222222222','Eva','Pau','2025-01-10');
insert into public.wedding_guests(id,wedding_id,name,extra_fields) values
 ('eb000000-0000-4000-8000-000000000001','ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Berta','{"Email":"berta@ejemplo.es","Dirección":"Calle Mayor 1"}');

-- ------------------------------------------------------------ catálogo y CHECK
do $$
declare stmt text;
begin
  if not has_column_privilege('authenticated','public.wedding_guests','extra_fields','insert')
     or not has_column_privilege('authenticated','public.wedding_guests','extra_fields','update') then raise exception 'falta INSERT/UPDATE (extra_fields)'; end if;
  if has_table_privilege('authenticated','public.wedding_guests','update') or has_table_privilege('authenticated','public.wedding_guests','insert') then
    raise exception 'authenticated recuperó escritura de tabla en wedding_guests'; end if;
  if has_function_privilege('anon','public.import_wedding_guests(uuid,uuid,jsonb)','execute') then raise exception 'anon puede importar'; end if;
  if has_function_privilege('anon','public.guest_extra_fields_valid(jsonb)','execute') then raise exception 'anon ejecuta guest_extra_fields_valid'; end if;
  if (select prosecdef from pg_proc where oid = 'public.import_wedding_guests(uuid,uuid,jsonb)'::regprocedure) then raise exception 'import_wedding_guests debe ser invoker'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.wedding_guest_imports'::regclass) then raise exception 'wedding_guest_imports sin RLS'; end if;
  if has_table_privilege('anon','public.wedding_guest_imports','select') or has_table_privilege('authenticated','public.wedding_guest_imports','update')
     or has_table_privilege('authenticated','public.wedding_guest_imports','delete') then raise exception 'wedding_guest_imports demasiado abierta'; end if;
  -- Valores por defecto y formas válidas / no válidas.
  if not public.guest_extra_fields_valid('{}') or not public.guest_extra_fields_valid('{"Mesa":"7"}') then raise exception 'rechaza un objeto válido'; end if;
  foreach stmt in array array[
    '[]', '"texto"', '{"Mesa":7}', '{"Mesa":""}', '{" Mesa":"7"}', '{"":"x"}',
    '{"Mesa":{"a":"b"}}', format('{"%s":"x"}', repeat('k', 41)), format('{"Nota":"%s"}', repeat('x', 301))
  ] loop
    if public.guest_extra_fields_valid(stmt::jsonb) then raise exception 'acepta %', stmt; end if;
  end loop;
  if public.guest_extra_fields_valid((select jsonb_object_agg('k' || g, 'v') from generate_series(1, 26) g)) then raise exception 'acepta 26 claves'; end if;
  if public.guest_extra_fields_valid((select jsonb_object_agg('clave' || g, repeat('v', 290)) from generate_series(1, 22) g)) then raise exception 'acepta más de 6 KB'; end if;
  -- Al límite del navegador/zod (JSON compacto ≤ 5800): 25 claves «Campo propio NN» con 105 «ñ» (2 bytes)
  -- = 5776 bytes compactos; Postgres los mide con espacios (+49) = 5825 ≤ 6144: debe valer.
  if not public.guest_extra_fields_valid((select jsonb_object_agg('Campo propio ' || lpad(g::text, 2, '0'), repeat('ñ', 105)) from generate_series(1, 25) g)) then
    raise exception 'rechaza un objeto dentro del presupuesto del cliente'; end if;
  if octet_length((select jsonb_object_agg('Campo propio ' || lpad(g::text, 2, '0'), repeat('ñ', 105)) from generate_series(1, 25) g)::text) <> 5825 then
    raise exception 'el texto jsonb de Postgres ya no lleva un espacio tras «:» y «,»: revisad EXTRA_BUDGET_BYTES'; end if;
  -- Por qué el presupuesto es 5800 y no 6144: 112 «ñ» = 6126 bytes compactos (pasaría con el tope
  -- antiguo del cliente) pero 6175 en Postgres, y el CHECK lo rechaza.
  if public.guest_extra_fields_valid((select jsonb_object_agg('Campo propio ' || lpad(g::text, 2, '0'), repeat('ñ', 112)) from generate_series(1, 25) g)) then
    raise exception 'acepta 6175 bytes en Postgres'; end if;
  begin
    insert into public.wedding_guests(wedding_id,name,extra_fields) values ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Mal','{"Mesa":7}');
    raise exception 'El CHECK dejó pasar un valor no texto';
  exception when check_violation then null;
  end;
end $$;

-- ------------------------------------------------------------ como la pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','e1111111-1111-4111-8111-111111111111',true);
do $$
declare
  r jsonb;
  n integer;
  v_rows jsonb := '[
    {"name":"Ana","phone":"612 345 678","status":"si","companions":1,"max_companions":1,"group":"Uni","tags":["Uni"],"side":"p1",
     "extra":{"Email":"ana@ejemplo.es","Mesa":"3"},"companion_names":["Pablo García"]},
    {"name":"Tío Ramón","status":"pendiente","companions":2,"max_companions":2,"notes":"Celíaco","extra":{}},
    {"name":"Marta","status":"no","companions":0}
  ]';
begin
  -- Escritura directa de la columna con su sesión (ficha) y RLS.
  insert into public.wedding_guests(wedding_id,source,name,extra_fields) values ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','couple','Carla','{"Menú":"Vegano"}');
  update public.wedding_guests set extra_fields = '{"Menú":"Carne"}' where wedding_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Carla';
  update public.wedding_guests set extra_fields = '{}' where id = 'eb000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A tocó los campos de B'; end if;

  r := public.import_wedding_guests('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-0000000000a1', v_rows);
  if r->>'status' <> 'ok' or (r->>'guests')::int <> 3 or (r->>'people')::int <> 6 then raise exception 'Resumen inesperado: %', r; end if;
  if (select count(*) from public.wedding_guests where wedding_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 4 then raise exception 'No se crearon los 3 invitados'; end if;
  if (select rsvp_companions from public.wedding_guests where wedding_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Ana') <> 1 then raise exception 'Ana sin acompañante confirmado'; end if;
  if (select rsvp_companions from public.wedding_guests where wedding_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Tío Ramón') <> 0 then raise exception 'Pendiente con acompañantes confirmados'; end if;
  if (select max_companions from public.wedding_guests where wedding_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Tío Ramón') <> 2 then raise exception 'Sin tope de acompañantes'; end if;
  if (select extra_fields->>'Email' from public.wedding_guests where wedding_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Ana') <> 'ana@ejemplo.es' then raise exception 'Campo propio perdido'; end if;
  if (select source from public.wedding_guests where wedding_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Ana') <> 'couple' then raise exception 'source distinto de couple'; end if;
  if (select string_agg(c.name, ',') from public.wedding_guest_companions c join public.wedding_guests g on g.id = c.guest_id where g.name = 'Ana') <> 'Pablo García' then
    raise exception 'Acompañante con nombre no creado'; end if;

  -- Idempotencia: el mismo id no vuelve a escribir.
  r := public.import_wedding_guests('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-0000000000a1', v_rows);
  if r->>'status' <> 'duplicate' or (r->>'guests')::int <> 3 then raise exception 'Reintento no idempotente: %', r; end if;
  if (select count(*) from public.wedding_guests where wedding_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 4 then raise exception 'El reintento duplicó invitados'; end if;

  -- Una fila mala aborta todo (ni invitados ni marca).
  begin
    perform public.import_wedding_guests('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-0000000000a2',
      '[{"name":"Buena","status":"pendiente","companions":0},{"name":"X","status":"pendiente","companions":0}]');
    raise exception 'Aceptó un nombre de 1 letra';
  exception when invalid_parameter_value then null;
  end;
  foreach r in array array[
    '[{"name":"Ok","status":"quizá","companions":0}]', '[{"name":"Ok","status":"si","companions":11}]',
    '[{"name":"Ok","status":"si","companions":0,"phone":"12"}]', '[{"name":"Ok","status":"si","companions":0,"extra":{"a":1}}]',
    '[{"name":"Ok","status":"si","companions":0,"tags":["a","A"]}]', '[{"name":"Ok","status":"si","companions":0,"side":"novio"}]',
    '[{"name":"Ok","status":"si","companions":0,"companion_names":["",""]}]', '[]', '{}'
  ]::jsonb[] loop
    begin
      perform public.import_wedding_guests('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid(), r);
      raise exception 'Aceptó %', r;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  if exists (select 1 from public.wedding_guests where name = 'Buena') then raise exception 'Importación a medias'; end if;
  if exists (select 1 from public.wedding_guest_imports where id = 'e0000000-0000-4000-8000-0000000000a2') then raise exception 'Marca de una importación fallida'; end if;

  -- Otra boda: ni importar ni reutilizar su id.
  begin
    perform public.import_wedding_guests('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', gen_random_uuid(), '[{"name":"Intrusa","status":"pendiente","companions":0}]');
    raise exception 'A importó en B';
  exception when insufficient_privilege then null;
  end;
  -- No ve las importaciones de nadie más.
  if (select count(*) from public.wedding_guest_imports) <> 1 then raise exception 'Ve importaciones ajenas'; end if;
end $$;
reset role;

-- Un id ya usado por B no le sirve a A para leer su resumen.
insert into public.wedding_guest_imports(id,wedding_id,guests,people) values ('e0000000-0000-4000-8000-0000000000b1','ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',5,9);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1111111-1111-4111-8111-111111111111',true);
do $$ begin
  perform public.import_wedding_guests('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-0000000000b1', '[{"name":"Ok","status":"pendiente","companions":0}]');
  raise exception 'Reutilizó el id de otra boda';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ------------------------------------------------------------ retención
insert into public.wedding_retention(wedding_id, notice_sent_at) values ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2025-06-01');
do $$ begin
  perform public.anonymise_expired_guests(current_date, 200);
  if (select extra_fields from public.wedding_guests where id = 'eb000000-0000-4000-8000-000000000001') <> '{}'::jsonb then
    raise exception 'La retención no vació los campos propios'; end if;
  if (select count(*) from public.wedding_guests where wedding_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and extra_fields <> '{}'::jsonb) = 0 then
    raise exception 'La retención tocó una boda reciente'; end if;
end $$;
rollback;
