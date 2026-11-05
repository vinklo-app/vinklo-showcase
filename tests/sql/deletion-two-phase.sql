-- Borrado en dos fases (20261030110000, P2-5) y copia del borrador del
-- creador que no pisa una más reciente (P2-4).
--   * wedding_mark_deleted: solo la dueña; idempotente; la boda deja de
--     verse en el panel (RLS), en las vistas públicas y en los enlaces de
--     invitado; apunta la purga con sus proveedores; la otra boda intacta.
--   * Con la marca, el DELETE con sesión ya no ve la fila; service_role sí
--     la borra (cascada) y la cola sobrevive.
--   * builder_draft_stash_put: inserta, no pisa con una más antigua, sí con
--     una más nueva o si la guardada caducó; solo service_role.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
begin;
insert into auth.users(id, email) values
 ('d1111111-1111-4111-8111-111111111111','duena-a@ejemplo.es'),
 ('d2222222-2222-4222-8222-222222222222','pareja-a@ejemplo.es'),
 ('d3333333-3333-4333-8333-333333333333','duena-b@ejemplo.es');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('ddddddd1-dddd-4ddd-8ddd-dddddddddddd','marca-a','d1111111-1111-4111-8111-111111111111','Ana','Luis',current_date + 90),
 ('ddddddd2-dddd-4ddd-8ddd-dddddddddddd','marca-b','d3333333-3333-4333-8333-333333333333','Lucía','Juan',current_date + 90);
insert into public.vendors(id,wedding_id,name,email,category) values
 ('d0000000-0000-4000-8000-0000000000a1','ddddddd1-dddd-4ddd-8ddd-dddddddddddd','Fotos','f@ejemplo.es','foto');

do $$
declare w uuid; i int := 0;
begin
 foreach w in array array['ddddddd1-dddd-4ddd-8ddd-dddddddddddd','ddddddd2-dddd-4ddd-8ddd-dddddddddddd']::uuid[] loop
  i := i + 1;
  insert into public.wedding_guests(id,wedding_id,name,phone) values (gen_random_uuid(), w, 'Invitado', '+34600000000');
  insert into public.wedding_guest_tokens(guest_id,wedding_id,token_hash)
    select g.id, g.wedding_id, repeat(i::text, 64) from public.wedding_guests g where g.wedding_id = w;
  insert into public.wedding_agenda_items(wedding_id,title,time_label) values (w,'Ceremonia','12:00');
  -- Retirada (published_at con unpublished_at): la vista la sirve igual, sin revisión.
  insert into public.wedding_sites(wedding_id,draft_document,draft_version,published_at,unpublished_at) values (w,'{"schemaVersion":1}'::jsonb,1,now(),now());
  insert into public.wedding_member_invites(wedding_id,email,token_hash,expires_at)
   values (w, 'invitada-' || i || '@ejemplo.es', repeat(chr(96 + i), 64), now() + interval '7 days');
 end loop;
end $$;

-- La pareja de A entra después de las invitaciones (el guard rechaza invitar con la boda llena).
insert into public.wedding_members(wedding_id,user_id,role) values
 ('ddddddd1-dddd-4ddd-8ddd-dddddddddddd','d2222222-2222-4222-8222-222222222222','partner');

-- ------------------------------------------------------------ privilegios
do $$ begin
 if has_function_privilege('anon','public.wedding_mark_deleted(uuid)','execute') then raise exception 'anon marca bodas'; end if;
 if not has_function_privilege('authenticated','public.wedding_mark_deleted(uuid)','execute') then raise exception 'authenticated sin wedding_mark_deleted'; end if;
 if has_function_privilege('anon','public.builder_draft_stash_put(text,jsonb,timestamptz,timestamptz)','execute')
    or has_function_privilege('authenticated','public.builder_draft_stash_put(text,jsonb,timestamptz,timestamptz)','execute')
   then raise exception 'stash ejecutable fuera de service_role'; end if;
 if has_table_privilege('authenticated','public.pending_deletions','select') or has_table_privilege('anon','public.pending_deletions','select')
   then raise exception 'pending_deletions legible por clientes'; end if;
 if has_column_privilege('authenticated','public.weddings','deleted_at','update') then raise exception 'authenticated escribe deleted_at'; end if;
