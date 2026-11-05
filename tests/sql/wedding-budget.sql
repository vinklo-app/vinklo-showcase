-- Presupuesto (20261014100000): wedding_budgets, wedding_budget_items, wedding_budget_payments.
-- Solo una base DE PRUEBAS vacía con todas las migraciones aplicadas.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/wedding-budget.sql
-- Dos parejas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('91111111-1111-4111-8111-111111111111'), ('92222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2,wedding_date) values
 ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','presu-pareja-a','91111111-1111-4111-8111-111111111111','Elena','Marcos',current_date + 200),
 ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','presu-pareja-b','92222222-2222-4222-8222-222222222222','Lucia','Juan',current_date + 200);
insert into public.wedding_vendor_contacts(id,wedding_id,name,category,status) values
 ('9a000000-0000-4000-8000-000000000001','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Finca El Olivar','lugar','contratado'),
 ('9a000000-0000-4000-8000-000000000002','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Foto Marta','fotografia','en_conversacion'),
 ('9b000000-0000-4000-8000-000000000001','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Catering de B','catering','contratado');
insert into public.wedding_budgets(wedding_id,total_cents) values ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1500000);
insert into public.wedding_budget_items(id,wedding_id,category,label,vendor_contact_id,budgeted_cents,agreed_cents) values
 ('9b100000-0000-4000-8000-000000000001','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','catering','Catering','9b000000-0000-4000-8000-000000000001',900000,950000);
insert into public.wedding_budget_payments(id,wedding_id,item_id,amount_cents,due_on) values
 ('9b200000-0000-4000-8000-000000000001','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','9b100000-0000-4000-8000-000000000001',300000,current_date + 30);

-- ------------------------------------------------------------ esquema y privilegios
do $$
declare t text;
begin
 foreach t in array array['wedding_budgets','wedding_budget_items','wedding_budget_payments'] loop
   if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '% sin RLS', t; end if;
   if has_table_privilege('anon','public.' || t,'select') or has_table_privilege('anon','public.' || t,'insert')
      or has_table_privilege('anon','public.' || t,'update') or has_table_privilege('anon','public.' || t,'delete') then raise exception 'anon con privilegios en %', t; end if;
   if not has_table_privilege('authenticated','public.' || t,'select') or not has_table_privilege('authenticated','public.' || t,'delete') then raise exception 'authenticated sin select/delete en %', t; end if;
   if has_table_privilege('authenticated','public.' || t,'truncate') or has_table_privilege('authenticated','public.' || t,'references')
      or has_table_privilege('authenticated','public.' || t,'trigger') then raise exception 'authenticated con privilegios de más en %', t; end if;
   if has_column_privilege('authenticated','public.' || t,'wedding_id','update') then raise exception 'authenticated mueve filas de boda en %', t; end if;
   if has_column_privilege('authenticated','public.' || t,'created_at','insert') or has_column_privilege('authenticated','public.' || t,'updated_at','update') then raise exception 'authenticated escribe fechas de control en %', t; end if;
   -- Todas las políticas usan owns_wedding (nada de couple_id en línea).
   if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
              and coalesce(qual,'') || coalesce(with_check,'') !~ 'owns_wedding') then raise exception 'Política de % sin owns_wedding', t; end if;
   if (select count(*) from pg_policies where schemaname = 'public' and tablename = t) <> 4 then raise exception 'Políticas de %: se esperan 4', t; end if;
 end loop;
 if has_column_privilege('authenticated','public.wedding_budget_items','id','insert') then raise exception 'authenticated elige el id de la partida'; end if;
 if has_column_privilege('authenticated','public.wedding_budget_payments','item_id','update') then raise exception 'authenticated mueve un pago de partida'; end if;
 if not has_column_privilege('authenticated','public.wedding_budget_items','agreed_cents','update')
    or not has_column_privilege('authenticated','public.wedding_budget_payments','paid_on','update')
    or not has_column_privilege('authenticated','public.wedding_budgets','total_cents','update') then raise exception 'Faltan grants por columna'; end if;
 -- Importes en enteros (céntimos), nunca coma flotante ni numeric.
 if exists (select 1 from information_schema.columns where table_schema='public'
            and table_name in ('wedding_budgets','wedding_budget_items','wedding_budget_payments')
            and column_name ~ 'cents' and data_type <> 'integer') then raise exception 'Importe que no es entero'; end if;
 -- La agenda sigue sin dinero.
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name='wedding_vendor_contacts'
            and column_name ~ '(amount|cents|paid|price|importe|pagado|precio)') then raise exception 'Dinero en la agenda'; end if;
 -- Nada del presupuesto en vistas públicas.
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('weddings_public','wedding_sites_public')
            and column_name ~ '(budget|agreed|paid_on|due_on)') then raise exception 'Vista pública con presupuesto'; end if;
end $$;

