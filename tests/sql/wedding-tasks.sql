-- Tareas (20261014200000): wedding_tasks.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/wedding-tasks.sql
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('a1111111-1111-4111-8111-111111111111'), ('a2222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','tareas-pareja-a','a1111111-1111-4111-8111-111111111111','Elena','Marcos',current_date + 300),
 ('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','tareas-pareja-b','a2222222-2222-4222-8222-222222222222','Lucia','Juan',current_date + 300);
insert into public.wedding_tasks(id,wedding_id,title,due_on,template_key) values
 ('ab000000-0000-4000-8000-000000000001','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Reservar finca',current_date + 10,'reservar-finca');

-- ------------------------------------------------------------ esquema y privilegios
do $$ begin
 if not (select relrowsecurity from pg_class where oid = 'public.wedding_tasks'::regclass) then raise exception 'wedding_tasks sin RLS'; end if;
 if has_table_privilege('anon','public.wedding_tasks','select') or has_table_privilege('anon','public.wedding_tasks','insert')
    or has_table_privilege('anon','public.wedding_tasks','update') or has_table_privilege('anon','public.wedding_tasks','delete') then raise exception 'anon con privilegios en wedding_tasks'; end if;
 if not has_table_privilege('authenticated','public.wedding_tasks','select') or not has_table_privilege('authenticated','public.wedding_tasks','delete') then raise exception 'authenticated sin select/delete'; end if;
 if has_table_privilege('authenticated','public.wedding_tasks','truncate') or has_table_privilege('authenticated','public.wedding_tasks','references') then raise exception 'authenticated con privilegios de más'; end if;
 if not has_column_privilege('authenticated','public.wedding_tasks','title','insert') or not has_column_privilege('authenticated','public.wedding_tasks','done','update')
    or not has_column_privilege('authenticated','public.wedding_tasks','due_on','update') or not has_column_privilege('authenticated','public.wedding_tasks','template_key','insert') then raise exception 'Faltan grants por columna'; end if;
 if has_column_privilege('authenticated','public.wedding_tasks','wedding_id','update') then raise exception 'authenticated mueve una tarea de boda'; end if;
 if has_column_privilege('authenticated','public.wedding_tasks','template_key','update') then raise exception 'authenticated reescribe template_key'; end if;
 if has_column_privilege('authenticated','public.wedding_tasks','done_at','insert') or has_column_privilege('authenticated','public.wedding_tasks','done_at','update') then raise exception 'authenticated escribe done_at'; end if;
 if has_column_privilege('authenticated','public.wedding_tasks','id','insert') or has_column_privilege('authenticated','public.wedding_tasks','created_at','update') then raise exception 'authenticated escribe id/created_at'; end if;
 if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wedding_tasks'
            and coalesce(qual,'') || coalesce(with_check,'') !~ 'owns_wedding') then raise exception 'Política sin owns_wedding'; end if;
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('weddings_public','wedding_sites_public')
            and column_name ~ 'task') then raise exception 'Vista pública con tareas'; end if;
end $$;

