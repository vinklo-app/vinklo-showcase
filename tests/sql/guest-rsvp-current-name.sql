-- Saludo por nombre (20261101130000, ítem 11): guest_rsvp_current devuelve el
-- nombre de la ficha del PROPIO titular del token (pendiente o con respuesta),
-- nunca nombres de acompañantes ni de otros invitados, y nada con el plazo
-- cerrado ni con un enlace no válido. Permisos sin cambios.
-- Solo una base DE PRUEBAS vacía con todas las migraciones; ROLLBACK al final.
begin;
insert into auth.users(id) values ('81111111-1111-4111-8111-111111111111'), ('82222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','nombre-a','81111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 60),
 ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','nombre-b','82222222-2222-4222-8222-222222222222','Eva','Pau',current_date + 60);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status) values
 ('8a000000-0000-4000-8000-000000000001','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','  Carmen Ruiz Pardo ','pendiente'),
 ('8a000000-0000-4000-8000-000000000002','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tío Paco','pendiente'),
 ('8b000000-0000-4000-8000-000000000001','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Invitada de B','pendiente');
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash,revoked_at) values
 ('8a000000-0000-4000-8000-000000000001','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64),null),
 ('8a000000-0000-4000-8000-000000000002','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('b',64),null),
 ('8b000000-0000-4000-8000-000000000001','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('c',64),null);

-- (a) Permisos intactos: solo service_role, definer, search_path vacío.
do $$ begin
 if has_function_privilege('anon', 'public.guest_rsvp_current(text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.guest_rsvp_current(text,text)', 'execute') then
   raise exception 'guest_rsvp_current ejecutable fuera de service_role'; end if;
 if not (select prosecdef from pg_proc where oid = 'public.guest_rsvp_current(text,text)'::regprocedure) then raise exception 'no es definer'; end if;
 if not exists (select 1 from pg_proc where oid = 'public.guest_rsvp_current(text,text)'::regprocedure and proconfig @> array['search_path=""']) then
   raise exception 'sin search_path'; end if;
end $$;

set local role service_role;
do $$ declare j jsonb; begin
 -- (b) Pendiente: su nombre (recortado), sin respuesta.
 j := public.guest_rsvp_current('nombre-a', repeat('a',64));
 if j->>'guest_name' is distinct from 'Carmen Ruiz Pardo' or j->'status' <> 'null'::jsonb then raise exception 'pendiente sin nombre: %', j; end if;
 if j::text like '%Paco%' then raise exception 'nombre de otro invitado: %', j; end if;

 -- (c) Con respuesta y acompañantes con nombre: su nombre, nunca los de sus acompañantes.
 if public.guest_rsvp_respond('nombre-a', repeat('a',64), 'si', 1, '', null, null, null, '[{"name":"Leocadia","kid":false}]'::jsonb, false) <> 'ok' then
   raise exception 'respuesta rechazada'; end if;
 j := public.guest_rsvp_current('nombre-a', repeat('a',64));
 if j->>'guest_name' is distinct from 'Carmen Ruiz Pardo' or j->>'status' <> 'si' then raise exception 'respondida sin nombre: %', j; end if;
 if j::text like '%Leocadia%' then raise exception 'nombre de acompañante filtrado: %', j; end if;

 -- (d) Cada token, solo el suyo; entre bodas, nada.
 if public.guest_rsvp_current('nombre-a', repeat('b',64))->>'guest_name' is distinct from 'Tío Paco' then raise exception 'token b mal'; end if;
 if public.guest_rsvp_current('nombre-a', repeat('c',64)) is not null then raise exception 'token de B leyó en A'; end if;
end $$;
reset role;

-- (e) Revocado: NULL (sin nombre).
update public.wedding_guest_tokens set revoked_at = now() where token_hash = repeat('b',64);
-- (f) Plazo cerrado: {"closed": true} y nada más (tampoco el nombre).
update public.weddings set rsvp_deadline = current_date - 1 where id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$ declare j jsonb; begin
 if public.guest_rsvp_current('nombre-a', repeat('b',64)) is not null then raise exception 'revocado leyó'; end if;
 j := public.guest_rsvp_current('nombre-a', repeat('a',64));
 if j is distinct from '{"closed": true}'::jsonb then raise exception 'cerrado devolvió de más: %', j; end if;
end $$;
reset role;
rollback;
