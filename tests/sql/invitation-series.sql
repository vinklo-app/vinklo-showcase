-- Envío en serie (20261022100000): modo 'invite' de issue_guest_token.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('c1111111-1111-4111-8111-111111111111'), ('c2222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','serie-pareja-a','c1111111-1111-4111-8111-111111111111','Ana','Luis','2027-06-12'),
 ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','serie-pareja-b','c2222222-2222-4222-8222-222222222222','Lucia','Juan',null);
insert into public.wedding_guests(id,wedding_id,name,phone,rsvp_status,invitation_prepared_at,invitation_sent_at) values
 ('ca000000-0000-4000-8000-000000000001','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sin enlace','612000001','pendiente',null,null),
 ('ca000000-0000-4000-8000-000000000002','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Preparada','612000002','pendiente',now()-interval '2 days',null),
 ('ca000000-0000-4000-8000-000000000003','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Enviada','612000003','pendiente',now()-interval '5 days',now()-interval '4 days'),
 ('cb000000-0000-4000-8000-000000000001','cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Otra pareja','612999999','pendiente',null,null);
-- Enlace previo de «Preparada» (creado desde la lista, quizá ya enviado).
insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash) values
 ('ca000000-0000-4000-8000-000000000002','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64));
update public.wedding_guests set invitation_token_hash = repeat('a',64) where id = 'ca000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
do $$
declare v_prepared timestamptz;
begin
 -- Sin enlace: 'invite' prepara la invitación y no la marca como enviada.
 if (select count(*) from public.issue_guest_token('ca000000-0000-4000-8000-000000000001', repeat('1',64), 'invite')) <> 1 then raise exception 'invite no emitió'; end if;
 if exists(select 1 from public.wedding_guests where id='ca000000-0000-4000-8000-000000000001' and (invitation_prepared_at is null or invitation_sent_at is not null)) then raise exception 'Estado tras invite incorrecto'; end if;
 -- Abrir WhatsApp otra vez (p. ej. tras recargar en iOS): otro enlace, sin revocar el primero.
 if (select count(*) from public.issue_guest_token('ca000000-0000-4000-8000-000000000001', repeat('2',64), 'invite')) <> 1 then raise exception 'Segundo invite no emitió'; end if;
 -- Preparada sin confirmar: conserva su fecha de preparación.
 select invitation_prepared_at into v_prepared from public.wedding_guests where id='ca000000-0000-4000-8000-000000000002';
 if (select count(*) from public.issue_guest_token('ca000000-0000-4000-8000-000000000002', repeat('3',64), 'invite')) <> 1 then raise exception 'invite sobre preparada no emitió'; end if;
 if (select invitation_prepared_at from public.wedding_guests where id='ca000000-0000-4000-8000-000000000002') is distinct from v_prepared then raise exception 'invite movió la fecha de preparación'; end if;
 -- Con el envío confirmado: para eso está 'reminder'.
 if exists(select 1 from public.issue_guest_token('ca000000-0000-4000-8000-000000000003', repeat('4',64), 'invite')) then raise exception 'invite emitido con la invitación ya enviada'; end if;
 -- Boda ajena: nada.
 if exists(select 1 from public.issue_guest_token('cb000000-0000-4000-8000-000000000001', repeat('5',64), 'invite')) then raise exception 'invite en boda ajena'; end if;
 -- Modos de siempre: siguen rechazando lo desconocido.
 if exists(select 1 from public.issue_guest_token('ca000000-0000-4000-8000-000000000001', repeat('6',64), 'otro')) then raise exception 'Modo inválido aceptado'; end if;
end $$;

-- La otra pareja no emite para A.
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select 1 from public.issue_guest_token('ca000000-0000-4000-8000-000000000001', repeat('7',64), 'invite')) then raise exception 'B emitió invite para A'; end if;
end $$;

-- Confirmar el envío (lo que hace confirmInvitationSent) funciona tras 'invite'.
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
do $$ begin
 update public.wedding_guests set invitation_sent_at = now()
  where id='ca000000-0000-4000-8000-000000000001' and wedding_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and invitation_prepared_at is not null;
 if not found then raise exception 'No se pudo confirmar el envío tras invite'; end if;
end $$;

reset role;
do $$ begin
 -- Ningún enlace revocado: todos siguen abriendo la invitación.
 if exists(select 1 from public.wedding_guest_tokens where wedding_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and revoked_at is not null) then raise exception 'invite revocó enlaces'; end if;
 if (select count(*) from public.wedding_guest_tokens where guest_id='ca000000-0000-4000-8000-000000000001' and revoked_at is null) <> 2 then raise exception 'Deben quedar los dos enlaces de Sin enlace'; end if;
 if (select count(*) from public.wedding_guest_tokens where guest_id='ca000000-0000-4000-8000-000000000002' and revoked_at is null) <> 2 then raise exception 'El enlace previo de Preparada debe seguir activo'; end if;
 -- Compatibilidad: invitation_token_hash se rellena si estaba vacío y no se pisa si ya había.
 if (select invitation_token_hash from public.wedding_guests where id='ca000000-0000-4000-8000-000000000001') <> repeat('1',64) then raise exception 'Hash de compatibilidad no rellenado'; end if;
 if (select invitation_token_hash from public.wedding_guests where id='ca000000-0000-4000-8000-000000000002') <> repeat('a',64) then raise exception 'Hash de compatibilidad pisado'; end if;
 -- Una sola sobrecarga y sin acceso anónimo.
 if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'issue_guest_token') <> 1 then raise exception 'Más de una sobrecarga de issue_guest_token'; end if;
 if has_function_privilege('anon','public.issue_guest_token(uuid,text,text)','execute') then raise exception 'Emisión expuesta a anon'; end if;
end $$;
rollback;