end $$;

-- ------------------------------------------------------------ solo la dueña marca
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', true);
do $$ begin
 if public.wedding_mark_deleted('ddddddd1-dddd-4ddd-8ddd-dddddddddddd') <> 'forbidden' then raise exception 'la pareja secundaria marcó A'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'd3333333-3333-4333-8333-333333333333', true);
do $$ begin
 if public.wedding_mark_deleted('ddddddd1-dddd-4ddd-8ddd-dddddddddddd') <> 'forbidden' then raise exception 'la dueña de B marcó A'; end if;
 if public.wedding_mark_deleted(gen_random_uuid()) <> 'not_found' then raise exception 'boda inexistente'; end if;
end $$;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
 if public.wedding_mark_deleted('ddddddd1-dddd-4ddd-8ddd-dddddddddddd') <> 'unauthenticated' then raise exception 'sin sesión'; end if;
end $$;
reset role;
do $$ begin
 if (select deleted_at from public.weddings where id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') is not null then raise exception 'A marcada sin permiso'; end if;
 if exists (select 1 from public.pending_deletions) then raise exception 'cola con intentos sin permiso'; end if;
end $$;

-- ------------------------------------------------------------ la dueña marca A (dos veces)
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
do $$ begin
 if public.wedding_mark_deleted('ddddddd1-dddd-4ddd-8ddd-dddddddddddd') <> 'ok' then raise exception 'la dueña no pudo marcar A'; end if;
end $$;
reset role;
create temp table marked as select deleted_at from public.weddings where id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd';
grant select on marked to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
do $$ begin
 if public.wedding_mark_deleted('ddddddd1-dddd-4ddd-8ddd-dddddddddddd') <> 'ok' then raise exception 'segunda marca no idempotente'; end if;
 -- Panel: la dueña ya no ve su boda ni sus invitados, ni puede editarla.
 if exists (select 1 from public.weddings) then raise exception 'la dueña sigue viendo A'; end if;
 if exists (select 1 from public.wedding_guests) then raise exception 'la dueña sigue viendo invitados de A'; end if;
 update public.weddings set partner_name_1 = 'Otra' where id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd';
 if found then raise exception 'la dueña editó A marcada'; end if;
 -- Con la marca, el DELETE con sesión no encuentra la fila (el código borra con service_role).
 delete from public.weddings where id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd';
 if found then raise exception 'delete con sesión vio la fila marcada'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', true);
do $$ begin
 if exists (select 1 from public.weddings) then raise exception 'la pareja sigue viendo A'; end if;
end $$;
-- B sigue viéndose y editándose con normalidad.
select set_config('request.jwt.claim.sub', 'd3333333-3333-4333-8333-333333333333', true);
do $$ begin
 if (select count(*) from public.weddings) <> 1 then raise exception 'la dueña de B no ve B'; end if;
 if (select count(*) from public.wedding_guests) <> 1 then raise exception 'la dueña de B no ve sus invitados'; end if;
 update public.weddings set partner_name_1 = 'Lucía M' where id = 'ddddddd2-dddd-4ddd-8ddd-dddddddddddd';
 if not found then raise exception 'la dueña de B no puede editar B'; end if;
end $$;
reset role;

do $$
declare q public.pending_deletions;
begin
 if (select deleted_at from public.weddings where id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') is distinct from (select deleted_at from marked)
   then raise exception 'la segunda marca cambió la fecha'; end if;
 select * into q from public.pending_deletions where kind = 'wedding' and target_id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd';
 if not found then raise exception 'A sin purga apuntada'; end if;
 if q.vendor_ids <> array['d0000000-0000-4000-8000-0000000000a1']::uuid[] then raise exception 'proveedores de A: %', q.vendor_ids; end if;
 if (select count(*) from public.pending_deletions) <> 1 then raise exception 'cola duplicada'; end if;
 -- A: enlaces revocados, invitaciones pendientes y membresías fuera. B intacta.
 if exists (select 1 from public.wedding_guest_tokens where wedding_id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd' and revoked_at is null) then raise exception 'enlaces de A vivos'; end if;
 if exists (select 1 from public.wedding_member_invites where wedding_id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') then raise exception 'invitaciones de A vivas'; end if;
 if exists (select 1 from public.wedding_members where wedding_id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') then raise exception 'miembros de A'; end if;
 if exists (select 1 from public.wedding_guest_tokens where wedding_id = 'ddddddd2-dddd-4ddd-8ddd-dddddddddddd' and revoked_at is not null) then raise exception 'enlaces de B revocados'; end if;
 if (select count(*) from public.wedding_member_invites where wedding_id = 'ddddddd2-dddd-4ddd-8ddd-dddddddddddd') <> 1 then raise exception 'invitación de B tocada'; end if;
 if (select count(*) from public.wedding_members where wedding_id = 'ddddddd2-dddd-4ddd-8ddd-dddddddddddd') <> 1 then raise exception 'miembros de B tocados'; end if;
 -- El resto de A sigue hasta la fase 2 (nada borrado a medias).
 if (select count(*) from public.wedding_guests where wedding_id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') <> 1 then raise exception 'invitados de A borrados en la marca'; end if;
end $$;

-- ------------------------------------------------------------ lecturas públicas (service_role)
set local role service_role;
do $$ begin
 if exists (select 1 from public.weddings_public where slug = 'marca-a') then raise exception 'weddings_public sirve A'; end if;
 if exists (select 1 from public.wedding_agenda_public where slug = 'marca-a') then raise exception 'agenda pública sirve A'; end if;
 if exists (select 1 from public.wedding_sites_public where slug = 'marca-a') then raise exception 'web pública sirve A'; end if;
 if not exists (select 1 from public.weddings_public where slug = 'marca-b') then raise exception 'weddings_public no sirve B'; end if;
 if not exists (select 1 from public.wedding_agenda_public where slug = 'marca-b') then raise exception 'agenda pública no sirve B'; end if;
 if not exists (select 1 from public.wedding_sites_public where slug = 'marca-b') then raise exception 'web pública no sirve B'; end if;
 -- Enlaces personales de invitado.
 if public.guest_invitation_opened('marca-a', repeat('1',64), null) <> 'unavailable' then raise exception 'enlace de A abre'; end if;
 if public.guest_invitation_opened('marca-b', repeat('2',64), null) = 'unavailable' then raise exception 'enlace de B no abre'; end if;
 if public.guest_rsvp_respond('marca-a', repeat('1',64), 'si', 0, null::text) <> 'unavailable' then raise exception 'A acepta respuestas'; end if;
 if public.guest_rsvp_respond('marca-b', repeat('2',64), 'si', 0, null::text) = 'unavailable' then raise exception 'B no acepta respuestas'; end if;
 if public.guest_rsvp_current('marca-a', repeat('1',64)) is not null then raise exception 'A devuelve la respuesta anterior'; end if;
 if public.guest_rsvp_current('marca-b', repeat('2',64)) is null then raise exception 'B no devuelve su respuesta'; end if;
 -- Sin aviso de retención para A (aunque su fecha lo pidiera).
 if exists (select 1 from public.retention_notice_candidates(current_date + 90 + 400, 1000) where wedding_id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') then raise exception 'aviso de retención para A'; end if;
 if not exists (select 1 from public.retention_notice_candidates(current_date + 90 + 400, 1000) where wedding_id = 'ddddddd2-dddd-4ddd-8ddd-dddddddddddd') then raise exception 'B sin aviso de retención'; end if;
end $$;

-- ------------------------------------------------------------ fase 2: service_role borra la fila
delete from public.weddings where id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd' and deleted_at is not null;
reset role;
do $$ begin
 if exists (select 1 from public.weddings where id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') then raise exception 'A no se borró'; end if;
 if exists (select 1 from public.wedding_guests where wedding_id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') then raise exception 'invitados de A tras la cascada'; end if;
 if exists (select 1 from public.vendors where wedding_id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') then raise exception 'proveedores de A tras la cascada'; end if;
 -- La cola sobrevive a la cascada (Storage se vacía después).
 if not exists (select 1 from public.pending_deletions where target_id = 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd') then raise exception 'la cola cayó con la boda'; end if;
 if (select count(*) from public.wedding_guests where wedding_id = 'ddddddd2-dddd-4ddd-8ddd-dddddddddddd') <> 1 then raise exception 'B tocada'; end if;
end $$;
-- Tras la fase 2, la dueña puede volver a crear una boda.
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2) values
 ('ddddddd3-dddd-4ddd-8ddd-dddddddddddd','marca-nueva','d1111111-1111-4111-8111-111111111111','Ana','Luis');

-- ------------------------------------------------------------ P2-4: stash
set local role service_role;
do $$
declare t0 timestamptz := now() - interval '2 hours';
begin
 if not public.builder_draft_stash_put('ana@ejemplo.es', '{"v":"b"}', t0 + interval '1 hour', now() + interval '7 days') then raise exception 'no insertó'; end if;
 -- Más antigua (el otro navegador): no pisa.
 if public.builder_draft_stash_put('ana@ejemplo.es', '{"v":"a"}', t0, now() + interval '7 days') then raise exception 'una más antigua pisó'; end if;
 if (select draft->>'v' from public.builder_draft_stash where email = 'ana@ejemplo.es') <> 'b' then raise exception 'se perdió la más nueva'; end if;
 -- Más nueva: pisa.
 if not public.builder_draft_stash_put('ana@ejemplo.es', '{"v":"c"}', t0 + interval '90 minutes', now() + interval '7 days') then raise exception 'una más nueva no pisó'; end if;
 if (select draft->>'v' from public.builder_draft_stash where email = 'ana@ejemplo.es') <> 'c' then raise exception 'no quedó la más nueva'; end if;
 -- Fecha futura se recorta a ahora; sin fecha cuenta como ahora.
 if not public.builder_draft_stash_put('eva@ejemplo.es', '{"v":"x"}', now() + interval '10 days', now() + interval '7 days') then raise exception 'futuro'; end if;
 if (select updated_at from public.builder_draft_stash where email = 'eva@ejemplo.es') > now() then raise exception 'fecha futura sin recortar'; end if;
 if not public.builder_draft_stash_put('eva@ejemplo.es', '{"v":"y"}', null, now() + interval '7 days') then raise exception 'sin fecha no pisa (igual a ahora)'; end if;
 -- Caducada: se pisa aunque la nueva sea más antigua.
 update public.builder_draft_stash set expires_at = now() - interval '1 minute' where email = 'ana@ejemplo.es';
 if not public.builder_draft_stash_put('ana@ejemplo.es', '{"v":"d"}', t0 - interval '1 day', now() + interval '7 days') then raise exception 'no pisó una caducada'; end if;
 if (select draft->>'v' from public.builder_draft_stash where email = 'ana@ejemplo.es') <> 'd' then raise exception 'caducada no sustituida'; end if;
end $$;
reset role;

do $$ begin raise notice 'deletion-two-phase: marca idempotente solo de la dueña, nada se sirve tras marcar, cascada con service_role y cola viva; stash sin pisar uno más nuevo'; end $$;
rollback;
