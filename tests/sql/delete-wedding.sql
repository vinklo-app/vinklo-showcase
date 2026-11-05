-- «Eliminar nuestra boda» (plan maestro §5.10): el dueño borra la boda con
-- su sesión (política weddings_delete_couple) y TODO lo que cuelga de ella
-- cae en cascada; la otra boda queda intacta; la pareja secundaria no puede
-- borrarla. «Eliminar mi cuenta»: borrar el usuario de Auth arrastra su
-- perfil y su fila de miembro; transferir la boda a la pareja con
-- service_role (cambio de couple_id) conserva la boda.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
begin;
insert into auth.users(id, email) values
 ('b1111111-1111-4111-8111-111111111111','dueña-a@ejemplo.es'),
 ('b2222222-2222-4222-8222-222222222222','pareja-a@ejemplo.es'),
 ('b3333333-3333-4333-8333-333333333333','dueña-b@ejemplo.es');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb','borrar-a','b1111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 90),
 ('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb','borrar-b','b3333333-3333-4333-8333-333333333333','Lucía','Juan',current_date + 90);
insert into public.wedding_members(wedding_id,user_id,role) values
 ('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b2222222-2222-4222-8222-222222222222','partner');

-- Una fila en cada tabla hija posible de las dos bodas, de forma genérica:
-- se cuentan todas las tablas con FK directa a weddings(id) y sus nietas.
create function pg_temp.child_counts(w uuid) returns jsonb language plpgsql as $$
declare r record; n bigint; out jsonb := '{}';
begin
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.weddings'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using w;
    out := out || jsonb_build_object(r.tbl, n);
  end loop;
  return out;
end $$;

do $$
declare w uuid;
begin
 foreach w in array array['bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb']::uuid[] loop
  insert into public.wedding_guests(id,wedding_id,name,phone) values (gen_random_uuid(), w, 'Invitado', '+34600000000');
  insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash)
    select g.id, g.wedding_id, encode(sha256(convert_to(w::text,'UTF8')),'hex') from public.wedding_guests g where g.wedding_id = w;
  insert into public.wedding_tables(wedding_id,name,seats,position) values (w,'Mesa 1',8,1);
  update public.wedding_guests set table_id = (select id from public.wedding_tables where wedding_id = w) where wedding_id = w;
  insert into public.wedding_message_templates(wedding_id,kind,body) values (w,'invitation','Hola {nombre}: {enlace}');
  insert into public.wedding_vendor_contacts(wedding_id,name,category) values (w,'Finca','lugar');
  insert into public.wedding_sites(wedding_id,draft_document,draft_version) values (w,'{"schemaVersion":1}'::jsonb,1);
  insert into public.events(wedding_id,type) values (w,'prueba');
  insert into public.wedding_tasks(wedding_id,title) values (w,'Elegir finca');
  insert into public.wedding_agenda_items(wedding_id,title,time_label) values (w,'Ceremonia','12:00');
 end loop;
end $$;

-- ------------------------------------------------------------ esquema
do $$ begin
 -- Ninguna FK hacia weddings, sus invitados, mesas, webs, proveedores o
 -- presupuestos impide el borrado: todas en cascada o set null (salvo la
 -- revisión publicada, que se borra en la misma sentencia).
 if exists (
   select 1 from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and c.confrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
     and c.confdeltype not in ('c','n')
     and c.conname not in ('wedding_sites_published_revision_fkey')
 ) then
   raise exception 'FK sin cascada: %', (select string_agg(conrelid::regclass || '.' || conname, ', ') from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.confdeltype not in ('c','n') and c.conname not in ('wedding_sites_published_revision_fkey'));
 end if;
 if (select confdeltype from pg_constraint where conname = 'profiles_id_fkey') <> 'c' then raise exception 'profiles no cae con auth.users'; end if;
end $$;

-- Publicar una revisión de A: la FK sin cascada (published_revision) no bloquea.
-- El contrato del documento no es lo que se prueba aquí (se revierte con el ROLLBACK).
alter table public.wedding_site_revisions drop constraint wedding_site_revisions_document_contract;
do $$ declare rev uuid; begin
  insert into public.wedding_site_revisions(site_id, wedding_id, number, document, schema_version)
  select s.id, s.wedding_id, 1, s.draft_document, 1 from public.wedding_sites s where s.wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  returning id into rev;
  update public.wedding_sites set published_revision_id = rev, published_at = now() where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
