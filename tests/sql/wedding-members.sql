-- Segunda cuenta de pareja (20261015100000): wedding_members, owns_wedding()
-- por membresía, invitaciones y accept_wedding_invite().
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/wedding-members.sql
-- Dos bodas (A: Ana + Luis invitado; B: Lucía) y dos intrusos; todo se revierte con ROLLBACK.
--   U1 ana@ejemplo.es     dueña de A
--   U2 Luis@Ejemplo.es    pareja invitada a A (email con mayúsculas a propósito)
--   U3 lucia@ejemplo.es   dueña de B
--   U4 intruso@ejemplo.es sin boda
--   U5 otro@ejemplo.es    sin boda, intenta usar el enlace de Luis
begin;
insert into auth.users(id, email) values
 ('91111111-1111-4111-8111-111111111111','ana@ejemplo.es'),
 ('92222222-2222-4222-8222-222222222222','Luis@Ejemplo.es'),
 ('93333333-3333-4333-8333-333333333333','lucia@ejemplo.es'),
 ('94444444-4444-4444-8444-444444444444','intruso@ejemplo.es'),
 ('95555555-5555-4555-8555-555555555555','otro@ejemplo.es');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pareja-a-miembros','91111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 120),
 ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','pareja-b-miembros','93333333-3333-4333-8333-333333333333','Lucia','Juan',current_date + 120);
insert into public.wedding_guests(id,wedding_id,name,phone,rsvp_status,rsvp_companions,group_name,invitation_prepared_at,invitation_sent_at) values
 ('9a000000-0000-4000-8000-000000000001','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tía Puri','+34600000001','si',1,'Familia',now(),now() - interval '5 days'),
 ('9a000000-0000-4000-8000-000000000002','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Primo Luis','+34600000002','pendiente',0,'Familia',now(),now() - interval '5 days'),
 ('9a000000-0000-4000-8000-000000000003','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nacho','+34600000003','no',0,'Trabajo',null,null),
 ('9b000000-0000-4000-8000-000000000001','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Invitado B','+34600000009','si',0,null,null,null);
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash) values
 ('9a000000-0000-4000-8000-000000000001','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64));
insert into public.wedding_tables(id,wedding_id,name,seats,position) values
 ('9a100000-0000-4000-8000-000000000001','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa 1',8,1),
 ('9b100000-0000-4000-8000-000000000001','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Mesa 1',8,1);
insert into public.wedding_message_templates(wedding_id,kind,body) values
 ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invitation','Hola {nombre}: {enlace}'),
 ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','invitation','Hola {nombre}: {enlace}');
insert into public.wedding_vendor_contacts(wedding_id,name,category) values
 ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Finca El Olivar','lugar'),
 ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Catering B','catering');
insert into public.wedding_sites(wedding_id,draft_document,draft_version) values
 ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"schemaVersion":1}'::jsonb,1),
 ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{"schemaVersion":1}'::jsonb,1);
insert into storage.objects(bucket_id,name) values
 ('wedding-photos','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-1.jpg'),
 ('wedding-photos','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-2.jpg'),
 ('wedding-photos','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cover-1.jpg');

