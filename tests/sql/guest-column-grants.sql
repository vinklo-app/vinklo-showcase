-- Permisos por columna en wedding_guests (20261025100000, plan §5.6): la
-- pareja solo escribe las columnas que la app escribe con su sesión; las del
-- servidor (respuesta del invitado, tokens, autoría de la nota, origen, boda)
-- quedan fuera. RLS sigue acotando a su boda. Dos parejas ficticias en una
-- base DE PRUEBAS vacía con todas las migraciones; ROLLBACK al final.
begin;
insert into auth.users(id) values ('c1111111-1111-4111-8111-111111111111'), ('c2222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','grants-pareja-a','c1111111-1111-4111-8111-111111111111','Lucia','Juan',current_date + 90),
 ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','grants-pareja-b','c2222222-2222-4222-8222-222222222222','Eva','Pau',current_date + 90);
-- La nota del invitado lleva su consentimiento (CHECK de 20261030100000).
insert into public.wedding_guests(id,wedding_id,name,rsvp_status,rsvp_notes,rsvp_notes_by_guest,health_consent_at,health_consent_version,invitation_prepared_at) values
 ('ca000000-0000-4000-8000-000000000001','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ana','si','Celíaca',true,now(),'2026-10',now() - interval '1 day'),
 ('cb000000-0000-4000-8000-000000000001','cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Berta','pendiente',null,false,null,null,null);

-- ------------------------------------------------------------ catálogo
do $$
declare
  allowed_update text[] := array['name','phone','rsvp_status','rsvp_companions','rsvp_notes','updated_at','group_name','tags','side','max_companions','table_id','invitation_sent_at','gift_none','reminders_opt_out','last_reminder_at','reminder_count','extra_fields'];
  denied_update text[] := array['id','wedding_id','source','responded_at','rsvp_key_hash','rsvp_notes_by_guest','rsvp_answers','invitation_token_hash','invitation_prepared_at','invitation_opened_at','created_at','rsvp_logistic_notes','health_consent_at','health_consent_version'];
  allowed_insert text[] := array['wedding_id','source','name','phone','rsvp_status','rsvp_companions','rsvp_notes','updated_at','group_name','tags','side','max_companions','extra_fields'];
  denied_insert text[] := array['id','responded_at','rsvp_key_hash','rsvp_notes_by_guest','rsvp_logistic_notes','health_consent_at','health_consent_version','rsvp_answers','invitation_token_hash','invitation_prepared_at','invitation_sent_at','invitation_opened_at','last_reminder_at','reminder_count'];
  c text;
begin
  if has_table_privilege('authenticated','public.wedding_guests','update') then raise exception 'authenticated conserva UPDATE de tabla'; end if;
  if has_table_privilege('authenticated','public.wedding_guests','insert') then raise exception 'authenticated conserva INSERT de tabla'; end if;
  if not has_table_privilege('authenticated','public.wedding_guests','select')
     or not has_table_privilege('authenticated','public.wedding_guests','delete') then raise exception 'authenticated perdió SELECT/DELETE'; end if;
  if not has_table_privilege('service_role','public.wedding_guests','update')
     or not has_table_privilege('service_role','public.wedding_guests','insert') then raise exception 'service_role perdió escritura'; end if;
  foreach c in array allowed_update loop
    if not has_column_privilege('authenticated','public.wedding_guests',c,'update') then raise exception 'falta UPDATE (%)', c; end if;
  end loop;
  foreach c in array denied_update loop
    if has_column_privilege('authenticated','public.wedding_guests',c,'update') then raise exception 'UPDATE (%) no debería estar concedido', c; end if;
  end loop;
  foreach c in array allowed_insert loop
    if not has_column_privilege('authenticated','public.wedding_guests',c,'insert') then raise exception 'falta INSERT (%)', c; end if;
  end loop;
  foreach c in array denied_insert loop
    if has_column_privilege('authenticated','public.wedding_guests',c,'insert') then raise exception 'INSERT (%) no debería estar concedido', c; end if;
  end loop;