end $$;

-- ------------------------------------------------------------ la pareja secundaria no borra
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
delete from public.weddings where id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
-- La dueña de B no borra A.
select set_config('request.jwt.claim.sub', 'b3333333-3333-4333-8333-333333333333', true);
delete from public.weddings where id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
reset role;
do $$ begin
 if not exists (select 1 from public.weddings where id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Alguien que no es dueño borró A'; end if;
end $$;

-- ------------------------------------------------------------ la dueña borra A
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
delete from public.weddings where id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
reset role;
do $$
declare a jsonb := pg_temp.child_counts('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
        b jsonb := pg_temp.child_counts('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
begin
 if exists (select 1 from public.weddings where id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'A no se borró'; end if;
 if exists (select 1 from jsonb_each(a) where value <> '0'::jsonb) then raise exception 'Restos de A: %', a; end if;
 if exists (select 1 from public.wedding_guest_tokens where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Tokens de A'; end if;
 if exists (select 1 from public.wedding_site_revisions where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Revisiones de A'; end if;
 -- La pareja ya no es miembro de nada; su cuenta sigue.
 if exists (select 1 from public.wedding_members where user_id = 'b2222222-2222-4222-8222-222222222222') then raise exception 'La pareja sigue como miembro'; end if;
 if not exists (select 1 from public.profiles where id = 'b2222222-2222-4222-8222-222222222222') then raise exception 'Se borró el perfil de la pareja'; end if;
 -- B intacta.
 if (b->>'public.wedding_guests')::int <> 1 or (b->>'public.events')::int <> 1 or (b->>'public.wedding_tables')::int <> 1 or (b->>'public.wedding_members')::int <> 1 then raise exception 'B tocada: %', b; end if;
 if (select count(*) from public.wedding_guest_tokens where wedding_id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'Tokens de B'; end if;
end $$;

-- ------------------------------------------------------------ cuenta: transferir y borrar
-- B gana una pareja; la dueña de B borra su cuenta: antes se transfiere B.
insert into public.wedding_members(wedding_id,user_id,role) values
 ('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b2222222-2222-4222-8222-222222222222','partner');
set local role service_role;
update public.weddings set couple_id = 'b2222222-2222-4222-8222-222222222222' where id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
reset role;
delete from auth.users where id = 'b3333333-3333-4333-8333-333333333333';
do $$ begin
 if not exists (select 1 from public.weddings where id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'B se borró al transferir'; end if;
 if (select array_agg(user_id::text || ':' || role) from public.wedding_members where wedding_id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    <> array['b2222222-2222-4222-8222-222222222222:owner'] then raise exception 'Miembros de B tras transferir: %', (select array_agg(user_id::text || ':' || role) from public.wedding_members where wedding_id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); end if;
 if exists (select 1 from public.profiles where id = 'b3333333-3333-4333-8333-333333333333') then raise exception 'Perfil borrado sigue'; end if;
 if (select count(*) from public.wedding_guests where wedding_id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'Invitados de B perdidos'; end if;
end $$;
-- Pareja secundaria que borra su cuenta: solo sale su fila; la boda sigue.
insert into auth.users(id, email) values ('b4444444-4444-4444-8444-444444444444','nueva-pareja@ejemplo.es');
insert into public.wedding_members(wedding_id,user_id,role) values
 ('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b4444444-4444-4444-8444-444444444444','partner');
delete from auth.users where id = 'b4444444-4444-4444-8444-444444444444';
do $$ begin
 if not exists (select 1 from public.weddings where id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'La boda cayó con la pareja secundaria'; end if;
 if (select count(*) from public.wedding_members where wedding_id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'Fila de la pareja secundaria sigue'; end if;
end $$;

do $$ begin raise notice 'delete-wedding: solo la dueña borra, cascada completa sin restos, la otra boda intacta; cuenta: transferencia y salida de la pareja'; end $$;
rollback;
