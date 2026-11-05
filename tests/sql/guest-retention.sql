-- Retención tras la boda (20261024100000) y de events (20261024110000).
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- Tres bodas con fecha relativa a un «hoy» fijo (2027-06-15):
--   V (vieja)    2026-05-01  -> más de 12 meses
--   C (cercana)  2026-07-01  -> dentro de la ventana de aviso (12 meses - 30 días)
--   R (reciente) 2027-04-01  -> fuera de todo
begin;
insert into auth.users(id, email) values
 ('a1111111-1111-4111-8111-111111111111','vieja@ejemplo.es'),
 ('a2222222-2222-4222-8222-222222222222','cercana@ejemplo.es'),
 ('a3333333-3333-4333-8333-333333333333','reciente@ejemplo.es');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ret-vieja','a1111111-1111-4111-8111-111111111111','Ana','Luis','2026-05-01'),
 ('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ret-cercana','a2222222-2222-4222-8222-222222222222','Eva','Pau','2026-07-01'),
 ('aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ret-reciente','a3333333-3333-4333-8333-333333333333','Sol','Mar','2027-04-01');
insert into public.wedding_guests(id,wedding_id,name,phone,notes,rsvp_status,rsvp_companions,rsvp_notes,rsvp_answers,invitation_token_hash,group_name) values
 ('a0000000-0000-4000-8000-000000000001','aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tía Puri','+34600000001','Prima','si',1,'Celiaca','{"menu":"vegano"}',repeat('1',64),'Familia'),
 ('a0000000-0000-4000-8000-000000000002','aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Primo Leo','+34600000002','Amigo','si',0,'Sin lactosa','{"bus":true}',repeat('2',64),null),
 ('a0000000-0000-4000-8000-000000000003','aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nacho','+34600000003',null,'no',0,'Lo siento','{}',repeat('3',64),null);
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash) values
 ('a0000000-0000-4000-8000-000000000001','aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64)),
 ('a0000000-0000-4000-8000-000000000002','aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('b',64)),
 ('a0000000-0000-4000-8000-000000000003','aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('c',64));

-- Acompañantes con nombre: la tabla es de otra rama. Si no existe aquí, se
-- crea una mínima para comprobar que la función la limpia cuando aparece.
do $$ begin
 if to_regclass('public.wedding_guest_companions') is null then
   create table public.wedding_guest_companions (
     id uuid primary key default gen_random_uuid(),
     guest_id uuid not null references public.wedding_guests(id) on delete cascade,
     wedding_id uuid not null references public.weddings(id) on delete cascade,
     name text not null
   );
 end if;
end $$;
insert into public.wedding_guest_companions(guest_id,wedding_id,name) values
 ('a0000000-0000-4000-8000-000000000001','aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tío Pepe'),
 ('a0000000-0000-4000-8000-000000000002','aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Carla');

-- ------------------------------------------------------------ privilegios
do $$
declare f text;
begin
 if not (select relrowsecurity from pg_class where oid = 'public.wedding_retention'::regclass) then raise exception 'wedding_retention sin RLS'; end if;
 if has_table_privilege('authenticated','public.wedding_retention','select') or has_table_privilege('anon','public.wedding_retention','select')
    or has_table_privilege('authenticated','public.wedding_retention','update') then raise exception 'wedding_retention accesible desde la Data API'; end if;
 foreach f in array array['public.retention_notice_candidates(date,integer)','public.mark_retention_notice(uuid)','public.anonymise_expired_guests(date,integer)','public.purge_old_events(integer)'] loop
   if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise exception '% ejecutable sin service_role', f; end if;
   if not has_function_privilege('service_role', f, 'execute') then raise exception 'service_role no ejecuta %', f; end if;
   if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception '% no es definer', f; end if;
   if not exists (select 1 from pg_proc where oid = f::regprocedure and proconfig @> array['search_path=""']) then raise exception '% sin search_path', f; end if;
 end loop;
 if (select count(*) from pg_proc where proname in ('retention_notice_candidates','mark_retention_notice','anonymise_expired_guests','purge_old_events')) <> 4 then raise exception 'Sobrecargas de más'; end if;
 if to_regclass('public.events_wedding_created_idx') is null or to_regclass('public.events_created_at_idx') is null then raise exception 'Faltan índices de events'; end if;
end $$;

-- authenticated no puede llamarlas (ni siquiera con sesión).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
do $$ begin
 begin
   perform public.anonymise_expired_guests('2027-06-15', 200);
   raise exception 'authenticated anonimizó';
 exception when insufficient_privilege then null; end;
 begin
   perform public.purge_old_events(10);
   raise exception 'authenticated purgó events';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
-- ------------------------------------------------------------ aviso
do $$
declare ids uuid[]; v_on date;
begin
 -- Hoy = 2027-06-15: V (+12m = 2027-05-01) y C (+12m - 30 = 2027-06-01) avisables; R no.
 select array_agg(wedding_id order by wedding_date) into ids from public.retention_notice_candidates('2027-06-15', 200);
 if ids is distinct from array['aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::uuid[] then raise exception 'Candidatas de aviso: %', ids; end if;
 -- Boda vieja sin aviso previo: la fecha efectiva es hoy + 30 (no se anonimiza sin aviso).
 select anonymise_on into v_on from public.retention_notice_candidates('2027-06-15', 200) where wedding_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if v_on <> date '2027-07-15' then raise exception 'anonymise_on de V: %', v_on; end if;
 select anonymise_on into v_on from public.retention_notice_candidates('2027-06-15', 200) where wedding_id = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if v_on <> date '2027-07-15' then raise exception 'anonymise_on de C: %', v_on; end if;
 -- Antes de la ventana, nada.
 if exists (select 1 from public.retention_notice_candidates('2027-03-01', 200)) then raise exception 'Aviso demasiado pronto'; end if;

 -- Sin aviso: no se anonimiza aunque V tenga más de 12 meses.
 if public.anonymise_expired_guests('2027-06-15', 200) <> 0 then raise exception 'Anonimizó sin aviso'; end if;
 if (select phone from public.wedding_guests where id = 'a0000000-0000-4000-8000-000000000001') is null then raise exception 'V tocada sin aviso'; end if;

 -- Marcar el aviso de V y C (dos veces: idempotente, la primera marca manda).
 if not public.mark_retention_notice('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'mark V'; end if;
 perform public.mark_retention_notice('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 update public.wedding_retention set notice_sent_at = timestamptz '2027-06-15 09:00+02';
 perform public.mark_retention_notice('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if (select notice_sent_at from public.wedding_retention where wedding_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> timestamptz '2027-06-15 09:00+02' then raise exception 'La segunda marca pisó la primera'; end if;
 if public.mark_retention_notice('99999999-9999-4999-8999-999999999999') then raise exception 'Marcó una boda inexistente'; end if;
 if exists (select 1 from public.retention_notice_candidates('2027-06-15', 200)) then raise exception 'Aviso repetido'; end if;

 -- Aviso dado hace menos de 30 días: todavía no.
 if public.anonymise_expired_guests('2027-07-14', 200) <> 0 then raise exception 'Anonimizó antes de 30 días desde el aviso'; end if;
end $$;

-- ------------------------------------------------------------ anonimización
do $$
declare g record; n int;
begin
 -- C se mueve a 2026-07-20 para separar casos: el 2027-07-15 V cumple
 -- (12 meses y 30 días de aviso) y C todavía no (sus 12 meses son el 2027-07-20).
 update public.weddings set wedding_date = '2026-07-20' where id = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 n := public.anonymise_expired_guests('2027-07-15', 200);
 if n <> 1 then raise exception 'Bodas anonimizadas: % (esperada 1)', n; end if;

 select * into g from public.wedding_guests where id = 'a0000000-0000-4000-8000-000000000001';
 if g.phone is not null or g.notes is not null or g.rsvp_notes is not null or g.rsvp_answers is not null or g.invitation_token_hash is not null then
   raise exception 'V no anonimizada: %', row_to_json(g);
 end if;
 -- Se conserva lo que no identifica ni permite contactar.
 if g.name <> 'Tía Puri' or g.rsvp_status <> 'si' or g.rsvp_companions <> 1 or g.group_name <> 'Familia' then raise exception 'V perdió datos que se conservan: %', row_to_json(g); end if;
 if exists (select 1 from public.wedding_guest_tokens where wedding_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Tokens de V siguen'; end if;
 if exists (select 1 from public.wedding_guest_companions where wedding_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Acompañantes de V siguen'; end if;
 if (select anonymised_at from public.wedding_retention where wedding_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is null then raise exception 'V sin anonymised_at'; end if;

 -- Solo la boda objetivo: C (antes de sus 12 meses) y R intactas.
 if (select phone from public.wedding_guests where id = 'a0000000-0000-4000-8000-000000000002') is null
    or (select rsvp_answers from public.wedding_guests where id = 'a0000000-0000-4000-8000-000000000002') is null then raise exception 'C tocada antes de tiempo'; end if;
 if (select count(*) from public.wedding_guest_tokens where wedding_id in ('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 2 then raise exception 'Tokens ajenos borrados'; end if;
 if (select count(*) from public.wedding_guest_companions where wedding_id = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 then raise exception 'Acompañantes ajenos borrados'; end if;
 if (select phone from public.wedding_guests where id = 'a0000000-0000-4000-8000-000000000003') is null then raise exception 'R tocada'; end if;

 -- Idempotente: reejecutar el mismo día no hace nada.
 if public.anonymise_expired_guests('2027-07-15', 200) <> 0 then raise exception 'No idempotente'; end if;
 -- La anonimizada ya no vuelve a pedir aviso.
 if exists (select 1 from public.retention_notice_candidates('2027-07-15', 200) where wedding_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Aviso a una boda ya anonimizada'; end if;

 -- C cumple sus 12 meses (2027-07-20) con el aviso dado el 2027-06-15.
 if public.anonymise_expired_guests('2027-07-20', 200) <> 1 then raise exception 'C no se anonimizó a su fecha'; end if;
 if (select phone from public.wedding_guests where id = 'a0000000-0000-4000-8000-000000000002') is not null then raise exception 'C sin anonimizar'; end if;
 if (select phone from public.wedding_guests where id = 'a0000000-0000-4000-8000-000000000003') is null then raise exception 'R tocada (2)'; end if;
end $$;

-- ------------------------------------------------------------ events
do $$
declare n bigint;
begin
 delete from public.events;
 insert into public.events(wedding_id,type,payload,created_at) values
  ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','vieja','{}',now() - interval '14 months'),
  (null,'vieja_global','{}',now() - interval '13 months 1 day'),
  ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reciente','{}',now() - interval '12 months'),
  ('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa','hoy','{}',now());
 n := public.purge_old_events(1);
 if n <> 1 then raise exception 'Lote de 1: %', n; end if;
 n := public.purge_old_events(10000);
 if n <> 1 then raise exception 'Segundo lote: %', n; end if;
 if (select array_agg(type order by type) from public.events) <> array['hoy','reciente'] then raise exception 'events tras purgar: %', (select array_agg(type) from public.events); end if;
 if public.purge_old_events(10000) <> 0 then raise exception 'purge no idempotente'; end if;
 begin
   perform public.purge_old_events(0);
   raise exception 'Aceptó lote 0';
 exception when raise_exception then
   if sqlerrm <> 'invalid batch size' then raise; end if;
 end;
end $$;
reset role;

do $$ begin raise notice 'guest-retention: aviso único 30 días antes, anonimización solo tras 12 meses y 30 días de aviso, solo la boda objetivo, idempotente; events > 13 meses purgados por lotes'; end $$;
rollback;