-- ------------------------------------------------------------ CHECKs
do $$ begin
 begin insert into public.wedding_budgets(wedding_id,total_cents) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',-1); raise exception 'Total negativo aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_budget_items(wedding_id,label,budgeted_cents) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Flores',-100); raise exception 'Presupuestado negativo aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_budget_items(wedding_id,label,agreed_cents) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Flores',-1); raise exception 'Acordado negativo aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_budget_items(wedding_id,label,agreed_cents) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Flores',1000000000); raise exception 'Importe enorme aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_budget_items(wedding_id,label) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',''); raise exception 'Concepto vacío aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_budget_items(wedding_id,label) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',' Flores'); raise exception 'Concepto sin recortar aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_budget_items(wedding_id,label,category) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Flores','joyas'); raise exception 'Categoría fuera de lista';
 exception when check_violation then null; end;
 begin insert into public.wedding_budget_items(wedding_id,label) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',121)); raise exception 'Concepto de 121 aceptado';
 exception when check_violation then null; end;
 begin insert into public.wedding_budget_payments(wedding_id,item_id,amount_cents) values ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','9b100000-0000-4000-8000-000000000001',-5); raise exception 'Pago negativo aceptado';
 exception when check_violation then null; end;
 -- Decimales: la columna es entera; 12.5 no cabe como céntimos.
 begin insert into public.wedding_budget_items(wedding_id,label,agreed_cents) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Flores','12.5'); raise exception 'Céntimos con decimales aceptados';
 exception when invalid_text_representation then null; end;
end $$;

-- ================================================================ pareja A
set local role authenticated;
select set_config('request.jwt.claim.sub','91111111-1111-4111-8111-111111111111',true);
do $$ declare n integer; finca uuid; foto uuid; p1 uuid; p2 uuid; t record; begin
 -- No ve nada de B.
 if (select count(*) from public.wedding_budgets) <> 0 or (select count(*) from public.wedding_budget_items) <> 0
    or (select count(*) from public.wedding_budget_payments) <> 0 then raise exception 'A ve el presupuesto de B'; end if;

 -- Total previsto: insertar y actualizar (lo que hace la acción: update, y si no hay fila, insert).
 update public.wedding_budgets set total_cents = 2000000 where wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if found then raise exception 'Actualizó un total que no existía'; end if;
 insert into public.wedding_budgets(wedding_id,total_cents) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2000000);
 update public.wedding_budgets set total_cents = 2500000 where wedding_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 get diagnostics n = row_count; if n <> 1 then raise exception 'A no actualiza su total'; end if;

 -- Partidas propias, con y sin proveedor de su agenda.
 insert into public.wedding_budget_items(wedding_id,category,label,vendor_contact_id,budgeted_cents,agreed_cents,position)
  values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','finca','Finca','9a000000-0000-4000-8000-000000000001',800000,850000,1) returning id into finca;
 insert into public.wedding_budget_items(wedding_id,category,label,vendor_contact_id,budgeted_cents,position)
  values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fotografia','Reportaje','9a000000-0000-4000-8000-000000000002',250000,2) returning id into foto;
 insert into public.wedding_budget_items(wedding_id,category,label,budgeted_cents,position)
  values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','vestido','Vestido',180000,3);

 -- Pagos anotados: señal pagada y resto previsto.
 insert into public.wedding_budget_payments(wedding_id,item_id,amount_cents,due_on,paid_on,note)
  values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',finca,255000,current_date - 10,current_date - 9,'Señal 30 %') returning id into p1;
 insert into public.wedding_budget_payments(wedding_id,item_id,amount_cents,due_on)
  values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',finca,595000,current_date + 150) returning id into p2;

 -- Resumen (lo que calcula lib/planning/budget.ts): previsto 25.000 €, comprometido = acordado (8.500 €),
 -- pagado = suma de pagos con paid_on (2.550 €), próximos = sin paid_on por fecha.
 select (select total_cents from public.wedding_budgets) as total,
        (select coalesce(sum(agreed_cents),0) from public.wedding_budget_items) as committed,
        (select coalesce(sum(budgeted_cents),0) from public.wedding_budget_items) as budgeted,
        (select coalesce(sum(amount_cents) filter (where paid_on is not null),0) from public.wedding_budget_payments) as paid,
        (select count(*) filter (where paid_on is null) from public.wedding_budget_payments) as upcoming
   into t;
 if t.total <> 2500000 or t.committed <> 850000 or t.budgeted <> 1230000 or t.paid <> 255000 or t.upcoming <> 1 then raise exception 'Resumen: %', t; end if;

 -- Marcar como pagado y deshacer.
 update public.wedding_budget_payments set paid_on = current_date where id = p2;
 get diagnostics n = row_count; if n <> 1 then raise exception 'A no marca su pago'; end if;
 update public.wedding_budget_payments set paid_on = null where id = p2;

 -- updated_at lo pone el trigger.
 if (select updated_at < clock_timestamp() - interval '1 hour' from public.wedding_budget_items where id = finca) then raise exception 'updated_at'; end if;

 -- Aislamiento: no crea en B, no enlaza el contacto de B, no cuelga pagos de partidas de B.
 begin insert into public.wedding_budgets(wedding_id,total_cents) values ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1); raise exception 'A crea total en B';
 exception when insufficient_privilege or unique_violation then null; end;
 begin insert into public.wedding_budget_items(wedding_id,label) values ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Intrusa'); raise exception 'A crea partida en B';
 exception when insufficient_privilege then null; end;
 begin update public.wedding_budget_items set vendor_contact_id = '9b000000-0000-4000-8000-000000000001' where id = foto; raise exception 'A enlaza el proveedor de B';
 exception when foreign_key_violation then null; end;
 begin insert into public.wedding_budget_items(wedding_id,label,vendor_contact_id) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Cruzada','9b000000-0000-4000-8000-000000000001'); raise exception 'A crea partida con proveedor de B';
 exception when foreign_key_violation then null; end;
 begin insert into public.wedding_budget_payments(wedding_id,item_id,amount_cents) values ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','9b100000-0000-4000-8000-000000000001',100); raise exception 'A cuelga un pago de una partida de B';
 exception when foreign_key_violation then null; end;
 begin update public.wedding_budget_items set wedding_id = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = foto; raise exception 'A mueve partida a B';
 exception when insufficient_privilege then null; end;
 begin update public.wedding_budget_payments set item_id = '9b100000-0000-4000-8000-000000000001' where id = p1; raise exception 'A mueve un pago';
 exception when insufficient_privilege then null; end;
 -- RLS: tocar o borrar lo de B = 0 filas.
 update public.wedding_budgets set total_cents = 1 where wedding_id = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 if found then raise exception 'A cambia el total de B'; end if;
 update public.wedding_budget_items set agreed_cents = 1 where id = '9b100000-0000-4000-8000-000000000001';
 if found then raise exception 'A cambia una partida de B'; end if;
 update public.wedding_budget_payments set paid_on = current_date where id = '9b200000-0000-4000-8000-000000000001';
 if found then raise exception 'A marca un pago de B'; end if;
 delete from public.wedding_budget_payments where id = '9b200000-0000-4000-8000-000000000001';
 if found then raise exception 'A borra un pago de B'; end if;
 delete from public.wedding_budget_items where id = '9b100000-0000-4000-8000-000000000001';
 if found then raise exception 'A borra una partida de B'; end if;

 -- Borrar el contacto de la agenda deja la partida sin proveedor (no la borra).
 delete from public.wedding_vendor_contacts where id = '9a000000-0000-4000-8000-000000000002';
 if (select vendor_contact_id from public.wedding_budget_items where id = foto) is not null then raise exception 'La partida sigue apuntando al contacto borrado'; end if;
 if (select count(*) from public.wedding_budget_items) <> 3 then raise exception 'Borrar el contacto borró partidas'; end if;

 -- Borrar la partida arrastra sus pagos.
 delete from public.wedding_budget_items where id = finca;
 if (select count(*) from public.wedding_budget_payments) <> 0 then raise exception 'Quedan pagos de una partida borrada'; end if;
