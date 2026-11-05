-- Retención de regalos anotados (20261026100000), junto a guest-retention.sql.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- «Hoy» fijo: 2027-07-15.
--   V (vieja)      2026-05-01, aviso 2027-06-15 -> se anonimiza el 2027-07-15
--   S (sin aviso)  2026-05-01, sin aviso        -> intacta (no se anonimiza sin aviso)
--   R (reciente)   2027-04-01                   -> intacta
begin;
insert into auth.users(id, email) values
 ('b1111111-1111-4111-8111-111111111111','vieja@ejemplo.es'),
 ('b2222222-2222-4222-8222-222222222222','sinaviso@ejemplo.es'),
 ('b3333333-3333-4333-8333-333333333333','reciente@ejemplo.es');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb','reg-vieja','b1111111-1111-4111-8111-111111111111','Ana','Luis','2026-05-01'),
 ('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb','reg-sinaviso','b2222222-2222-4222-8222-222222222222','Eva','Pau','2026-05-01'),
 ('bbbbbbb3-bbbb-4bbb-8bbb-bbbbbbbbbbbb','reg-reciente','b3333333-3333-4333-8333-333333333333','Sol','Mar','2027-04-01');
insert into public.wedding_guests(id,wedding_id,name,phone) values
 ('b0000000-0000-4000-8000-000000000011','bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Tía Puri','+34600000011'),
 ('b0000000-0000-4000-8000-000000000012','bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Tío Pepe','+34600000012'),
 ('b0000000-0000-4000-8000-000000000021','bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Primo Leo','+34600000021'),
 ('b0000000-0000-4000-8000-000000000031','bbbbbbb3-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Nacho','+34600000031'),
 ('b0000000-0000-4000-8000-000000000032','bbbbbbb3-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Marta','+34600000032');
insert into public.wedding_gifts(id,wedding_id,kind,amount_cents,description,note,received_on,thanked_at) values
 ('c0000000-0000-4000-8000-000000000011','bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bizum',15000,null,'De parte de Puri y Pepe','2026-05-01','2026-05-10 12:00+02'),
 ('c0000000-0000-4000-8000-000000000012','bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb','objeto',null,'Vajilla de la tía Puri','Le encantó elegirla','2026-04-20',null),
 ('c0000000-0000-4000-8000-000000000013','bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb','efectivo',20000,null,null,'2026-05-01',null),
 ('c0000000-0000-4000-8000-000000000021','bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb','transferencia',10000,null,'Leo','2026-05-01',null),
 ('c0000000-0000-4000-8000-000000000031','bbbbbbb3-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bizum',5000,'Para el viaje','Nacho','2027-04-01',null),
 ('c0000000-0000-4000-8000-000000000032','bbbbbbb3-bbbb-4bbb-8bbb-bbbbbbbbbbbb','otro',null,'Un cuadro','Marta','2027-04-01',null);