-- Lo que ve una sesión de la boda A, en un solo documento: tablas por RLS,
-- las RPC de lectura del panel y storage. Dos sesiones con el mismo acceso
-- deben producir exactamente el mismo documento.
create function pg_temp.snap() returns jsonb language sql as $$
  select jsonb_build_object(
    'owns', public.owns_wedding('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'wedding', (select jsonb_agg(jsonb_build_object('id', w.id, 'p1', w.partner_name_1, 'p2', w.partner_name_2)) from public.weddings w where w.id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'guests', (select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'rsvp', g.rsvp_status, 'table', g.table_id) order by g.id) from public.wedding_guests g where g.wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'gifts', (select jsonb_agg(jsonb_build_object('id', f.id, 'thanked', f.thanked_at is not null) order by f.id) from public.wedding_gifts f where f.wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'givers', (select count(*) from public.wedding_gift_givers gg where gg.wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'tables', (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.id) from public.wedding_tables t where t.wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'templates', (select jsonb_agg(jsonb_build_object('kind', m.kind, 'body', m.body) order by m.kind) from public.wedding_message_templates m where m.wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'vendors', (select count(*) from public.wedding_vendor_contacts v where v.wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'site', (select jsonb_agg(jsonb_build_object('v', s.draft_version, 'pub', s.published_revision_id is not null)) from public.wedding_sites s where s.wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'photos', (select jsonb_agg(o.name order by o.name) from storage.objects o where o.bucket_id = 'wedding-photos' and o.name like '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%'),
    'invites', (select jsonb_agg(jsonb_build_object('email', i.email, 'accepted', i.accepted_at is not null) order by i.created_at) from public.wedding_member_invites i where i.wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'attendance', (select to_jsonb(a) from public.attendance_summary('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') a),
    'funnel', (select to_jsonb(f) from public.crm_funnel_summary('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') f),
    'gift_summary', (select to_jsonb(f) from public.crm_gift_summary('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') f),
    'gift_list', (select jsonb_agg(f.id order by f.id) from public.wedding_gift_list('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') f),
    'filters', (select to_jsonb(c) from public.guest_filter_counts('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') c),
    'groups', (select jsonb_agg(to_jsonb(s) order by s.group_name) from public.guest_group_summary('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') s),
    'page', (select jsonb_agg(p.id order by p.id) from public.guest_page('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','todos',null,100,0) p),
    'queue', (select jsonb_agg(q.id order by q.id) from public.reminder_queue('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') q),
    'seating', public.wedding_seating('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'vendor_summary', (select to_jsonb(v) from public.wedding_vendor_summary('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') v)
  );
$$;
-- Documento de quien no tiene acceso: todo vacío.
create function pg_temp.empty_snap(s jsonb) returns boolean language sql as $$
  select s->>'owns' = 'false'
     and (select bool_and(value = 'null'::jsonb or value = '0'::jsonb) from jsonb_each(s - 'owns' - 'seating'))
     and s->'seating' = '{"tables": [], "unseated": []}'::jsonb;
$$;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, true);
$$;
grant execute on function pg_temp.snap(), pg_temp.empty_snap(jsonb), pg_temp.as_user(uuid) to authenticated, anon;

-- ------------------------------------------------------------ esquema y privilegios
do $$ begin
 if not (select relrowsecurity from pg_class where oid = 'public.wedding_members'::regclass) then raise exception 'wedding_members sin RLS'; end if;
 if not (select relrowsecurity from pg_class where oid = 'public.wedding_member_invites'::regclass) then raise exception 'wedding_member_invites sin RLS'; end if;
 -- Backfill/trigger: cada boda tiene a su dueño como owner.
 if (select count(*) from public.wedding_members where role = 'owner') <> (select count(*) from public.weddings) then raise exception 'Bodas sin owner en wedding_members'; end if;
 if not exists (select 1 from public.wedding_members where wedding_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='91111111-1111-4111-8111-111111111111' and role='owner') then raise exception 'Ana no es owner de A'; end if;
 -- La RPC de aceptar: definer con search_path fijado, sin anon.
 if not (select prosecdef from pg_proc where oid = 'public.accept_wedding_invite(text)'::regprocedure) then raise exception 'accept_wedding_invite no es definer'; end if;
 if not exists (select 1 from pg_proc where oid = 'public.accept_wedding_invite(text)'::regprocedure and proconfig @> array['search_path=""']) then raise exception 'accept_wedding_invite sin search_path'; end if;
 if has_function_privilege('anon','public.accept_wedding_invite(text)','execute') then raise exception 'anon ejecuta accept_wedding_invite'; end if;
 if not has_function_privilege('authenticated','public.accept_wedding_invite(text)','execute') then raise exception 'authenticated sin accept_wedding_invite'; end if;
 if has_function_privilege('anon','public.pending_wedding_invite_for_me()','execute') then raise exception 'anon ejecuta pending_wedding_invite_for_me'; end if;
 if has_function_privilege('anon','public.wedding_partners()','execute') or has_function_privilege('anon','public.remove_wedding_partner()','execute') then raise exception 'anon ejecuta RPC de pareja'; end if;
 -- owns_wedding sigue siendo invoker (como antes) y con search_path.
 if (select prosecdef from pg_proc where oid = 'public.owns_wedding(uuid)'::regprocedure) then raise exception 'owns_wedding cambió a definer'; end if;
 -- Nadie inserta miembros a mano; anon no toca nada; el hash no se lee.
 if has_table_privilege('authenticated','public.wedding_members','insert') or has_table_privilege('authenticated','public.wedding_members','update')
    or has_table_privilege('authenticated','public.wedding_members','delete') then raise exception 'authenticated escribe wedding_members'; end if;
 if has_table_privilege('anon','public.wedding_members','select') or has_table_privilege('anon','public.wedding_member_invites','select')
    or has_table_privilege('anon','public.wedding_member_invites','insert') then raise exception 'anon con privilegios'; end if;
 if has_column_privilege('authenticated','public.wedding_member_invites','token_hash','select') then raise exception 'token_hash legible'; end if;
 -- La pareja edita la boda (owns_wedding) pero nunca puede hacerse dueña: couple_id/id fuera del grant de columnas.
 if has_column_privilege('authenticated','public.weddings','couple_id','update') or has_column_privilege('authenticated','public.weddings','id','update') then raise exception 'authenticated puede cambiar el dueño de la boda'; end if;
 if has_column_privilege('authenticated','public.wedding_member_invites','accepted_at','update')
    or has_column_privilege('authenticated','public.wedding_member_invites','wedding_id','update') then raise exception 'La pareja puede marcar aceptada o mover una invitación'; end if;
 -- No queda ningún couple_id = auth.uid() en funciones ni políticas salvo lo previsto.
 -- wedding_mark_deleted (20261030110000): solo el dueño, como weddings_delete_couple, y
 -- la propia función borra las membresías (un reintento no podría mirarlas).
 if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc ilike '%couple_id%'
               and p.proname not in ('wedding_members_sync_owner', 'accept_wedding_invite', 'wedding_mark_deleted')) then
   raise exception 'Función con couple_id en línea: %', (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc ilike '%couple_id%' and p.proname not in ('wedding_members_sync_owner', 'accept_wedding_invite', 'wedding_mark_deleted'));
 end if;
 if exists (select 1 from pg_policies where coalesce(qual,'') || coalesce(with_check,'') ilike '%couple_id%'
             and policyname not in ('weddings_insert_couple', 'weddings_delete_couple', 'weddings_select_couple')) then raise exception 'Política con couple_id en línea'; end if;
end $$;

-- ================================================================ invitar (Ana)
set local role authenticated;
select pg_temp.as_user('91111111-1111-4111-8111-111111111111');
do $$ declare owner_snap jsonb; begin
 -- Antes de nada: Ana ve su boda.
 owner_snap := pg_temp.snap();
 if pg_temp.empty_snap(owner_snap) or jsonb_array_length(owner_snap->'guests') <> 3 then raise exception 'Ana no ve su boda: %', owner_snap; end if;
 -- Invitar a Luis (token «luis» de 43 caracteres base64url; se guarda solo el hash).
 insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
 values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','luis@ejemplo.es',
         encode(sha256(convert_to('luis-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','UTF8')),'hex'),
         now() + interval '7 days','91111111-1111-4111-8111-111111111111');
 -- Una pendiente por boda.
 begin
   insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
   values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','otro@ejemplo.es',repeat('b',64),now() + interval '7 days','91111111-1111-4111-8111-111111111111');
   raise exception 'Dos invitaciones pendientes';
 exception when unique_violation then null; end;
 -- A sí misma no.
 begin
   delete from public.wedding_member_invites where email = 'luis@ejemplo.es';
   insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
   values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ana@ejemplo.es',repeat('c',64),now() + interval '7 days','91111111-1111-4111-8111-111111111111');
   raise exception 'Invitación a sí misma aceptada';
 exception when check_violation then null; end;
 -- Ni a otra boda ni en nombre de otro.
 begin
   insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
   values ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','luis@ejemplo.es',repeat('d',64),now() + interval '7 days','91111111-1111-4111-8111-111111111111');
   raise exception 'Invitación en boda ajena';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
   values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x@ejemplo.es',repeat('e',64),now() + interval '7 days','93333333-3333-4333-8333-333333333333');
   raise exception 'created_by ajeno';
 exception when insufficient_privilege or unique_violation then null; end;
 -- Email sin normalizar: CHECK.
 begin
   insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
   values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Luis@Ejemplo.es',repeat('f',64),now() + interval '7 days','91111111-1111-4111-8111-111111111111');
   raise exception 'Email con mayúsculas aceptado';
 exception when check_violation or unique_violation then null; end;
 if (select count(*) from public.wedding_member_invites) <> 1 then raise exception 'Ana debería ver 1 invitación'; end if;
 -- Reenviar = rotar hash y caducidad (se hace y se deshace).
 update public.wedding_member_invites set sent_at = now() where email = 'luis@ejemplo.es';
 if not found then raise exception 'Ana no puede reenviar'; end if;
