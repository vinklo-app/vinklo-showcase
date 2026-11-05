-- Historial del borrador (20261027100000): wedding_site_drafts_history.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/site-drafts-history.sql
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('c1111111-1111-4111-8111-111111111111'), ('c2222222-2222-4222-8222-222222222222'), ('c3333333-3333-4333-8333-333333333333');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','historial-pareja-a','c1111111-1111-4111-8111-111111111111','Elena','Marcos',current_date + 300),
 ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','historial-pareja-b','c2222222-2222-4222-8222-222222222222','Lucia','Juan',current_date + 300);
insert into public.wedding_site_drafts_history(id,wedding_id,kind,prompt,summary,document,draft_version) values
 ('cb000000-0000-4000-8000-000000000001','cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','ai','Colores en azul','Cambiamos los colores.','{"schemaVersion":1}',2);

-- ------------------------------------------------------------ esquema y privilegios
do $$ begin
 if not (select relrowsecurity from pg_class where oid = 'public.wedding_site_drafts_history'::regclass) then raise exception 'historial sin RLS'; end if;
 if has_table_privilege('anon','public.wedding_site_drafts_history','select') or has_table_privilege('anon','public.wedding_site_drafts_history','insert')
    or has_table_privilege('anon','public.wedding_site_drafts_history','update') or has_table_privilege('anon','public.wedding_site_drafts_history','delete') then raise exception 'anon con privilegios en el historial'; end if;
 if not has_table_privilege('authenticated','public.wedding_site_drafts_history','select') then raise exception 'authenticated sin select'; end if;
 if has_table_privilege('authenticated','public.wedding_site_drafts_history','update') or has_table_privilege('authenticated','public.wedding_site_drafts_history','delete')
    or has_table_privilege('authenticated','public.wedding_site_drafts_history','truncate') then raise exception 'authenticated reescribe o borra el historial'; end if;
 if not has_column_privilege('authenticated','public.wedding_site_drafts_history','document','insert') or not has_column_privilege('authenticated','public.wedding_site_drafts_history','prompt','insert') then raise exception 'Faltan grants de insert'; end if;
 if has_column_privilege('authenticated','public.wedding_site_drafts_history','author_id','insert') then raise exception 'authenticated elige author_id'; end if;
 if has_column_privilege('authenticated','public.wedding_site_drafts_history','created_at','insert') or has_column_privilege('authenticated','public.wedding_site_drafts_history','id','insert') then raise exception 'authenticated escribe id/created_at'; end if;
 if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wedding_site_drafts_history'
            and coalesce(qual,'') || coalesce(with_check,'') !~ 'owns_wedding') then raise exception 'Política sin owns_wedding'; end if;
 if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wedding_site_drafts_history'
            and coalesce(qual,'') || coalesce(with_check,'') ~ 'couple_id') then raise exception 'Política con couple_id'; end if;
 if has_function_privilege('authenticated','public.wedding_site_drafts_history_trim()','execute') then raise exception 'authenticated ejecuta el recorte'; end if;
end $$;

