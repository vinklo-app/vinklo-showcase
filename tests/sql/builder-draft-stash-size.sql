-- Tope de tamaño de builder_draft_stash (20261031120000).
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/builder-draft-stash-size.sql
-- Todo se revierte con ROLLBACK.
begin;

do $$
declare
  medium jsonb := jsonb_build_object('version', 4, 'sections', jsonb_build_object('faq', (select string_agg(md5(i::text), '') from generate_series(1, 900) i)));
  huge jsonb := jsonb_build_object('version', 4, 'sections', jsonb_build_object('faq', (select string_agg(md5(i::text), '') from generate_series(1, 2500) i)));
begin
  -- Un único CHECK de tamaño (el antiguo se sustituye, no se suma).
  if (select count(*) from pg_constraint where conrelid = 'public.builder_draft_stash'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'pg_column_size') <> 1 then
    raise exception 'Debe haber un solo CHECK de tamaño';
  end if;
  -- ~30 KB (antes no cabía en 16 KB) entra por la función del servidor.
  if not public.builder_draft_stash_put('pareja@ejemplo.es', medium, now(), now() + interval '7 days') then raise exception 'No escribió el borrador de 30 KB'; end if;
  if pg_column_size(medium) <= 16384 then raise exception 'La prueba no supera el tope antiguo'; end if;
  if pg_column_size(huge) <= 65536 then raise exception 'La prueba no supera el tope nuevo'; end if;
  -- Más de 64 KB sigue rechazándose.
  begin
    perform public.builder_draft_stash_put('otra@ejemplo.es', huge, now(), now() + interval '7 days');
    raise exception 'Aceptó un borrador de más de 64 KB';
  exception when check_violation then null;
  end;
  -- No objeto: rechazado como antes.
  begin
    insert into public.builder_draft_stash(email, draft) values ('lista@ejemplo.es', '[]');
    raise exception 'Aceptó un borrador que no es objeto';
  exception when check_violation then null;
  end;
  -- Sigue sin grants para anon/authenticated.
  if has_table_privilege('anon', 'public.builder_draft_stash', 'select') or has_table_privilege('authenticated', 'public.builder_draft_stash', 'insert') then
    raise exception 'builder_draft_stash con privilegios para clientes';
  end if;
end $$;

rollback;
