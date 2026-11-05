-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- Ejecutar como administrador SQL: psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/security-attendance.sql
-- Usa datos ficticios; revierte todos los cambios con ROLLBACK.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test-pareja-a','11111111-1111-4111-8111-111111111111','Ana','Luis'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','test-pareja-b','22222222-2222-4222-8222-222222222222','Lucia','Juan');
insert into public.wedding_guests(wedding_id,name,rsvp_status,rsvp_companions,invitation_prepared_at,invitation_sent_at) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invitado confirmado','si',2,now(),now()),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invitado rechazo','no',0,now(),null),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invitado pendiente','pendiente',0,null,null),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Otra pareja','pendiente',0,null,null);
insert into public.wedding_guests(wedding_id,name)
 select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Ficticio ' || n from generate_series(1,1005) n;
do $$ begin
 begin
  insert into public.weddings(slug,couple_id,partner_name_1,partner_name_2)
   values('duplicate-pareja-a','11111111-1111-4111-8111-111111111111','Ana','Luis');
  raise exception 'Concurrent duplicate wedding allowed';
 exception when unique_violation then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare s record; affected integer;
begin
 select * into s from public.attendance_summary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if s.total <> 1008 or s.pending <> 1006 or s.confirmed <> 1 or s.declined <> 1 or s.companions <> 2 or s.attendees <> 3 or s.prepared <> 2 or s.sent <> 1 then raise exception 'Incorrect aggregate'; end if;
 if exists(select 1 from public.attendance_summary('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then raise exception 'Foreign aggregate exposed'; end if;
 update public.wedding_guests set name='Forbidden' where wedding_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign guest modified'; end if;
 begin
   update public.contributions set status='confirmed';
   raise exception 'Financial grant still exposed';
 exception when insufficient_privilege then null; end;
 begin
   update public.weddings set plan='premium' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   raise exception 'Premium writable';
 exception when insufficient_privilege then null; end;
 begin
   update public.wedding_guests set rsvp_notes=repeat('x',501) where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   raise exception 'Oversized notes accepted';
 exception when check_violation then null; end;
 if has_function_privilege('authenticated','public.cleanup_rate_limit_hits(integer)','execute') then raise exception 'Cleanup exposed'; end if;
 if has_table_privilege('authenticated','public.weddings_public','select') then raise exception 'Public view exposed'; end if;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select 1 from public.wedding_guests where wedding_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Foreign guest readable'; end if;
 if (select total from public.attendance_summary('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) <> 1 then raise exception 'Own summary unavailable'; end if;
end $$;
set local role anon;
do $$ begin
 if has_function_privilege('anon','public.attendance_summary(uuid)','execute') then raise exception 'Anonymous summary exposed'; end if;
 if has_table_privilege('anon','public.wedding_guests','select') then raise exception 'Anonymous guests exposed'; end if;
end $$;
reset role;
insert into public.rate_limit_hits(bucket_key,created_at) select 'expired-fixture',now()-interval '3 days' from generate_series(1,20);
set local role service_role;
do $$ begin
 if not public.rl_check('sql-fixture',1,3600) or public.rl_check('sql-fixture',1,3600) then raise exception 'Limit not enforced'; end if;
 if public.cleanup_rate_limit_hits(10) <> 10 then raise exception 'Cleanup not bounded'; end if;
 if (select count(*) from public.rate_limit_hits where bucket_key='expired-fixture') <> 10 then raise exception 'Cleanup wrong rows'; end if;
 if not exists(select 1 from public.rate_limit_hits where bucket_key='sql-fixture') then raise exception 'Recent hit removed'; end if;
end $$;
rollback;