-- ------------------------------------------------------------ CHECKs
do $$ begin
 begin insert into public.wedding_site_drafts_history(wedding_id,kind,document,draft_version) values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','borrar','{}',1); raise exception 'kind fuera de lista';
 exception when check_violation then null; end;
 begin insert into public.wedding_site_drafts_history(wedding_id,kind,prompt,document,draft_version) values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ai',repeat('a',601),'{}',1); raise exception 'Petición de 601 aceptada';
 exception when check_violation then null; end;
 begin insert into public.wedding_site_drafts_history(wedding_id,kind,document,draft_version) values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ai','[]',1); raise exception 'Documento no objeto aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_site_drafts_history(wedding_id,kind,changes,document,draft_version) values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ai','{"a":1}','{}',1); raise exception 'changes no lista aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_site_drafts_history(wedding_id,kind,document,draft_version) values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ai','{}',0); raise exception 'Versión 0 aceptada';
 exception when check_violation then null; end;
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
do $$ declare n integer; first_id uuid; r record; begin
 if (select count(*) from public.wedding_site_drafts_history) <> 0 then raise exception 'A ve el historial de B'; end if;

 -- Inserta su versión; author_id lo pone la base.
 insert into public.wedding_site_drafts_history(wedding_id,kind,prompt,summary,changes,document,draft_version)
  values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ai','Una bienvenida más cercana','Cambiamos la bienvenida.','["el mensaje de bienvenida"]','{"schemaVersion":1,"n":0}',2)
  returning id into first_id;
 select * into r from public.wedding_site_drafts_history where id = first_id;
 if r.author_id is distinct from 'c1111111-1111-4111-8111-111111111111'::uuid then raise exception 'author_id no es quien inserta'; end if;

 -- Aislamiento: no inserta en B, no ve B, no borra ni reescribe.
 begin insert into public.wedding_site_drafts_history(wedding_id,kind,document,draft_version) values ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','ai','{}',3); raise exception 'A escribe en el historial de B';
 exception when insufficient_privilege then null; end;
 begin update public.wedding_site_drafts_history set summary = 'otro' where id = first_id; raise exception 'A reescribe el historial';
 exception when insufficient_privilege then null; end;
 begin delete from public.wedding_site_drafts_history where id = first_id; raise exception 'A borra el historial';
 exception when insufficient_privilege then null; end;
 if exists (select 1 from public.wedding_site_drafts_history where id = 'cb000000-0000-4000-8000-000000000001') then raise exception 'A ve la fila de B'; end if;

 -- Recorte: 55 versiones más → quedan 50, las más recientes; la primera desaparece.
 for i in 1..55 loop
  insert into public.wedding_site_drafts_history(wedding_id,kind,document,draft_version)
   values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', case when i % 3 = 0 then 'restore' when i % 3 = 1 then 'manual' else 'ai' end, jsonb_build_object('schemaVersion',1,'n',i), 2 + i);
 end loop;
 select count(*) into n from public.wedding_site_drafts_history where wedding_id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
 if n <> 50 then raise exception 'El recorte deja % filas (esperadas 50)', n; end if;
 if exists (select 1 from public.wedding_site_drafts_history where id = first_id) then raise exception 'La versión más antigua sigue ahí'; end if;
 if (select min((document->>'n')::int) from public.wedding_site_drafts_history) <> 6 then raise exception 'El recorte no quita las más antiguas'; end if;
 if (select max((document->>'n')::int) from public.wedding_site_drafts_history) <> 55 then raise exception 'El recorte quita la última'; end if;
end $$;
reset role;

-- La otra persona de la pareja (miembro) ve el mismo historial.
insert into public.wedding_members(wedding_id,user_id,role) values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','c3333333-3333-4333-8333-333333333333','partner');
set local role authenticated;
select set_config('request.jwt.claim.sub','c3333333-3333-4333-8333-333333333333',true);
do $$ begin
 if (select count(*) from public.wedding_site_drafts_history) <> 50 then raise exception 'La pareja no ve el historial compartido'; end if;
 insert into public.wedding_site_drafts_history(wedding_id,kind,document,draft_version) values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual','{"schemaVersion":1,"n":56}',60);
 if (select count(*) from public.wedding_site_drafts_history) <> 50 then raise exception 'El recorte no se aplica a la pareja'; end if;
 if (select author_id from public.wedding_site_drafts_history where document->>'n' = '56') <> 'c3333333-3333-4333-8333-333333333333'::uuid then raise exception 'author_id de la pareja'; end if;
end $$;
reset role;

-- ================================================================ pareja B
set local role authenticated;
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222',true);
do $$ begin
 if (select count(*) from public.wedding_site_drafts_history) <> 1 then raise exception 'B ve el historial de A (o pierde el suyo)'; end if;
end $$;
reset role;

-- Sin sesión (anon): nada.
set local role anon;
do $$ begin
 begin perform 1 from public.wedding_site_drafts_history; raise exception 'anon lee el historial';
 exception when insufficient_privilege then null; end;
 begin insert into public.wedding_site_drafts_history(wedding_id,kind,document,draft_version) values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ai','{}',1); raise exception 'anon escribe el historial';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Borrar la boda arrastra su historial.
delete from public.weddings where id = 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
do $$ begin
 if exists (select 1 from public.wedding_site_drafts_history where wedding_id = 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2') then raise exception 'Queda historial de una boda borrada'; end if;
end $$;

do $$ begin raise notice 'site-drafts-history: grants, CHECK, author_id, recorte a 50, pareja compartida y aislamiento A/B OK'; end $$;
rollback;