-- ------------------------------------------------------------ CHECKs
do $$ begin
 begin insert into public.wedding_tasks(wedding_id,title) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',''); raise exception 'Título vacío aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_tasks(wedding_id,title) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',' Flores'); raise exception 'Título sin recortar aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_tasks(wedding_id,title) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('a',121)); raise exception 'Título de 121 aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_tasks(wedding_id,title,notes) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Notas',repeat('a',1001)); raise exception 'Notas de 1001 aceptadas';
 exception when check_violation then null; end;
 begin insert into public.wedding_tasks(wedding_id,title,category) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Cat','joyas'); raise exception 'Categoría fuera de lista';
 exception when check_violation then null; end;
 begin insert into public.wedding_tasks(wedding_id,title,template_key) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Clave','Clave Rara'); raise exception 'template_key inválida';
 exception when check_violation then null; end;
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $$ declare n integer; t1 uuid; t2 uuid; r record; begin
 if (select count(*) from public.wedding_tasks) <> 0 then raise exception 'A ve tareas de B'; end if;

 -- Tarea propia (sin fecha ni categoría) y sugerencia con clave; nacen sin hacer y sin done_at.
 insert into public.wedding_tasks(wedding_id,title) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Comprar alianzas') returning id into t1;
 insert into public.wedding_tasks(wedding_id,title,due_on,category,template_key,position)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Reservar finca',current_date + 5,'finca','reservar-finca',1) returning id into t2;
 select * into r from public.wedding_tasks where id = t2;
 if r.done or r.done_at is not null then raise exception 'La sugerencia nace hecha'; end if;
 -- Misma clave en la misma boda: no se duplica (la acción inserta solo las que faltan).
 begin insert into public.wedding_tasks(wedding_id,title,template_key) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Otra vez','reservar-finca'); raise exception 'Sugerencia duplicada';
 exception when unique_violation then null; end;
 -- Varias tareas propias (template_key null) conviven.
 insert into public.wedding_tasks(wedding_id,title) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Comprar alianzas');

 -- Marcar hecha: done_at lo pone el trigger; editar otra cosa no lo cambia; deshacer lo borra.
 update public.wedding_tasks set done = true where id = t2;
 get diagnostics n = row_count; if n <> 1 then raise exception 'A no marca su tarea'; end if;
 if (select done_at from public.wedding_tasks where id = t2) is null then raise exception 'done_at sin fijar'; end if;
 update public.wedding_tasks set notes = 'Pedir presupuesto' where id = t2;
 if (select done_at from public.wedding_tasks where id = t2) is null then raise exception 'Editar borró done_at'; end if;
 update public.wedding_tasks set done = false where id = t2;
 if (select done_at from public.wedding_tasks where id = t2) is not null then raise exception 'Deshacer no borra done_at'; end if;
 -- Editar título, fecha y categoría.
 update public.wedding_tasks set title = 'Reservar la finca', due_on = null, category = null where id = t2;
 get diagnostics n = row_count; if n <> 1 then raise exception 'A no edita su tarea'; end if;

 -- Aislamiento.
 begin insert into public.wedding_tasks(wedding_id,title) values ('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Intrusa'); raise exception 'A crea tarea en B';
 exception when insufficient_privilege then null; end;
 begin update public.wedding_tasks set wedding_id = 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' where id = t1; raise exception 'A mueve una tarea a B';
 exception when insufficient_privilege then null; end;
 begin update public.wedding_tasks set done_at = now() where id = t1; raise exception 'A escribe done_at';
 exception when insufficient_privilege then null; end;
 update public.wedding_tasks set done = true where id = 'ab000000-0000-4000-8000-000000000001';
 if found then raise exception 'A marca una tarea de B'; end if;
 delete from public.wedding_tasks where id = 'ab000000-0000-4000-8000-000000000001';
 if found then raise exception 'A borra una tarea de B'; end if;
 -- La clave de B no choca con la de A (únicas por boda).
 if (select count(*) from public.wedding_tasks where template_key = 'reservar-finca') <> 1 then raise exception 'A ve la sugerencia de B'; end if;

 delete from public.wedding_tasks where id = t1;
 if not found then raise exception 'A no borra su tarea'; end if;
end $$;
reset role;

-- ================================================================ pareja B
set local role authenticated;
select set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
do $$ begin
 if (select count(*) from public.wedding_tasks) <> 1 then raise exception 'B ve tareas de A'; end if;
 if (select done from public.wedding_tasks) then raise exception 'B: tarea tocada por A'; end if;
end $$;
reset role;

-- Sin sesión (anon): nada.
set local role anon;
do $$ begin
 begin perform 1 from public.wedding_tasks; raise exception 'anon lee wedding_tasks';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Borrar la boda arrastra sus tareas.
delete from public.weddings where id = 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
do $$ begin
 if exists (select 1 from public.wedding_tasks where wedding_id = 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2') then raise exception 'Quedan tareas de una boda borrada'; end if;
end $$;

do $$ begin raise notice 'wedding-tasks: CHECK, grants, done_at por trigger, sugerencias sin duplicar y aislamiento A/B OK'; end $$;
rollback;
