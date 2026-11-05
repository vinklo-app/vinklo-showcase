-- Carrera real «Regenerar enlace» ↔ respuesta con el enlace antiguo
-- (20261006100000, auditoría 2026-10-04 H03).
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas y la
-- extensión dblink disponible (contrib). Ejecutar como superusuario local:
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rsvp-respond-concurrencia.sql
--
-- Necesita DOS transacciones de verdad, así que los datos se confirman
-- (otra conexión no ve datos sin confirmar) y se borran al final. Ids y slug
-- propios de esta suite. Si falla a medias, el siguiente arranque limpia.

create extension if not exists dblink;

delete from public.weddings where id = '5ccccccc-cccc-4ccc-8ccc-cccccccccccc';
delete from auth.users where id = '53333333-3333-4333-8333-333333333333';

insert into auth.users(id) values ('53333333-3333-4333-8333-333333333333');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('5ccccccc-cccc-4ccc-8ccc-cccccccccccc','rsvp-carrera','53333333-3333-4333-8333-333333333333','Eva','Pau',current_date + 90);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status) values
 ('5c000000-0000-4000-8000-000000000001','5ccccccc-cccc-4ccc-8ccc-cccccccccccc','Invitada carrera','pendiente');
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash) values
 ('5c000000-0000-4000-8000-000000000001','5ccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('1',64));

select dblink_connect('rev', format('host=%s port=%s dbname=%s user=%s', coalesce(nullif(split_part(current_setting('unix_socket_directories'), ',', 1), ''), '127.0.0.1'), current_setting('port'), current_database(), current_user));
select dblink_connect('rsvp', format('host=%s port=%s dbname=%s user=%s', coalesce(nullif(split_part(current_setting('unix_socket_directories'), ',', 1), ''), '127.0.0.1'), current_setting('port'), current_database(), current_user));
select * from dblink('rev', $q$select set_config('request.jwt.claim.sub','53333333-3333-4333-8333-333333333333',false)$q$) as t(x text);

-- Espera (acotada) a que la consulta asíncrona de `conn` esté bloqueada en
-- un lock. Si nunca se bloquea o termina antes, la prueba falla: un fallo
-- de locks no debe colgar el runner ni pasar en silencio.
create or replace function pg_temp.wait_blocked(conn text, needle text) returns void language plpgsql as $$
declare i integer;
begin
  for i in 1..400 loop  -- hasta 20 s: el runner de CI a veces tarda más de 5 s en llegar al lock
    if exists (select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%' || needle || '%' and pid <> pg_backend_pid()) then
      return;
    end if;
    if dblink_is_busy(conn) = 0 then raise exception 'La consulta de % terminó sin esperar el lock', conn; end if;
    perform pg_sleep(0.05);
  end loop;
  raise exception 'La consulta de % no llegó a bloquearse', conn;
end $$;

-- ===== Caso 1: la revocación toma el lock primero → el enlace antiguo NO guarda
select dblink_exec('rev', 'begin');
select * from dblink('rev', $q$select token_id from public.issue_guest_token('5c000000-0000-4000-8000-000000000001', repeat('2',64), 'regenerate')$q$) as t(token_id uuid);
select dblink_send_query('rsvp', $q$select public.guest_rsvp_respond('rsvp-carrera', repeat('1',64), 'si', 2, 'carrera 1')$q$);
select pg_temp.wait_blocked('rsvp', 'guest_rsvp_respond');
select dblink_exec('rev', 'commit');
create temp table caso1 as select * from dblink_get_result('rsvp') as t(r text);
select * from dblink_get_result('rsvp') as t(r text);
do $$ begin
 if (select r from caso1) is distinct from 'unavailable' then raise exception 'Caso 1: el enlace revocado guardó la respuesta (%)', (select r from caso1); end if;
 if (select rsvp_status from public.wedding_guests where id='5c000000-0000-4000-8000-000000000001') <> 'pendiente' then raise exception 'Caso 1: respuesta guardada tras revocar'; end if;
 raise notice 'carrera 1: revocar antes → enlace antiguo rechazado';
end $$;

-- ===== Caso 2: la respuesta toma el lock primero → se guarda; la revocación
-- espera y después invalida el enlace (política: respuesta con enlace válido
-- en ese momento se conserva).
select dblink_exec('rsvp', 'begin');
create temp table caso2 as select * from dblink('rsvp', $q$select public.guest_rsvp_respond('rsvp-carrera', repeat('2',64), 'si', 1, 'carrera 2')$q$) as t(r text);
select dblink_send_query('rev', $q$select token_id from public.issue_guest_token('5c000000-0000-4000-8000-000000000001', repeat('3',64), 'regenerate')$q$);
select pg_temp.wait_blocked('rev', 'issue_guest_token');
select dblink_exec('rsvp', 'commit');
create temp table caso2_rev as select * from dblink_get_result('rev') as t(token_id uuid);
select * from dblink_get_result('rev') as t(token_id uuid);
do $$ begin
 if (select r from caso2) is distinct from 'ok' then raise exception 'Caso 2: respuesta con enlace vigente rechazada (%)', (select r from caso2); end if;
 if (select count(*) from caso2_rev) <> 1 then raise exception 'Caso 2: la revocación no terminó'; end if;
 if (select rsvp_status || '/' || rsvp_companions from public.wedding_guests where id='5c000000-0000-4000-8000-000000000001') <> 'si/1' then raise exception 'Caso 2: respuesta perdida'; end if;
 if exists (select 1 from public.wedding_guest_tokens where token_hash = repeat('2',64) and revoked_at is null) then raise exception 'Caso 2: el enlace sigue activo tras revocar'; end if;
 if public.guest_rsvp_respond('rsvp-carrera', repeat('2',64), 'no', 0, null) <> 'unavailable' then raise exception 'Caso 2: enlace revocado acepta después'; end if;
 raise notice 'carrera 2: responder antes → se guarda; la revocación espera y luego invalida';
end $$;

-- ===== Caso 3: dos pestañas a la vez → se serializan; manda la última confirmada.
select dblink_exec('rsvp', 'begin');
select * from dblink('rsvp', $q$select public.guest_rsvp_respond('rsvp-carrera', repeat('3',64), 'si', 4, 'pestaña 1')$q$) as t(r text);
select dblink_send_query('rev', $q$select public.guest_rsvp_respond('rsvp-carrera', repeat('3',64), 'no', 0, 'pestaña 2')$q$);
select pg_temp.wait_blocked('rev', 'guest_rsvp_respond');
select dblink_exec('rsvp', 'commit');
create temp table caso3 as select * from dblink_get_result('rev') as t(r text);
select * from dblink_get_result('rev') as t(r text);
do $$ begin
 if (select r from caso3) is distinct from 'ok' then raise exception 'Caso 3: segunda pestaña rechazada'; end if;
 if (select rsvp_status || '/' || rsvp_companions || '/' || rsvp_notes from public.wedding_guests where id='5c000000-0000-4000-8000-000000000001') <> 'no/0/pestaña 2' then raise exception 'Caso 3: no manda la última respuesta'; end if;
 raise notice 'carrera 3: dos pestañas → serializadas, last-write-wins';
end $$;

select dblink_disconnect('rev');
select dblink_disconnect('rsvp');
delete from public.weddings where id = '5ccccccc-cccc-4ccc-8ccc-cccccccccccc';
delete from auth.users where id = '53333333-3333-4333-8333-333333333333';
delete from public.rate_limit_hits where bucket_key = 'rsvp-wedding:' || encode(sha256(convert_to('5ccccccc-cccc-4ccc-8ccc-cccccccccccc','UTF8')),'hex');
drop extension dblink;
