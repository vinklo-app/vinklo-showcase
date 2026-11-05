-- Recordatorios por grupo (20261012200000). Base DE PRUEBAS vacía con todas
-- las migraciones. Dos parejas; todo se revierte.
begin;
insert into auth.users(id) values ('71111111-1111-4111-8111-111111111111'), ('72222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','rq-pareja-a','71111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 60),
 ('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','rq-pareja-b','72222222-2222-4222-8222-222222222222','Eva','Pau',current_date + 60);
-- A: tres para recordar (enviadas hace 5 días, con teléfono), dos en «Familia», una sin grupo; B: una en «Familia».
insert into public.wedding_guests(id,wedding_id,name,phone,rsvp_status,invitation_prepared_at,invitation_sent_at,group_name) values
 ('7a000000-0000-4000-8000-000000000001','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Alba','612345671','pendiente',now() - interval '6 days',now() - interval '5 days','Familia'),
 ('7a000000-0000-4000-8000-000000000002','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Bea','612345672','pendiente',now() - interval '6 days',now() - interval '5 days','Familia'),
 ('7a000000-0000-4000-8000-000000000003','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ciro','612345673','pendiente',now() - interval '6 days',now() - interval '5 days',null),
 ('7b000000-0000-4000-8000-000000000001','7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Dora','612345674','pendiente',now() - interval '6 days',now() - interval '5 days','Familia');

do $$ begin
  if has_function_privilege('anon','public.reminder_queue(uuid,integer,text,text)','execute') then raise exception 'reminder_queue ejecutable por anon'; end if;
  if exists (select 1 from pg_proc where proname = 'reminder_queue' and pronargs = 2) then raise exception 'queda la versión antigua'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',true);
do $$ declare n int; g text; begin
  select count(*) into n from public.reminder_queue('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if n <> 3 then raise exception 'sin grupo: esperaba 3, %', n; end if;
  select count(*) into n from public.reminder_queue('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 200, 'Familia');
  if n <> 2 then raise exception 'Familia: esperaba 2, %', n; end if;
  select max(total_count), max(group_name) into n, g from public.reminder_queue('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 'Familia');
  if n <> 2 or g <> 'Familia' then raise exception 'total/grupo: %, %', n, g; end if;
  -- La boda de B no es visible para A, ni filtrando por un grupo con el mismo nombre.
  select count(*) into n from public.reminder_queue('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 200, 'Familia');
  if n <> 0 then raise exception 'fuga entre bodas: %', n; end if;
end $$;
reset role;
rollback;
