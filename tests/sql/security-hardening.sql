-- Endurecimiento (20261029100000): privilegios, TTL de invitaciones, email
-- confirmado al aceptar invitación y retención de contribuciones.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/security-hardening.sql
begin;
insert into auth.users(id, email, email_confirmed_at) values
 ('c1111111-1111-4111-8111-111111111111','dueña@ejemplo.es', now()),
 ('c2222222-2222-4222-8222-222222222222','pareja@ejemplo.es', null),
 ('c3333333-3333-4333-8333-333333333333','vieja@ejemplo.es', now());
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('caaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','hard-a','c1111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 120),
 ('caaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa','hard-vieja','c3333333-3333-4333-8333-333333333333','Eva','Pau','2026-05-01');

-- (a) Barrido: ninguna función security definer de public es ejecutable por anon.
-- Lista permitida vacía: si una RPC pública debe ser anónima, se justifica aquí.
do $$
declare r record; n int := 0;
begin
 for r in with allowlist(name) as (select null::text where false)  -- vacía: nada es anónimo a propósito
          select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname = 'public' and p.prosecdef
            and p.proname not in (select name from allowlist)
            and has_function_privilege('anon', p.oid, 'execute') loop
   raise warning 'anon ejecuta %', r.sig; n := n + 1;
 end loop;
 if n > 0 then raise exception '% funciones security definer ejecutables por anon', n; end if;
 -- Helpers de RLS: tampoco para anon.
 if has_function_privilege('anon', 'public.owns_wedding(uuid)', 'execute') or has_function_privilege('anon', 'public.guest_tags_valid(text[])', 'execute')
   then raise exception 'helper ejecutable por anon'; end if;
 if not has_function_privilege('authenticated', 'public.owns_wedding(uuid)', 'execute') then raise exception 'authenticated sin owns_wedding'; end if;
end $$;

-- (b) profiles: solo full_name y phone.
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111', true);
update public.profiles set full_name = 'Ana B', phone = '+34600000000' where id = 'c1111111-1111-4111-8111-111111111111';
do $$
begin
 begin
  update public.profiles set role = 'planner' where id = 'c1111111-1111-4111-8111-111111111111';
  raise exception 'authenticated cambió profiles.role';
 exception when insufficient_privilege then null; end;
 begin
  update public.profiles set id = id where id = 'c1111111-1111-4111-8111-111111111111';
  raise exception 'authenticated actualizó profiles.id';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- (c) Legacy: authenticated no escribe vendors, vendor_invoices ni payment_tranches; select sigue.
insert into public.vendors(id,wedding_id,name,email,category) values
 ('c0000000-0000-4000-8000-0000000000a1','caaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fotos','f@ejemplo.es','foto');
insert into public.payment_tranches(id,vendor_id,label,amount_cents) values
 ('c0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-0000000000a1','Señal',1000);
insert into public.vendor_invoices(id,vendor_id,file_path,total_cents) values
 ('c0000000-0000-4000-8000-0000000000d1','c0000000-0000-4000-8000-0000000000a1','a',1);
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111', true);
do $$
declare t text; op text; sqls text[];
begin
 if (select count(*) from public.vendors) <> 1 or (select count(*) from public.payment_tranches) <> 1 or (select count(*) from public.vendor_invoices) <> 1
  then raise exception 'select de las tablas legacy no funciona'; end if;
 sqls := array[
  'insert into public.vendors(wedding_id,name,email,category) values (''caaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''X'',''x@ejemplo.es'',''y'')',
  'update public.vendors set name = ''Z''', 'delete from public.vendors',
  'insert into public.payment_tranches(vendor_id,label,amount_cents) values (''c0000000-0000-4000-8000-0000000000a1'',''x'',1)',
  'update public.payment_tranches set status = ''paid'', paid_at = now()', 'delete from public.payment_tranches',
  'insert into public.vendor_invoices(vendor_id,file_path,total_cents) values (''c0000000-0000-4000-8000-0000000000a1'',''a'',1)',
  'update public.vendor_invoices set total_cents = 2', 'delete from public.vendor_invoices'];
 foreach op in array sqls loop
  begin execute op; raise exception 'permitido: %', op;
  exception when insufficient_privilege then null; end;
 end loop;
end $$;
reset role;

-- (d) TTL de invitaciones (trigger): 60 días se rechaza; 7 y 30 se aceptan; un reenvío
-- (expires_at = ahora + 7 días) sobre una invitación de hace 40 días funciona.
do $$
begin
 begin
  insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at)
   values ('caaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pareja@ejemplo.es',repeat('1',64), now() + interval '60 days');
  raise exception 'TTL de 60 días aceptado';
 exception when check_violation then null; end;
 insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at)
  values ('caaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pareja@ejemplo.es',repeat('2',64), now() + interval '7 days');
 update public.wedding_member_invites set created_at = now() - interval '40 days', sent_at = now() - interval '40 days', expires_at = now() - interval '33 days' where token_hash = repeat('2',64);
 update public.wedding_member_invites set expires_at = now() + interval '7 days' where token_hash = repeat('2',64);
 begin
  update public.wedding_member_invites set expires_at = now() + interval '60 days' where token_hash = repeat('2',64);
  raise exception 'update a 60 días aceptado';
 exception when check_violation then null; end;
