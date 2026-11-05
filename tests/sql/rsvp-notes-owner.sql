-- Autoría de la nota (20261021120000): el invitado nunca ve los apuntes que
-- la pareja escribe en rsvp_notes, y responder sin nota no los borra.
-- Solo una base DE PRUEBAS vacía con todas las migraciones; ROLLBACK al final.
begin;
insert into auth.users(id) values ('73333333-3333-4333-8333-333333333333');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('7ccccccc-cccc-4ccc-8ccc-cccccccccccc','notas-pareja-c','73333333-3333-4333-8333-333333333333','Eva','Leo',current_date + 60);
insert into public.wedding_guests(id,wedding_id,name,rsvp_status,rsvp_notes) values
 ('7c000000-0000-4000-8000-000000000001','7ccccccc-cccc-4ccc-8ccc-cccccccccccc','Primo','si','No sentar con su ex');
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash,revoked_at) values
 ('7c000000-0000-4000-8000-000000000001','7ccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('4',64),null);

set local role service_role;
do $$ declare j jsonb; n text; begin
 -- Nota de la pareja: el invitado no la ve.
 j := public.guest_rsvp_current('notas-pareja-c', repeat('4',64));
 if j is null or j->>'status' <> 'si' then raise exception 'Respuesta no devuelta: %', j; end if;
 if j ? 'notes' or (j->>'has_health_note')::boolean then raise exception 'El invitado vio la nota de la pareja: %', j; end if;

 -- Responde sin nota: la de la pareja se queda.
 if public.guest_rsvp_respond('notas-pareja-c', repeat('4',64), 'si', 1, null, null) <> 'ok' then raise exception 'Respuesta rechazada'; end if;
 select rsvp_notes into n from public.wedding_guests where id = '7c000000-0000-4000-8000-000000000001';
 if n is distinct from 'No sentar con su ex' then raise exception 'Se borró la nota de la pareja: %', n; end if;

 -- Escribe su alergia: ahora la nota es suya y la ve al volver.
 if public.guest_rsvp_respond('notas-pareja-c', repeat('4',64), 'si', 1, 'Celíaco', null) <> 'ok' then raise exception 'Respuesta con nota rechazada'; end if;
 j := public.guest_rsvp_current('notas-pareja-c', repeat('4',64));
 -- 20261101110000 (paso 2): sabe que la tiene, pero sin el texto.
 if j ? 'notes' or (j->>'has_health_note')::boolean is not true then raise exception 'El invitado no sabe de su propia nota: %', j; end if;

 -- La deja en blanco sin «conservar» (la de 10): se borra (era suya).
 if public.guest_rsvp_respond('notas-pareja-c', repeat('4',64), 'si', 1, '  ', null, null, null, null, false) <> 'ok' then raise exception 'Respuesta en blanco rechazada'; end if;
 select rsvp_notes into n from public.wedding_guests where id = '7c000000-0000-4000-8000-000000000001';
 if n is not null then raise exception 'No se borró la nota del invitado: %', n; end if;
end $$;
reset role;

-- La pareja reescribe la nota (fuera de la RPC): vuelve a ser privada.
do $$ declare j jsonb; begin
 update public.wedding_guests set rsvp_notes = 'Celíaco' where id = '7c000000-0000-4000-8000-000000000001';
 update public.wedding_guests set rsvp_notes = 'Celíaco · llamar antes' where id = '7c000000-0000-4000-8000-000000000001';
 if (select rsvp_notes_by_guest from public.wedding_guests where id = '7c000000-0000-4000-8000-000000000001') then
   raise exception 'Una edición de la pareja quedó como del invitado';
 end if;
 set local role service_role;
 j := public.guest_rsvp_current('notas-pareja-c', repeat('4',64));
 if j ? 'notes' or (j->>'has_health_note')::boolean then raise exception 'El invitado vio la nota editada por la pareja: %', j; end if;
 reset role;
end $$;
rollback;