end $$;

-- Lucía (B) invita a Ana, que ya tiene boda (para probar has_wedding).
select pg_temp.as_user('93333333-3333-4333-8333-333333333333');
insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
values ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ana@ejemplo.es',
        encode(sha256(convert_to('ana-token-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB','UTF8')),'hex'),
        now() + interval '7 days','93333333-3333-4333-8333-333333333333');
do $$ begin
 if (select count(*) from public.wedding_member_invites) <> 1 then raise exception 'Lucía ve invitaciones de A'; end if;
 if not pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Lucía ve datos de A: %', pg_temp.snap(); end if;
end $$;

-- ================================================================ antes de aceptar
select pg_temp.as_user('92222222-2222-4222-8222-222222222222');
do $$ begin
 if not pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Luis ve A antes de aceptar: %', pg_temp.snap(); end if;
 if not public.pending_wedding_invite_for_me() then raise exception 'Luis no ve que tiene invitación pendiente'; end if;
 if exists (select 1 from public.wedding_partners()) then raise exception 'Luis ve miembros sin aceptar'; end if;
 -- Token mal formado o inexistente.
 if public.accept_wedding_invite('corto') <> 'invalid' then raise exception 'Token corto'; end if;
 if public.accept_wedding_invite(null) <> 'invalid' then raise exception 'Token null'; end if;
 if public.accept_wedding_invite('no-existe-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') <> 'invalid' then raise exception 'Token inexistente'; end if;
 if not pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Luis entró con un token inválido'; end if;