end $$;
delete from public.wedding_member_invites;

-- (e) accept_wedding_invite: email sin confirmar -> email_mismatch; confirmado -> ok.
insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at)
 values ('caaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pareja@ejemplo.es',
         encode(sha256(convert_to(repeat('A',40),'UTF8')),'hex'), now() + interval '7 days');
set local role authenticated;
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222', true);
do $$
begin
 if public.accept_wedding_invite(repeat('A',40)) <> 'email_mismatch' then raise exception 'aceptó con email sin confirmar'; end if;
 if public.pending_wedding_invite_for_me() then raise exception 'pending con email sin confirmar'; end if;
end $$;
reset role;
update auth.users set email_confirmed_at = now() where id = 'c2222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222', true);
do $$
begin
 if not public.pending_wedding_invite_for_me() then raise exception 'pending no ve la invitación con email confirmado'; end if;
 if public.accept_wedding_invite(repeat('A',40)) <> 'ok' then raise exception 'no aceptó con email confirmado'; end if;
end $$;
reset role;

-- (f) Retención: contribuciones anonimizadas, importes y Stripe intactos.
insert into public.contributions(id,wedding_id,guest_name,guest_email,n_cubiertos,cubierto_cents,gift_cents,total_cents,message,method,status,stripe_payment_intent_id) values
 ('c0000000-0000-4000-8000-0000000000c1','caaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa','María García López','maria@ejemplo.es',2,5000,2000,12000,'¡Felicidades!','card','confirmed','pi_old'),
 ('c0000000-0000-4000-8000-0000000000c2','caaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nacho','n@ejemplo.es',1,5000,0,5000,null,'bizum_manual','confirmed',null),
 ('c0000000-0000-4000-8000-0000000000c3','caaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Pepe Gil','p@ejemplo.es',1,5000,0,5000,'Hola','card','confirmed','pi_new');
select public.mark_retention_notice('caaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
update public.wedding_retention set notice_sent_at = timestamptz '2027-06-15 09:00+02' where wedding_id = 'caaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$
declare c record;
begin
 if public.anonymise_expired_guests(date '2027-07-15') <> 1 then raise exception 'debía anonimizar 1 boda'; end if;
 select * into c from public.contributions where id = 'c0000000-0000-4000-8000-0000000000c1';
 if c.guest_name <> 'María G.' or c.guest_email is not null or c.message is not null then raise exception 'contribución no anonimizada: %', c; end if;
 if c.total_cents <> 12000 or c.gift_cents <> 2000 or c.stripe_payment_intent_id <> 'pi_old' or c.status <> 'confirmed' then raise exception 'se perdieron importes/Stripe'; end if;
 select * into c from public.contributions where id = 'c0000000-0000-4000-8000-0000000000c2';
 if c.guest_name <> 'Nacho' or c.guest_email is not null then raise exception 'una sola palabra: %', c; end if;
 select * into c from public.contributions where id = 'c0000000-0000-4000-8000-0000000000c3';
 if c.guest_name <> 'Pepe Gil' or c.guest_email is null or c.message is null then raise exception 'tocó una boda no vencida'; end if;
 if public.anonymise_expired_guests(date '2027-07-15') <> 0 then raise exception 'no es idempotente'; end if;
end $$;
rollback;
