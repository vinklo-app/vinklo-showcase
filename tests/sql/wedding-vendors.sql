-- Proveedores (20261005100000): agenda de contactos sin dinero.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/wedding-vendors.sql
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('51111111-1111-4111-8111-111111111111'), ('52222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2) values
 ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','prov-pareja-a','51111111-1111-4111-8111-111111111111','Ana','Luis'),
 ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','prov-pareja-b','52222222-2222-4222-8222-222222222222','Lucia','Juan');
insert into public.wedding_vendor_contacts(id,wedding_id,name,category,status) values
 ('5b000000-0000-4000-8000-000000000001','5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Catering de B','catering','contratado');

-- Sin columnas de dinero (regla de producto): ni importes, ni céntimos, ni «pagado».
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='wedding_vendor_contacts'
           and (data_type in ('numeric','integer','bigint','smallint','money','real','double precision','boolean')
                or column_name ~ '(amount|cents|paid|price|importe|pagado|precio)')) then
   raise exception 'Columna con forma de dinero en wedding_vendor_contacts';
 end if;
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','51111111-1111-4111-8111-111111111111',true);
do $$
declare r record; affected integer; v1 uuid; v3 uuid; v4 uuid;
begin
 -- Alta: valores por defecto (categoría «otro», estado «por_contactar»). El id lo pone la base.
 begin
   insert into public.wedding_vendor_contacts(id,wedding_id,name)
     values ('5a000000-0000-4000-8000-000000000009','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Con id elegido');
   raise exception 'id elegible por la pareja';
 exception when insufficient_privilege then null; end;
 insert into public.wedding_vendor_contacts(wedding_id,name)
   values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Finca El Olivar') returning id into v1;
 select * into r from public.wedding_vendor_contacts where id=v1;
 if r.category <> 'otro' or r.status <> 'por_contactar' or r.created_at is null then raise exception 'Valores por defecto incorrectos: %', r; end if;
 insert into public.wedding_vendor_contacts(wedding_id,name,category,contact_name,phone,email,status,payment_note,notes) values
  ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Foto Luz','fotografia','Marta','612345678','marta@example.com','en_conversacion','Señal 30 % antes del 1 de marzo','Nos gusta su estilo');
 insert into public.wedding_vendor_contacts(wedding_id,name,category,status)
   values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','DJ Sol','musica','contratado') returning id into v3;
 insert into public.wedding_vendor_contacts(wedding_id,name,category,status)
   values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Flores Ana','flores','descartado') returning id into v4;

 -- Edición: updated_at lo pone el trigger.
 update public.wedding_vendor_contacts set status='contactado', phone='600111222' where id=v1;
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Edición propia falló'; end if;
 -- now() es fijo en la transacción: el trigger fija now(), igual que el default.
 if (select updated_at from public.wedding_vendor_contacts where id=v1) is distinct from now() then
   raise exception 'updated_at no lo fija el trigger';
 end if;

 -- Resumen propio: total 4 = 0 por_contactar + 1 contactado + 1 en_conversacion + 1 contratado + 1 descartado.
 select * into r from public.wedding_vendor_summary('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if (r.total, r.por_contactar, r.contactado, r.en_conversacion, r.contratado, r.descartado)
    is distinct from (4::bigint, 0::bigint, 1::bigint, 1::bigint, 1::bigint, 1::bigint) then
   raise exception 'Resumen incorrecto: %', r;
 end if;
 -- Resumen y filas de la otra boda: nada.
 if exists(select 1 from public.wedding_vendor_summary('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then raise exception 'Resumen ajeno expuesto'; end if;
 if exists(select 1 from public.wedding_vendor_contacts where wedding_id='5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Proveedor ajeno legible'; end if;
 if (select count(*) from public.wedding_vendor_contacts) <> 4 then raise exception 'A ve filas que no son suyas'; end if;

 -- Escrituras cruzadas: 0 filas o insufficient_privilege.
 update public.wedding_vendor_contacts set name='Pirata' where id='5b000000-0000-4000-8000-000000000001';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'A editó un proveedor de B'; end if;
 delete from public.wedding_vendor_contacts where id='5b000000-0000-4000-8000-000000000001';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'A borró un proveedor de B'; end if;
 begin
   insert into public.wedding_vendor_contacts(wedding_id,name) values ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Intruso');
   raise exception 'Proveedor creado en boda ajena';
 exception when insufficient_privilege then null; end;
 begin
   update public.wedding_vendor_contacts set wedding_id='5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id=v3;
   raise exception 'wedding_id modificable';
 exception when insufficient_privilege then null; end;
 begin
   update public.wedding_vendor_contacts set created_at=now() - interval '1 year' where id=v3;
   raise exception 'created_at modificable';
 exception when insufficient_privilege then null; end;
 begin
   update public.wedding_vendor_contacts set updated_at=now() - interval '1 year' where id=v3;
   raise exception 'updated_at modificable';
 exception when insufficient_privilege then null; end;

 -- Validación (CHECK): nombre obligatorio, enums, longitudes, email.
 begin
   insert into public.wedding_vendor_contacts(wedding_id,name) values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null);
   raise exception 'Nombre null aceptado';
 exception when not_null_violation then null; end;
 begin
   insert into public.wedding_vendor_contacts(wedding_id,name) values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','   ');
   raise exception 'Nombre vacío aceptado';
 exception when check_violation then null; end;
 begin
   insert into public.wedding_vendor_contacts(wedding_id,name) values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('x',121));
   raise exception 'Nombre de 121 aceptado';
 exception when check_violation then null; end;
 begin
   update public.wedding_vendor_contacts set status='pagado' where id=v3;
   raise exception 'Estado desconocido aceptado';
 exception when check_violation then null; end;
 begin
   update public.wedding_vendor_contacts set category='banco' where id=v3;
   raise exception 'Categoría desconocida aceptada';
 exception when check_violation then null; end;
 begin
   update public.wedding_vendor_contacts set email='sin-arroba' where id=v3;
   raise exception 'Email sin @ aceptado';
 exception when check_violation then null; end;
 begin
   update public.wedding_vendor_contacts set phone=repeat('6',21) where id=v3;
   raise exception 'Teléfono de 21 aceptado';
 exception when check_violation then null; end;
 begin
   update public.wedding_vendor_contacts set payment_note=repeat('x',301) where id=v3;
   raise exception 'Nota de pago de 301 aceptada';
 exception when check_violation then null; end;
 begin
   update public.wedding_vendor_contacts set notes=repeat('x',1001) where id=v3;
   raise exception 'Notas de 1001 aceptadas';
 exception when check_violation then null; end;
 update public.wedding_vendor_contacts set notes=repeat('x',1000), payment_note=repeat('x',300), name=repeat('x',120)
   where id=v3;

 -- Borrado propio.
 delete from public.wedding_vendor_contacts where id=v4;
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Borrado propio falló'; end if;
end $$;

-- ================================================================ pareja B
select set_config('request.jwt.claim.sub','52222222-2222-4222-8222-222222222222',true);
do $$ declare affected integer; r record; begin
 if exists(select 1 from public.wedding_vendor_contacts where wedding_id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'B lee proveedores de A'; end if;
 update public.wedding_vendor_contacts set status='descartado', notes='pirata' where wedding_id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'B editó proveedores de A'; end if;
 delete from public.wedding_vendor_contacts where wedding_id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'B borró proveedores de A'; end if;
 if exists(select 1 from public.wedding_vendor_summary('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) then raise exception 'B ve el resumen de A'; end if;
 select * into r from public.wedding_vendor_summary('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if (r.total, r.contratado) is distinct from (1::bigint, 1::bigint) then raise exception 'Resumen propio de B incorrecto: %', r; end if;
end $$;

-- Sin sesión (authenticated sin sub): nada.
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if exists(select 1 from public.wedding_vendor_contacts) then raise exception 'Filas visibles sin sesión'; end if;
 if exists(select 1 from public.wedding_vendor_summary('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) then raise exception 'Resumen sin sesión'; end if;
end $$;

-- ================================================================ anon
set local role anon;
do $$ begin
 if has_table_privilege('anon','public.wedding_vendor_contacts','select')
    or has_table_privilege('anon','public.wedding_vendor_contacts','insert')
    or has_table_privilege('anon','public.wedding_vendor_contacts','update')
    or has_table_privilege('anon','public.wedding_vendor_contacts','delete')
    or has_any_column_privilege('anon','public.wedding_vendor_contacts','select')
    or has_any_column_privilege('anon','public.wedding_vendor_contacts','insert')
    or has_any_column_privilege('anon','public.wedding_vendor_contacts','update') then
   raise exception 'Proveedores expuestos a anon';
 end if;
 if has_function_privilege('anon','public.wedding_vendor_summary(uuid)','execute') then raise exception 'Resumen expuesto a anon'; end if;
 begin
   perform 1 from public.wedding_vendor_contacts;
   raise exception 'anon lee la tabla';
 exception when insufficient_privilege then null; end;
end $$;

-- Estado final como superusuario: nada de B tocó A y viceversa; cascade al borrar la boda.
reset role;
do $$ begin
 if (select count(*) from public.wedding_vendor_contacts where wedding_id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 3 then raise exception 'Proveedores de A perdidos'; end if;
 if exists(select 1 from public.wedding_vendor_contacts where notes='pirata' or name='Pirata' or name='Intruso') then raise exception 'Escritura cruzada persistida'; end if;
 if (select name from public.wedding_vendor_contacts where id='5b000000-0000-4000-8000-000000000001') <> 'Catering de B' then raise exception 'Proveedor de B tocado'; end if;
 delete from public.weddings where id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if exists(select 1 from public.wedding_vendor_contacts where wedding_id='5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Cascade al borrar la boda falló'; end if;
 if (select count(*) from public.wedding_vendor_contacts) <> 1 then raise exception 'Cascade afectó a otra boda'; end if;
end $$;
rollback;
