-- Fecha límite de confirmación (20261006300000_weddings_rsvp_deadline).
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rsvp-deadline.sql
-- Dos bodas ficticias; todo se revierte con ROLLBACK. Fechas relativas con
-- margen de ±2 días para no depender de la medianoche UTC/Madrid.
begin;
insert into auth.users(id) values ('81111111-1111-4111-8111-111111111111'), ('82222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','plazo-pareja-a','81111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 60),
 ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','plazo-pareja-b','82222222-2222-4222-8222-222222222222','Lucia','Juan',current_date + 60);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status) values
 ('8a000000-0000-4000-8000-000000000001','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invitada A','pendiente'),
 ('8b000000-0000-4000-8000-000000000001','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Invitado B','pendiente');
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash) values
 ('8a000000-0000-4000-8000-000000000001','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64)),
 ('8b000000-0000-4000-8000-000000000001','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('b',64));

-- ------------------------------------------------------------ privilegios
do $$ begin
 if not has_column_privilege('authenticated','public.weddings','rsvp_deadline','update') then raise exception 'La pareja no puede editar rsvp_deadline'; end if;
 if has_column_privilege('anon','public.weddings','rsvp_deadline','update') then raise exception 'anon puede editar rsvp_deadline'; end if;
 -- 20261006102000 sigue vigente.
 if has_column_privilege('authenticated','public.weddings','slug','update') then raise exception 'slug volvió a ser editable'; end if;
 if has_function_privilege('anon','public.guest_rsvp_closes_at(date,date,timestamptz)','execute') then raise exception 'closes_at(3) expuesta a anon'; end if;
 if has_function_privilege('authenticated','public.guest_rsvp_closes_at(date,date,timestamptz)','execute') then raise exception 'closes_at(3) expuesta a authenticated'; end if;
 if has_function_privilege('authenticated','public.guest_rsvp_respond(text,text,text,integer,text)','execute') then raise exception 'RSVP RPC ejecutable por authenticated'; end if;
 -- Vista pública: solo service_role, misma frontera que antes, y la columna nueva al final.
 if has_table_privilege('anon','public.weddings_public','select') then raise exception 'weddings_public legible por anon'; end if;
 if has_table_privilege('authenticated','public.weddings_public','select') then raise exception 'weddings_public legible por authenticated'; end if;
 if not has_table_privilege('service_role','public.weddings_public','select') then raise exception 'service_role sin weddings_public'; end if;
 if (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'public.weddings_public'::regclass and attnum > 0 and not attisdropped)
    <> 'slug,partner_name_1,partner_name_2,wedding_date,cubierto_price_cents,cover_image_url,bizum_phone,stripe_onboarded,plan,page_config,rsvp_deadline'
   then raise exception 'Columnas de weddings_public alteradas'; end if;
 if not exists (select 1 from pg_class where oid = 'public.weddings_public'::regclass and 'security_invoker=true' = any(reloptions)) then raise exception 'weddings_public perdió security_invoker'; end if;
end $$;

-- ---------------------------------------- la pareja fija y borra su plazo
set local role authenticated;
select set_config('request.jwt.claim.sub','81111111-1111-4111-8111-111111111111',true);
do $$ begin
 update public.weddings set rsvp_deadline = current_date + 30 where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if not found then raise exception 'El propietario no pudo fijar el plazo'; end if;
 -- Misma sentencia que updateWeddingSettings: ajustes + plazo a la vez.
 update public.weddings set partner_name_1='Ana María', wedding_date = current_date + 61, rsvp_deadline = current_date + 61 where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if not found then raise exception 'Ajustes con plazo = boda rechazados'; end if;
 update public.weddings set rsvp_deadline = null where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if not found then raise exception 'El propietario no pudo borrar el plazo'; end if;
 -- Otra pareja: 0 filas (RLS), sin error.
 update public.weddings set rsvp_deadline = current_date + 10 where id='8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 if found then raise exception 'Plazo de otra boda cambiado'; end if;
end $$;
-- Plazo posterior a la boda: check.
do $$ begin
 update public.weddings set rsvp_deadline = wedding_date + 1 where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 raise exception 'Plazo posterior a la boda aceptado';
exception when check_violation then null; end $$;
do $$ begin
 update public.weddings set wedding_date = current_date + 5, rsvp_deadline = current_date + 6 where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 raise exception 'Plazo y boda incoherentes aceptados en la misma sentencia';
exception when check_violation then null; end $$;
reset role;
do $$ begin
 if (select rsvp_deadline from public.weddings where id='8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') is not null then raise exception 'B alterada'; end if;
 if (select partner_name_1 from public.weddings where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'Ana María' then raise exception 'Ajustes de A no guardados'; end if;
end $$;

-- ------- adelantar la boda (sincronización tras publicar) ajusta el plazo
update public.weddings set wedding_date = current_date + 60, rsvp_deadline = current_date + 50 where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claim.sub','81111111-1111-4111-8111-111111111111',true);
do $$ begin
 -- Como publishSite: solo wedding_date (y otros campos), sin tocar el plazo.
 update public.weddings set wedding_date = current_date + 40, partner_name_2 = 'Luis' where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if (select rsvp_deadline from public.weddings where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> current_date + 40 then raise exception 'El plazo no siguió a la boda adelantada'; end if;
 -- Retrasar la boda no mueve el plazo.
 update public.weddings set wedding_date = current_date + 70 where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if (select rsvp_deadline from public.weddings where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> current_date + 40 then raise exception 'Retrasar la boda movió el plazo'; end if;
end $$;
reset role;

-- --------------------------------------------------------- cierre efectivo
do $$ begin
 -- Con plazo: fin de ese día en Madrid (CEST en mayo), aunque no haya boda.
 if public.guest_rsvp_closes_at('2027-06-12'::date, '2027-05-01'::date, now()) <> '2027-05-02 00:00:00+02'::timestamptz then raise exception 'Cierre con plazo mal calculado'; end if;
 if public.guest_rsvp_closes_at(null::date, '2027-01-15'::date, now()) <> '2027-01-16 00:00:00+01'::timestamptz then raise exception 'Cierre con plazo sin boda mal calculado'; end if;
 -- Sin plazo: regla anterior intacta.
 if public.guest_rsvp_closes_at('2027-06-12'::date, null::date, now()) <> '2027-06-14 00:00:00+02'::timestamptz then raise exception 'Regla por defecto alterada'; end if;
 if public.guest_rsvp_closes_at(null::date, null::date, '2026-10-06 10:00:00+00') <> '2027-10-06 10:00:00+00'::timestamptz then raise exception 'Regla sin fecha alterada'; end if;
end $$;

-- ------------------------------------------------------ RPC con plazo
-- Plazo futuro: acepta.
update public.weddings set wedding_date = current_date + 60, rsvp_deadline = current_date + 2 where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('plazo-pareja-a', repeat('a',64), 'si', 1, null) <> 'ok' then raise exception 'Respuesta antes del plazo rechazada'; end if;
end $$;
reset role;
-- Plazo vencido con boda futura: cerrada.
update public.weddings set rsvp_deadline = current_date - 2 where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('plazo-pareja-a', repeat('a',64), 'no', 0, null) <> 'closed' then raise exception 'Respuesta tras el plazo aceptada'; end if;
 if (select rsvp_status from public.wedding_guests where id='8a000000-0000-4000-8000-000000000001') <> 'si' then raise exception 'Respuesta tras el plazo guardada'; end if;
 -- El plazo de A no afecta a B.
 if public.guest_rsvp_respond('plazo-pareja-b', repeat('b',64), 'si', 0, null) <> 'ok' then raise exception 'El plazo de A frenó a B'; end if;
end $$;
reset role;
-- Plazo vencido sin fecha de boda: también cerrada (el plazo manda sobre los 365 días).
update public.weddings set wedding_date = null where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('plazo-pareja-a', repeat('a',64), 'no', 0, null) <> 'closed' then raise exception 'Plazo sin boda ignorado'; end if;
end $$;
reset role;
-- Sin plazo y boda pasada: sigue cerrada por la regla anterior.
update public.weddings set wedding_date = current_date - 3, rsvp_deadline = null where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('plazo-pareja-a', repeat('a',64), 'no', 0, null) <> 'closed' then raise exception 'Boda pasada sin plazo aceptó'; end if;
end $$;
reset role;
-- Quitar el plazo con boda futura reabre.
update public.weddings set wedding_date = current_date + 60, rsvp_deadline = null where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ begin
 if public.guest_rsvp_respond('plazo-pareja-a', repeat('a',64), 'no', 0, null) <> 'ok' then raise exception 'Quitar el plazo no reabrió'; end if;
end $$;
reset role;

do $$ begin raise notice 'rsvp-deadline: privilegios, check, ajuste al adelantar la boda, cierre y RPC OK'; end $$;
rollback;
