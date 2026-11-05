-- Publicar sincroniza weddings en la MISMA transacción (20261025110000,
-- plan §5.7). Dos bodas ficticias en una base DE PRUEBAS vacía; ROLLBACK.
begin;
insert into auth.users(id) values ('d1111111-1111-4111-8111-111111111111'), ('d2222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date,cover_image_url,page_config) values
 ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sync-pareja-a','d1111111-1111-4111-8111-111111111111','Ana','Luis',null,'https://x.test/vieja.jpg','{"style":"viejo"}'),
 ('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','sync-pareja-b','d2222222-2222-4222-8222-222222222222','Lucia','Juan',null,null,'{}');
create temp table fixture as select
 '{"schemaVersion":1,"templateId":"papel-calido","templateVersion":1,"themeId":"editorial","locale":"es-ES","scenes":[{"id":"portada","type":"cover","enabled":true,"props":{"partnerName1":"Ana","partnerName2":"Luis","weddingDate":"2027-06-12","eyebrow":"¡Nos casamos!","welcomeMessage":"","image":null,"showCountdown":true}},{"id":"asistencia","type":"rsvp","enabled":true,"props":{"title":"Confirma tu asistencia","body":"x"}}]}'::jsonb as doc;
grant select on fixture to authenticated;

-- Una sola sobrecarga; anon sin acceso.
do $$ begin
 if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='wedding_site_publish') <> 1 then
   raise exception 'wedding_site_publish tiene más de una sobrecarga'; end if;
 if has_function_privilege('anon','public.wedding_site_publish(uuid,integer,jsonb,jsonb)','execute') then raise exception 'anon puede publicar'; end if;
 if not has_function_privilege('authenticated','public.wedding_site_publish(uuid,integer,jsonb,jsonb)','execute') then raise exception 'authenticated no puede publicar'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1111111-1111-4111-8111-111111111111',true);
insert into public.wedding_sites(wedding_id,draft_document,draft_version) values('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(select doc from fixture),1);

-- Llamada de 3 argumentos (código desplegado): publica y no toca weddings.
do $$ declare p record; w public.weddings%rowtype; begin
 select * into p from public.wedding_site_publish(p_wedding_id => 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_expected_version => 1, p_document => (select doc from fixture));
 if p.revision_id is null then raise exception 'La llamada antigua no publica'; end if;
 select * into w from public.weddings where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if w.page_config <> '{"style":"viejo"}'::jsonb or w.wedding_date is not null then raise exception 'La llamada antigua tocó weddings'; end if;
end $$;

-- Con p_legacy: publica y sincroniza a la vez (cover_image_url presente y null = quitarla).
do $$ declare p record; w public.weddings%rowtype; begin
 select * into p from public.wedding_site_publish('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, (select doc from fixture),
   '{"page_config":{"style":"editorial","welcomeMessage":""},"partner_name_1":"Ana","partner_name_2":"Luis M.","wedding_date":"2027-06-12","cover_image_url":null}'::jsonb);
 if p.revision_id is null then raise exception 'No publica con p_legacy'; end if;
 select * into w from public.weddings where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if w.page_config <> '{"style":"editorial","welcomeMessage":""}'::jsonb or w.partner_name_2 <> 'Luis M.'
    or w.wedding_date <> date '2027-06-12' or w.cover_image_url is not null then raise exception 'Sincronización incompleta: %', row_to_json(w); end if;
end $$;

-- Clave ausente = columna intacta.
do $$ declare w public.weddings%rowtype; begin
 perform * from public.wedding_site_publish('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, (select doc from fixture), '{"partner_name_2":"Luis"}'::jsonb);
 select * into w from public.weddings where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if w.partner_name_2 <> 'Luis' or w.wedding_date <> date '2027-06-12' or w.page_config->>'style' <> 'editorial' then raise exception 'Una clave ausente cambió algo: %', row_to_json(w); end if;
end $$;

-- Atomicidad: si la sincronización falla (CHECK de nombres), no hay revisión nueva.
do $$ declare before_n integer; before_rev uuid; begin
 select count(*) into before_n from public.wedding_site_revisions where wedding_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 select published_revision_id into before_rev from public.wedding_sites where wedding_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 begin
   perform * from public.wedding_site_publish('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, (select doc from fixture), '{"partner_name_1":"A"}'::jsonb);
   raise exception 'Nombre de 1 letra aceptado';
 exception when check_violation then null;
 end;
 if (select count(*) from public.wedding_site_revisions where wedding_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> before_n then raise exception 'Revisión creada pese al fallo de la sincronización'; end if;
 if (select published_revision_id from public.wedding_sites where wedding_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from before_rev then raise exception 'Puntero movido pese al fallo'; end if;
end $$;

-- Forma inválida (llamada a mano): 22023 site_legacy_invalid, nada publicado.
do $$ declare bad jsonb; before_n integer; begin
 select count(*) into before_n from public.wedding_site_revisions where wedding_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 foreach bad in array array['[]'::jsonb, '{"slug":"robada"}', '{"couple_id":"d2222222-2222-4222-8222-222222222222"}', '{"page_config":"x"}',
                            '{"partner_name_1":3}', '{"wedding_date":"mañana"}', '{"cover_image_url":5}', '{"stripe_account_id":"acct_x"}'] loop
   begin
     perform * from public.wedding_site_publish('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, (select doc from fixture), bad);
     raise exception 'p_legacy aceptado: %', bad;
   exception when invalid_parameter_value then
     if sqlerrm <> 'site_legacy_invalid' then raise exception 'Mensaje inesperado % para %', sqlerrm, bad; end if;
   end;
 end loop;
 if (select count(*) from public.wedding_site_revisions where wedding_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> before_n then raise exception 'Revisión creada con p_legacy inválido'; end if;
end $$;

-- B no sincroniza (ni publica) la boda de A.
select set_config('request.jwt.claim.sub','d2222222-2222-4222-8222-222222222222',true);
do $$ begin
 perform * from public.wedding_site_publish('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, (select doc from fixture), '{"partner_name_1":"Pirata"}'::jsonb);
 raise exception 'B publicó la web de A';
exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin
 if (select partner_name_1 from public.weddings where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'Ana' then raise exception 'B cambió el nombre de A'; end if;
end $$;
rollback;
