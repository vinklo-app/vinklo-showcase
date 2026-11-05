-- La URL estable no se cambia por la Data API (20261006102000, auditoría
-- 2026-10-04 H12). Solo una base DE PRUEBAS vacía con todas las migraciones.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/weddings-slug.sql
-- Dos bodas ficticias; todo se revierte con ROLLBACK.
begin;
insert into auth.users(id) values ('71111111-1111-4111-8111-111111111111'), ('72222222-2222-4222-8222-222222222222');
insert into public.weddings(id,slug,couple_id,partner_name_1,partner_name_2) values
 ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','slug-pareja-a','71111111-1111-4111-8111-111111111111','Ana','Luis'),
 ('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','slug-pareja-b','72222222-2222-4222-8222-222222222222','Lucia','Juan');

do $$ begin
 if has_column_privilege('authenticated','public.weddings','slug','update') then raise exception 'slug actualizable por authenticated'; end if;
 if has_column_privilege('anon','public.weddings','slug','update') then raise exception 'slug actualizable por anon'; end if;
 -- Crear la boda (onboarding) sigue eligiendo el slug.
 if not has_column_privilege('authenticated','public.weddings','slug','insert') then raise exception 'Onboarding sin insert de slug'; end if;
 -- El resto de ajustes sigue editable.
 if not has_column_privilege('authenticated','public.weddings','partner_name_1','update') then raise exception 'Ajustes ya no editables'; end if;
 if not has_column_privilege('authenticated','public.weddings','page_config','update') then raise exception 'page_config ya no editable'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',true);
-- Sonda de la auditoría: ahora falla.
do $$ begin
 update public.weddings set slug='audit-changed-slug' where id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 raise exception 'H12 sigue abierto: el propietario cambió su slug';
exception when insufficient_privilege then null; end $$;
-- Ajustes normales (como lib/actions/wedding.ts y publishSite) siguen funcionando.
do $$ begin
 update public.weddings set partner_name_1='Ana María', page_config='{"style":"editorial"}' where id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if not found then raise exception 'Ajustes de la pareja bloqueados'; end if;
end $$;
-- Boda ajena: ni slug ni ajustes.
do $$ begin
 update public.weddings set slug='robado' where id='7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 raise exception 'Slug ajeno cambiado';
exception when insufficient_privilege then null; end $$;
do $$ begin
 update public.weddings set partner_name_1='X' where id='7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 if found then raise exception 'Ajustes de otra boda cambiados'; end if;
end $$;
reset role;

-- Trigger de respaldo: aunque un grant futuro reabra la columna, authenticated
-- no cambia el slug. Se simula concediendo el privilegio dentro del ROLLBACK.
grant update (slug) on public.weddings to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',true);
do $$ begin
 update public.weddings set slug='audit-changed-slug' where id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 raise exception 'Trigger de respaldo no aplicado';
exception when insufficient_privilege then
 if sqlerrm <> 'wedding_slug_immutable' then raise exception 'Mensaje inesperado %', sqlerrm; end if;
end $$;
-- Escribir el MISMO slug (p. ej. un update que reenvía la fila) no falla.
do $$ begin
 update public.weddings set slug='slug-pareja-a' where id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end $$;
reset role;
revoke update (slug) on public.weddings from authenticated;

-- service_role (operación de servidor explícita) sí puede, para un cambio
-- soportado en el futuro con alias/redirecciones.
set local role service_role;
update public.weddings set slug='slug-pareja-a-2' where id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
reset role;
do $$ begin
 if (select slug from public.weddings where id='7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'slug-pareja-a-2' then raise exception 'service_role no pudo cambiar el slug'; end if;
 if (select slug from public.weddings where id='7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 'slug-pareja-b' then raise exception 'Slug de B alterado'; end if;
 raise notice 'weddings-slug: sonda H12 rechazada (privilegio + trigger); ajustes y service_role OK';
end $$;
rollback;