insert into public.wedding_gift_givers(gift_id,guest_id,wedding_id) values
 ('c0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000011','bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('c0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000012','bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('c0000000-0000-4000-8000-000000000012','b0000000-0000-4000-8000-000000000011','bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('c0000000-0000-4000-8000-000000000013','b0000000-0000-4000-8000-000000000012','bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('c0000000-0000-4000-8000-000000000021','b0000000-0000-4000-8000-000000000021','bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('c0000000-0000-4000-8000-000000000031','b0000000-0000-4000-8000-000000000031','bbbbbbb3-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('c0000000-0000-4000-8000-000000000032','b0000000-0000-4000-8000-000000000032','bbbbbbb3-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
-- Los regalos exigen ≥ 1 regalante al final de la transacción (trigger diferido): se comprueba ya.
set constraints all immediate;
set constraints all deferred;

-- ------------------------------------------------------------ privilegios
do $$
declare f text;
begin
 foreach f in array array['public.anonymise_expired_guests(date,integer)','public.wedding_gift_givers_drop_orphan()'] loop
   if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise exception '% ejecutable sin service_role', f; end if;
   if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception '% no es definer', f; end if;
   if not exists (select 1 from pg_proc where oid = f::regprocedure and proconfig @> array['search_path=""']) then raise exception '% sin search_path', f; end if;
 end loop;
 if not has_function_privilege('service_role', 'public.anonymise_expired_guests(date,integer)', 'execute') then raise exception 'service_role no ejecuta anonymise_expired_guests'; end if;
 if (select count(*) from pg_proc where proname in ('anonymise_expired_guests','wedding_gift_givers_drop_orphan')) <> 2 then raise exception 'Sobrecargas de más'; end if;
end $$;

set local role service_role;
-- ------------------------------------------------------------ anonimización
do $$
declare n int; gift record;
begin
 perform public.mark_retention_notice('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 update public.wedding_retention set notice_sent_at = timestamptz '2027-06-15 09:00+02' where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

 -- Un día antes de cumplir 30 días desde el aviso: nada.
 if public.anonymise_expired_guests('2027-07-14', 200) <> 0 then raise exception 'Anonimizó antes de 30 días desde el aviso'; end if;
 if (select count(*) from public.wedding_gift_givers where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 4 then raise exception 'Regalantes de V tocados antes de tiempo'; end if;

 n := public.anonymise_expired_guests('2027-07-15', 200);
 if n <> 1 then raise exception 'Bodas anonimizadas: % (esperada 1: solo V)', n; end if;

 -- V: los regalos siguen (mismo número y mismos totales), sin quién ni texto libre.
 if (select count(*) from public.wedding_gifts where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 3 then raise exception 'Regalos de V borrados'; end if;
 if (select sum(amount_cents) from public.wedding_gifts where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 35000 then raise exception 'Total de V cambiado'; end if;
 if exists (select 1 from public.wedding_gift_givers where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Regalantes de V siguen'; end if;
 if exists (select 1 from public.wedding_gifts where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and (note is not null or description is not null)) then raise exception 'Notas o descripciones de V siguen'; end if;
 select * into gift from public.wedding_gifts where id = 'c0000000-0000-4000-8000-000000000011';
 if gift.kind <> 'bizum' or gift.amount_cents <> 15000 or gift.received_on <> date '2026-05-01' or gift.thanked_at is null then raise exception 'V perdió datos que se conservan: %', row_to_json(gift); end if;
 select * into gift from public.wedding_gifts where id = 'c0000000-0000-4000-8000-000000000012';
 if gift.kind <> 'objeto' or gift.received_on <> date '2026-04-20' or gift.thanked_at is not null then raise exception 'Regalo sin importe de V alterado: %', row_to_json(gift); end if;
 -- El resumen de la pareja sigue cuadrando (crm_gift_summary cuenta por boda).
 if (select count(*) from public.wedding_gifts f where f.wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and f.kind in ('bizum','efectivo')) <> 2 then raise exception 'Reparto por tipo de V cambiado'; end if;
 -- Los invitados de V también (la parte de 20261024100000 sigue funcionando).
 if (select count(*) from public.wedding_guests where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and phone is not null) <> 0 then raise exception 'Invitados de V sin anonimizar'; end if;

 -- S (sin aviso) y R (reciente): intactas.
 if (select count(*) from public.wedding_gift_givers where wedding_id in ('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbb3-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) <> 3 then raise exception 'Regalantes ajenos borrados'; end if;
 if (select note from public.wedding_gifts where id = 'c0000000-0000-4000-8000-000000000021') is distinct from 'Leo' then raise exception 'Nota de S tocada'; end if;
 if (select description from public.wedding_gifts where id = 'c0000000-0000-4000-8000-000000000031') is distinct from 'Para el viaje' then raise exception 'Descripción de R tocada'; end if;

 -- Idempotente: reejecutar no hace nada y no toca los regalos ya anonimizados.
 if public.anonymise_expired_guests('2027-07-15', 200) <> 0 then raise exception 'No idempotente'; end if;
 if public.anonymise_expired_guests('2027-08-15', 200) <> 0 then raise exception 'Reanonimizó (S sin aviso no cuenta)'; end if;
 if (select count(*) from public.wedding_gifts where wedding_id = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 3 then raise exception 'Regalos de V cambiaron al reejecutar'; end if;

 -- El trigger de huérfanos sigue funcionando en bodas no anonimizadas:
 -- quitar el único regalante de un regalo de R borra el regalo.
 delete from public.wedding_gift_givers where gift_id = 'c0000000-0000-4000-8000-000000000032';
 if exists (select 1 from public.wedding_gifts where id = 'c0000000-0000-4000-8000-000000000032') then raise exception 'Regalo huérfano de R no borrado'; end if;
 if not exists (select 1 from public.wedding_gifts where id = 'c0000000-0000-4000-8000-000000000031') then raise exception 'Borró otro regalo de R'; end if;
end $$;
reset role;

-- La pareja de V (sesión) sigue viendo sus regalos y sus totales.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
do $$
declare n int; total bigint;
begin
 select count(*), coalesce(sum(amount_cents), 0) into n, total from public.wedding_gift_list('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if n <> 3 or total <> 35000 then raise exception 'wedding_gift_list de V: % regalos, % céntimos', n, total; end if;
 if exists (select 1 from public.wedding_gift_list('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb') where givers <> '[]'::jsonb) then raise exception 'V con regalantes en la lista'; end if;
 select gift_count, total_cents into n, total from public.crm_gift_summary('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if n <> 3 or total <> 35000 then raise exception 'crm_gift_summary de V: % regalos, % céntimos', n, total; end if;
end $$;
reset role;

do $$ begin raise notice 'gift-retention: regalos de la boda anonimizada sin quién ni notas, con importes y totales; otras bodas intactas; idempotente; trigger de huérfanos intacto fuera de la retención'; end $$;
rollback;