end $$;

-- Otro email con el enlace de Luis: falla.
select pg_temp.as_user('95555555-5555-4555-8555-555555555555');
do $$ begin
 if public.pending_wedding_invite_for_me() then raise exception 'Invitación pendiente para otro email'; end if;
 if public.accept_wedding_invite('luis-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') <> 'email_mismatch' then raise exception 'Otro email aceptó la invitación'; end if;
 if not pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Otro email ve A'; end if;
end $$;

-- Ana (ya con boda) intenta aceptar la de B: has_wedding.
select pg_temp.as_user('91111111-1111-4111-8111-111111111111');
do $$ begin
 if public.accept_wedding_invite('ana-token-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB') <> 'has_wedding' then raise exception 'Ana entró en una segunda boda'; end if;
 if (select count(*) from public.wedding_members) <> 1 then raise exception 'Ana con dos membresías'; end if;
end $$;

-- Caducado: falla (se fuerza la caducidad como administrador y se restaura).
reset role;
update public.wedding_member_invites set created_at = now() - interval '9 days', expires_at = now() - interval '1 second' where email = 'luis@ejemplo.es';
set local role authenticated;
select pg_temp.as_user('92222222-2222-4222-8222-222222222222');
do $$ begin
 if public.accept_wedding_invite('luis-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') <> 'expired' then raise exception 'Token caducado aceptado'; end if;
 if public.pending_wedding_invite_for_me() then raise exception 'Invitación caducada cuenta como pendiente'; end if;
 if not pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Luis entró con token caducado'; end if;
end $$;
reset role;
update public.wedding_member_invites set expires_at = now() + interval '7 days' where email = 'luis@ejemplo.es';