end $$;
reset role;

-- ================================================================ pareja B
set local role authenticated;
select set_config('request.jwt.claim.sub','92222222-2222-4222-8222-222222222222',true);
do $$ begin
 if (select total_cents from public.wedding_budgets) <> 1500000 then raise exception 'B: total tocado'; end if;
 if (select agreed_cents from public.wedding_budget_items) <> 950000 then raise exception 'B: partida tocada'; end if;
 if (select count(*) from public.wedding_budget_payments where paid_on is null) <> 1 then raise exception 'B: pago tocado'; end if;
 if (select count(*) from public.wedding_budget_items) <> 1 then raise exception 'B ve partidas de A'; end if;
end $$;
reset role;

-- Sin sesión (anon): nada.
set local role anon;
do $$ begin
 begin perform 1 from public.wedding_budgets; raise exception 'anon lee wedding_budgets';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.wedding_budget_items; raise exception 'anon lee wedding_budget_items';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.wedding_budget_payments; raise exception 'anon lee wedding_budget_payments';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- authenticated sin boda propia: no ve nada.
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
do $$ begin
 if (select count(*) from public.wedding_budget_items) <> 0 then raise exception 'Usuario sin boda ve partidas'; end if;
end $$;
reset role;

-- Borrar la boda arrastra total, partidas y pagos.
delete from public.weddings where id = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
 if exists (select 1 from public.wedding_budgets where wedding_id = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    or exists (select 1 from public.wedding_budget_items where wedding_id = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    or exists (select 1 from public.wedding_budget_payments where wedding_id = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Queda presupuesto de una boda borrada'; end if;
end $$;

do $$ begin raise notice 'wedding-budget: CHECK, grants, FK cruzadas, pagado derivado, cascadas y aislamiento A/B OK'; end $$;
rollback;