end $$;

-- ------------------------------------------------------------ como la pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
do $$
declare
  n integer;
  r public.wedding_guests%rowtype;
  stmt text;
begin
  -- Lo que escribe la app: todo a la vez, como updateGuest + acciones sueltas.
  update public.wedding_guests set
    name = 'Ana María', phone = '612000001', rsvp_status = 'si', rsvp_companions = 1,
    rsvp_notes = 'Celíaca y vegana', updated_at = now(), group_name = 'Uni', tags = array['Uni'],
    side = 'p1', max_companions = 2, table_id = null, invitation_sent_at = now(), gift_none = true,
    reminders_opt_out = true, last_reminder_at = now(), reminder_count = 1
  where id = 'ca000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'La pareja no pudo editar su invitado (%)', n; end if;

  -- El trigger BEFORE sigue marcando la nota como de la pareja (columna no concedida).
  select * into r from public.wedding_guests where id = 'ca000000-0000-4000-8000-000000000001';
  if r.rsvp_notes_by_guest then raise exception 'La nota editada por la pareja sigue como del invitado'; end if;

  -- Columnas del servidor: 42501.
  foreach stmt in array array[
    'update public.wedding_guests set responded_at = now() where id = ''ca000000-0000-4000-8000-000000000001''',
    'update public.wedding_guests set rsvp_key_hash = ''x'' where id = ''ca000000-0000-4000-8000-000000000001''',
    'update public.wedding_guests set source = ''rsvp'' where id = ''ca000000-0000-4000-8000-000000000001''',
    'update public.wedding_guests set wedding_id = ''cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'' where id = ''ca000000-0000-4000-8000-000000000001''',
    'update public.wedding_guests set rsvp_notes_by_guest = true where id = ''ca000000-0000-4000-8000-000000000001''',
    'update public.wedding_guests set rsvp_answers = ''{}''::jsonb where id = ''ca000000-0000-4000-8000-000000000001''',
    'update public.wedding_guests set invitation_prepared_at = now() where id = ''ca000000-0000-4000-8000-000000000001''',
    'update public.wedding_guests set invitation_token_hash = ''x'' where id = ''ca000000-0000-4000-8000-000000000001''',
    'insert into public.wedding_guests(wedding_id,name,source,rsvp_key_hash) values (''caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''Falso'',''rsvp'',''x'')',
    'insert into public.wedding_guests(wedding_id,name,responded_at) values (''caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''Falso'',now())',
    'insert into public.wedding_guests(wedding_id,name,rsvp_notes,rsvp_notes_by_guest) values (''caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''Falso'',''x'',true)'
  ] loop
    begin
      execute stmt;
      raise exception 'Se permitió: %', stmt;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- Alta como la de addGuest / bulkCreateGuests.
  insert into public.wedding_guests(wedding_id,source,name,phone,rsvp_status,rsvp_companions,rsvp_notes,updated_at,group_name,tags,side,max_companions)
  values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','couple','Carla','612000003','pendiente',0,null,now(),null,'{}',null,null);

  -- RLS: la otra boda ni se toca ni admite altas.
  update public.wedding_guests set name = 'Pirata' where id = 'cb000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'La pareja A editó un invitado de B'; end if;
  begin
    insert into public.wedding_guests(wedding_id,source,name) values ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','couple','Intrusa');
    raise exception 'La pareja A añadió un invitado a B';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin
  if (select name from public.wedding_guests where id = 'cb000000-0000-4000-8000-000000000001') <> 'Berta' then raise exception 'B cambió'; end if;
  if (select count(*) from public.wedding_guests where wedding_id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 2 then raise exception 'Alta de A no guardada'; end if;
  if (select count(*) from public.wedding_guests where wedding_id = 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'Alta colada en B'; end if;
end $$;
rollback;