-- anon no puede aceptar.
set local role anon;
do $$ begin
 perform public.accept_wedding_invite('luis-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
 raise exception 'anon aceptó';
exception when insufficient_privilege then null; end $$;

-- ================================================================ aceptar (Luis)
set local role authenticated;
select pg_temp.as_user('92222222-2222-4222-8222-222222222222');
do $$ begin
 if public.accept_wedding_invite('luis-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') <> 'ok' then raise exception 'Luis no pudo aceptar'; end if;
 if public.accept_wedding_invite('luis-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') <> 'already_member' then raise exception 'Segunda aceptación'; end if;
 if (select count(*) from public.wedding_partners()) <> 2 then raise exception 'wedding_partners: %', (select jsonb_agg(p) from public.wedding_partners() p); end if;
 if (select role from public.wedding_partners() where is_me) <> 'partner' then raise exception 'Luis no es partner'; end if;
 if (select email from public.wedding_partners() where role = 'owner') <> 'ana@ejemplo.es' then raise exception 'Luis no ve el email de Ana'; end if;
 -- La invitación aceptada ya no se puede tocar (ni reenviar ni cancelar).
 update public.wedding_member_invites set sent_at = now();
 if found then raise exception 'Invitación aceptada reenviada'; end if;
 delete from public.wedding_member_invites;
 if found then raise exception 'Invitación aceptada borrada'; end if;
end $$;

-- Usada por otra cuenta: 'used'.
select pg_temp.as_user('95555555-5555-4555-8555-555555555555');
do $$ begin
 if public.accept_wedding_invite('luis-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') <> 'used' then raise exception 'Token usado reutilizable'; end if;
end $$;

-- ================================================================ mismo acceso
create temp table snaps(who text primary key, doc jsonb);
grant all on snaps to authenticated;
select pg_temp.as_user('91111111-1111-4111-8111-111111111111');
insert into snaps values ('ana-1', pg_temp.snap());
select pg_temp.as_user('92222222-2222-4222-8222-222222222222');
insert into snaps values ('luis-1', pg_temp.snap());
do $$ begin
 if (select doc from snaps where who='ana-1') is distinct from (select doc from snaps where who='luis-1') then
   raise exception 'Ana y Luis ven cosas distintas: % vs %', (select doc from snaps where who='ana-1'), (select doc from snaps where who='luis-1'); end if;
 if pg_temp.empty_snap((select doc from snaps where who='luis-1')) then raise exception 'Luis no ve nada'; end if;
end $$;

-- Luis escribe en todo lo que gestiona la pareja.
do $$ declare v_gift uuid; v_rows integer; r record; v_guest uuid; begin
 -- Sin id: como addGuest (20261025100000 no concede INSERT (id) a authenticated).
 insert into public.wedding_guests(wedding_id,source,name,phone) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','couple','Amiga de Luis','+34600000004') returning id into v_guest;
 update public.wedding_guests set rsvp_status = 'si' where id = '9a000000-0000-4000-8000-000000000002';
 if not found then raise exception 'Luis no edita invitados'; end if;
 update public.weddings set partner_name_2 = 'Luis M.' where id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if not found then raise exception 'Luis no edita la boda'; end if;
 v_gift := public.create_wedding_gift('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['9a000000-0000-4000-8000-000000000001']::uuid[], 'bizum', 5000, null, null, current_date);
 if v_gift is null then raise exception 'Luis no anota regalos'; end if;
 update public.wedding_gifts set thanked_at = now() where id = v_gift;
 if not found then raise exception 'Luis no marca agradecido'; end if;
 insert into public.wedding_tables(wedding_id,name,seats,position) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa de Luis',6,2);
 update public.wedding_guests set table_id = '9a100000-0000-4000-8000-000000000001' where id = v_guest;
 if not found then raise exception 'Luis no sienta invitados'; end if;
 update public.wedding_message_templates set body = 'Hola {nombre}, os esperamos: {enlace}', updated_at = now() where wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind = 'invitation';
 if not found then raise exception 'Luis no edita mensajes'; end if;
 insert into public.wedding_message_templates(wedding_id,kind,body) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reminder','¿Venís? {enlace}');
 insert into public.wedding_vendor_contacts(wedding_id,name,category) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fotógrafa','fotografia');
 -- Web: borrador y RPC de publicar/retirar (versión equivocada = conflicto, no «prohibido»).
 update public.wedding_sites set draft_document = '{"schemaVersion":1,"x":1}'::jsonb, draft_version = 2 where wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if not found then raise exception 'Luis no edita el borrador'; end if;
 begin
   perform public.wedding_site_publish('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 99, '{"schemaVersion":1}'::jsonb);
   raise exception 'Publicar con versión vieja';
 exception when sqlstate '40001' then null; end;
 perform public.wedding_site_unpublish('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 -- Enlaces personales y recordatorios.
 if not exists (select 1 from public.issue_guest_token('9a000000-0000-4000-8000-000000000002', repeat('9',64), 'regenerate')) then raise exception 'Luis no regenera enlaces'; end if;
 update public.wedding_guests set invitation_sent_at = now() where id = '9a000000-0000-4000-8000-000000000002';
 if not exists (select 1 from public.confirm_guest_reminder('9a000000-0000-4000-8000-000000000002')) then raise exception 'Luis no confirma recordatorios'; end if;
 -- Fotos: borrar una.
 delete from storage.objects where bucket_id = 'wedding-photos' and name = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover-2.jpg';
 get diagnostics v_rows = row_count;
 if v_rows <> 1 then raise exception 'Luis no borra fotos'; end if;
 -- Pero no la boda entera (cosa del dueño) ni nada de B.
 delete from public.weddings where id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if found then raise exception 'La pareja invitada borró la boda'; end if;
 update public.weddings set partner_name_1 = 'X' where id = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 if found then raise exception 'Luis edita B'; end if;
 if exists (select 1 from public.wedding_guests where wedding_id = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Luis ve invitados de B'; end if;
 -- Ni crearse otra boda (un usuario, una boda).
 begin
   insert into public.weddings(slug,couple_id,partner_name_1,partner_name_2) values ('luis-propia-boda','92222222-2222-4222-8222-222222222222','Luis','Otra');
   raise exception 'Luis creó una segunda boda';
 exception when unique_violation then
   if sqlerrm not like '%wedding_members_one_wedding_per_user%' then raise exception 'Restricción inesperada: %', sqlerrm; end if;
 end;
 -- Ni quitar a la dueña.
 begin
   perform public.remove_wedding_partner();
   raise exception 'La pareja invitada quitó acceso';
 exception when insufficient_privilege then null; end;
 -- Abrir el enlace de un invitado siendo cualquiera de los dos novios no es una apertura.
end $$;
reset role;
do $$ begin
 if public.guest_invitation_opened('pareja-a-miembros', repeat('a',64), '92222222-2222-4222-8222-222222222222') <> 'owner' then raise exception 'La apertura de Luis cuenta como invitado'; end if;
 if public.guest_invitation_opened('pareja-a-miembros', repeat('a',64), '91111111-1111-4111-8111-111111111111') <> 'owner' then raise exception 'La apertura de Ana cuenta como invitado'; end if;
 if public.guest_invitation_opened('pareja-a-miembros', repeat('a',64), '93333333-3333-4333-8333-333333333333') <> 'ok' then raise exception 'Apertura de un tercero no registrada'; end if;
end $$;
set local role authenticated;

-- Ana ve exactamente lo que escribió Luis, y al revés.
select pg_temp.as_user('91111111-1111-4111-8111-111111111111');
insert into snaps values ('ana-2', pg_temp.snap());
select pg_temp.as_user('92222222-2222-4222-8222-222222222222');
insert into snaps values ('luis-2', pg_temp.snap());
do $$ declare s jsonb := (select doc from snaps where who='ana-2'); begin
 if s is distinct from (select doc from snaps where who='luis-2') then raise exception 'Tras escribir, ven cosas distintas'; end if;
 if s = (select doc from snaps where who='ana-1') then raise exception 'Las escrituras de Luis no se ven'; end if;
 if jsonb_array_length(s->'guests') <> 4 or jsonb_array_length(s->'gifts') <> 1 or jsonb_array_length(s->'tables') <> 2
    or jsonb_array_length(s->'templates') <> 2 or (s->>'vendors')::int <> 2 or jsonb_array_length(s->'photos') <> 1
    or s->'wedding'->0->>'p2' <> 'Luis M.' or (s->'site'->0->>'v')::int <> 2 then raise exception 'Escrituras de Luis incompletas: %', s; end if;
end $$;

-- ================================================================ terceros
select pg_temp.as_user('94444444-4444-4444-8444-444444444444');
do $$ declare v_rows integer; begin
 if not pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Intruso ve A: %', pg_temp.snap(); end if;
 if exists (select 1 from public.wedding_partners()) then raise exception 'Intruso ve miembros'; end if;
 begin
   insert into public.wedding_guests(wedding_id,name) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Colado');
   raise exception 'Intruso añade invitados';
 exception when insufficient_privilege then null; end;
 update public.wedding_guests set name = 'X' where wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if found then raise exception 'Intruso edita invitados'; end if;
 update public.weddings set partner_name_1 = 'X' where id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if found then raise exception 'Intruso edita la boda'; end if;
 if public.create_wedding_gift('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['9a000000-0000-4000-8000-000000000001']::uuid[], 'bizum', 100, null, null, null) is not null then raise exception 'Intruso anota regalos'; end if;
 begin
   insert into public.wedding_tables(wedding_id,name,seats,position) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mesa intrusa',6,3);
   raise exception 'Intruso crea mesas';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.wedding_message_templates(wedding_id,kind,body) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','thanks','Gracias {enlace}');
   raise exception 'Intruso escribe mensajes';
 exception when insufficient_privilege then null; end;
 update public.wedding_sites set draft_version = 50 where wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if found then raise exception 'Intruso edita la web'; end if;
 begin
   perform public.wedding_site_unpublish('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
   raise exception 'Intruso retira la web';
 exception when insufficient_privilege then null; end;
 if exists (select 1 from public.issue_guest_token('9a000000-0000-4000-8000-000000000001', repeat('8',64), 'regenerate')) then raise exception 'Intruso regenera enlaces'; end if;
 if exists (select 1 from public.confirm_guest_reminder('9a000000-0000-4000-8000-000000000001')) then raise exception 'Intruso confirma recordatorios'; end if;
 delete from storage.objects where name like '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%';
 get diagnostics v_rows = row_count;
 if v_rows <> 0 then raise exception 'Intruso borra fotos'; end if;
 begin
   insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
   values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','yo@ejemplo.es',repeat('7',64),now() + interval '7 days','94444444-4444-4444-8444-444444444444');
   raise exception 'Intruso se invita';
 exception when insufficient_privilege or unique_violation then null; end;
 begin
   perform public.remove_wedding_partner();
   raise exception 'Intruso quita parejas';
 exception when insufficient_privilege then null; end;
end $$;
-- La dueña de B tampoco ve A.
select pg_temp.as_user('93333333-3333-4333-8333-333333333333');
do $$ begin
 if not pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Lucía ve A'; end if;
end $$;

-- ================================================================ límite de 2
select pg_temp.as_user('91111111-1111-4111-8111-111111111111');
do $$ begin
 begin
   insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
   values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','intruso@ejemplo.es',repeat('6',64),now() + interval '7 days','91111111-1111-4111-8111-111111111111');
   raise exception 'Invitación con la boda completa';
 exception when check_violation then
   if sqlerrm <> 'wedding_members_full' then raise exception 'Error inesperado: %', sqlerrm; end if;
 end;
end $$;
-- Ni siquiera el administrador mete a un tercero.
reset role;
do $$ begin
 begin
   insert into public.wedding_members(wedding_id,user_id,role) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','94444444-4444-4444-8444-444444444444','partner');
   raise exception 'Tercer miembro';
 exception when check_violation then null; end;
end $$;
-- Una invitación colada (p. ej. carrera con otra pestaña) tampoco pasa al aceptar.
set local session_replication_role = replica;
insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at,created_by)
values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','intruso@ejemplo.es',
        encode(sha256(convert_to('intruso-token-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC','UTF8')),'hex'),
        now() + interval '7 days','91111111-1111-4111-8111-111111111111');
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.as_user('94444444-4444-4444-8444-444444444444');
do $$ begin
 if public.accept_wedding_invite('intruso-token-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC') <> 'full' then raise exception 'Tercer miembro por invitación'; end if;
 if not pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Intruso entró'; end if;
end $$;

-- ================================================================ quitar a la pareja
select pg_temp.as_user('91111111-1111-4111-8111-111111111111');
do $$ begin
 if public.remove_wedding_partner() <> 1 then raise exception 'Ana no quitó a Luis'; end if;
 if pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Ana perdió su boda'; end if;
end $$;
select pg_temp.as_user('92222222-2222-4222-8222-222222222222');
do $$ begin
 if not pg_temp.empty_snap(pg_temp.snap()) then raise exception 'Luis sigue viendo A tras quitarle'; end if;
end $$;

-- ================================================================ crear boda = owner
select pg_temp.as_user('94444444-4444-4444-8444-444444444444');
-- Con RETURNING, como createWedding (.insert().select("id")): la política de
-- SELECT se evalúa antes del trigger que da de alta al dueño.
insert into public.weddings(slug,couple_id,partner_name_1,partner_name_2) values ('intruso-boda-propia','94444444-4444-4444-8444-444444444444','Intruso','Pareja') returning id;
do $$ begin
 if not public.owns_wedding((select id from public.weddings where slug = 'intruso-boda-propia')) then raise exception 'Quien crea la boda no es miembro'; end if;
 if (select role from public.wedding_members where user_id = '94444444-4444-4444-8444-444444444444') <> 'owner' then raise exception 'Quien crea no es owner'; end if;
end $$;

reset role;
do $$ begin raise notice 'wedding-members: pareja invitada = dueña en invitados, regalos, mesas, mensajes, web y fotos; terceros fuera; email, caducidad y límite de 2 OK'; end $$;
rollback;
