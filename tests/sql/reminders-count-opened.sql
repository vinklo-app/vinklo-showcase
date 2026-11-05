-- Recordatorios con la apertura como entrega y las reglas de TS
-- (20261101120000, revisión del bloque 1 F3/F10). Base DE PRUEBAS vacía con
-- todas las migraciones. Dos parejas; todo se revierte.
begin;
insert into auth.users(id) values ('a1111111-1111-4111-8111-111111111111'), ('a2222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','rec-abierta-a','a1111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 60),
 ('bbbb0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb','rec-abierta-b','a2222222-2222-4222-8222-222222222222','Eva','Pau',current_date + 60);
insert into public.wedding_guests(id,wedding_id,name,phone,rsvp_status,invitation_sent_at,invitation_opened_at,last_reminder_at,reminders_opt_out) values
 -- Enviada hace 5 días: toca.
 ('a0000000-0000-4000-8000-000000000001','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Envio viejo','612345671','pendiente',now() - interval '5 days',null,null,false),
 -- Sin envío confirmado, abrió hace 4 días: toca (entrega deducida).
 ('a0000000-0000-4000-8000-000000000002','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Abrio','612345672','pendiente',null,now() - interval '4 days',null,false),
 -- Enviada ayer: aún no (margen de 3 días tras la entrega).
 ('a0000000-0000-4000-8000-000000000003','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Envio reciente','612345673','pendiente',now() - interval '1 day',null,null,false),
 -- Abrió ayer sin envío: aún no.
 ('a0000000-0000-4000-8000-000000000004','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Abrio ayer','612345674','pendiente',null,now() - interval '1 day',null,false),
 -- Recordada hace 2 días: no (3 días entre recordatorios).
 ('a0000000-0000-4000-8000-000000000005','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Recordada','612345675','pendiente',now() - interval '9 days',null,now() - interval '2 days',false),
 -- Recordada hace 4 días: toca.
 ('a0000000-0000-4000-8000-000000000006','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Recordada antes','612345676','pendiente',now() - interval '9 days',null,now() - interval '4 days',false),
 -- Ni enviada ni abierta, ya respondió, o pidió no recibirlos: nunca.
 ('a0000000-0000-4000-8000-000000000007','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sin enviar','612345677','pendiente',null,null,null,false),
 ('a0000000-0000-4000-8000-000000000008','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Respondio','612345678','si',now() - interval '9 days',now() - interval '8 days',null,false),
 ('a0000000-0000-4000-8000-000000000009','aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','No molestar','612345679','pendiente',now() - interval '9 days',null,null,true),
 -- Otra boda: nunca visible para A.
 ('b0000000-0000-4000-8000-000000000001','bbbb0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb','De B','612345670','pendiente',null,now() - interval '9 days',null,false);

-- Permisos del nuevo helper (como guest_in_filter).
do $$ begin
  if has_function_privilege('anon','public.reminder_window_state(date,date)','execute') then raise exception 'reminder_window_state ejecutable por anon'; end if;
  if not has_function_privilege('authenticated','public.reminder_window_state(date,date)','execute') then raise exception 'authenticated sin reminder_window_state'; end if;
  if has_function_privilege('anon','public.reminder_queue(uuid,integer,text,text)','execute') then raise exception 'reminder_queue ejecutable por anon'; end if;
  if (select count(*) from pg_proc where proname = 'reminder_queue') <> 1 then raise exception 'más de una reminder_queue'; end if;
  -- Reglas del plazo (Madrid): sin fechas abierto; fecha límite en 3 días = soon; ayer = closed; boda anteayer = closed.
  if public.reminder_window_state(null, null) <> 'open' then raise exception 'sin fechas'; end if;
  if public.reminder_window_state(null, (now() at time zone 'Europe/Madrid')::date + 3) <> 'soon' then raise exception 'soon 3'; end if;
  if public.reminder_window_state(null, (now() at time zone 'Europe/Madrid')::date + 4) <> 'open' then raise exception 'open 4'; end if;
  if public.reminder_window_state(null, (now() at time zone 'Europe/Madrid')::date) <> 'soon' then raise exception 'hoy = soon'; end if;
  if public.reminder_window_state(null, (now() at time zone 'Europe/Madrid')::date - 1) <> 'closed' then raise exception 'ayer = closed'; end if;
  if public.reminder_window_state((now() at time zone 'Europe/Madrid')::date - 1, null) <> 'open' then raise exception 'boda ayer = abierta (día siguiente)'; end if;
  if public.reminder_window_state((now() at time zone 'Europe/Madrid')::date - 2, null) <> 'closed' then raise exception 'boda anteayer = closed'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $$ declare ids text; n int; c record; f record; q record; begin
  -- (a) Plazo abierto sin fecha límite: envío viejo, apertura de hace 4 días y recordada hace 4 días.
  select string_agg(name, ',' order by name) into ids from public.reminder_queue('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if ids is distinct from 'Abrio,Envio viejo,Recordada antes' then raise exception 'cola abierta: %', ids; end if;
  -- La apertura sale como entrega (no NULL) y marcada como «opened».
  select * into q from public.reminder_queue('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where id = 'a0000000-0000-4000-8000-000000000002';
  if q.delivered_by <> 'opened' or q.invitation_sent_at is null then raise exception 'apertura mal devuelta: %', row_to_json(q); end if;
  select * into q from public.reminder_queue('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where id = 'a0000000-0000-4000-8000-000000000001';
  if q.delivered_by <> 'sent' then raise exception 'envío mal devuelto: %', row_to_json(q); end if;
  -- Orden: quien menos recientemente se contactó (envío viejo -5d, apertura -4d, recordatorio -4d → id).
  select string_agg(name, ',') into ids from public.reminder_queue('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if ids not like 'Envio viejo,%' then raise exception 'orden: %', ids; end if;
  -- Chip, embudo y cola cuadran.
  select * into c from public.guest_filter_counts('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  select * into f from public.crm_funnel_summary('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  select max(total_count) into n from public.reminder_queue('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if c.para_recordar <> 3 or f.to_remind <> 3 or n <> 3 then raise exception 'recuentos: chip %, embudo %, cola %', c.para_recordar, f.to_remind, n; end if;
  -- Sin fugas entre bodas.
  select count(*) into n from public.reminder_queue('bbbb0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if n <> 0 then raise exception 'fuga entre bodas: %', n; end if;
end $$;
reset role;

-- (b) Fecha límite en 2 días: el margen tras la entrega no aplica (sí el de 3 días entre recordatorios).
update public.weddings set rsvp_deadline = (now() at time zone 'Europe/Madrid')::date + 2 where id = 'aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $$ declare ids text; begin
  select string_agg(name, ',' order by name) into ids from public.reminder_queue('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if ids is distinct from 'Abrio,Abrio ayer,Envio reciente,Envio viejo,Recordada antes' then raise exception 'plazo inminente: %', ids; end if;
end $$;
reset role;

-- (c) Plazo cerrado (fecha límite ayer): nadie, en la cola ni en los recuentos.
update public.weddings set rsvp_deadline = null, wedding_date = (now() at time zone 'Europe/Madrid')::date - 3 where id = 'aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $$ declare n int; c record; begin
  select count(*) into n from public.reminder_queue('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  select * into c from public.guest_filter_counts('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if n <> 0 or c.para_recordar <> 0 then raise exception 'plazo cerrado: cola %, chip %', n, c.para_recordar; end if;
end $$;
reset role;
update public.weddings set wedding_date = current_date + 60 where id = 'aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- (d) Recordar a quien solo abrió: el enlace y la confirmación funcionan y
--     NADIE escribe invitation_sent_at (la ficha no miente).
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $$ declare t uuid; r record; begin
  select token_id into t from public.issue_guest_token('a0000000-0000-4000-8000-000000000002', repeat('d',64), 'reminder');
  if t is null then raise exception 'enlace de recordatorio negado a quien abrió'; end if;
  select * into r from public.confirm_guest_reminder('a0000000-0000-4000-8000-000000000002');
  if r.reminder_count is distinct from 1 or r.last_reminder_at is null then raise exception 'confirmación negada a quien abrió: %', row_to_json(r); end if;
  -- Sin envío ni apertura: ni enlace de recordatorio ni confirmación.
  select token_id into t from public.issue_guest_token('a0000000-0000-4000-8000-000000000007', repeat('e',64), 'reminder');
  if t is not null then raise exception 'enlace de recordatorio a quien no la recibió'; end if;
  select * into r from public.confirm_guest_reminder('a0000000-0000-4000-8000-000000000007');
  if r.reminder_count is not null then raise exception 'confirmó a quien no la recibió'; end if;
  -- De otra boda: nada.
  select token_id into t from public.issue_guest_token('b0000000-0000-4000-8000-000000000001', repeat('f',64), 'reminder');
  if t is not null then raise exception 'enlace en boda ajena'; end if;
end $$;
reset role;
do $$ begin
  if (select invitation_sent_at from public.wedding_guests where id = 'a0000000-0000-4000-8000-000000000002') is not null then
    raise exception 'se escribió el envío a partir de la apertura'; end if;
end $$;
rollback;
