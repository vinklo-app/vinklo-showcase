-- URL estable: la pareja ya no puede cambiar weddings.slug por la Data API
-- (auditoría integral 2026-10-04, hallazgo H12).
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
--
-- 20260907180000 concedió `update (slug)` a authenticated. La UI conserva el
-- slug, pero una llamada directa podía cambiarlo y romper los enlaces ya
-- enviados por WhatsApp (los tokens personales viajan como /b/<slug>?...).
-- Ninguna ruta legítima del código actualiza el slug: se crea al insertar la
-- boda (lib/actions/wedding.ts) y no se edita.
--   1) Se retira el privilegio de columna (PostgREST responde 42501).
--   2) Trigger de respaldo por si un grant futuro lo reabre: rechaza el
--      cambio cuando quien actualiza es anon/authenticated. service_role y
--      funciones SECURITY DEFINER (owner) siguen pudiendo, para un cambio
--      explícito y soportado en el futuro (alias/redirecciones).
-- Insertar sigue igual: la pareja elige el slug al crear la boda.
begin;

revoke update (slug) on public.weddings from authenticated;
revoke update (slug) on public.weddings from anon;

create or replace function public.weddings_slug_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug and current_user in ('anon', 'authenticated') then
    raise exception using
      errcode = '42501',
      message = 'wedding_slug_immutable',
      hint = 'La dirección de la web no se puede cambiar: rompería los enlaces ya enviados.';
  end if;
  return new;
end;
$$;
revoke all on function public.weddings_slug_immutable() from public, anon, authenticated;

drop trigger if exists weddings_slug_immutable on public.weddings;
create trigger weddings_slug_immutable
  before update of slug on public.weddings
  for each row execute function public.weddings_slug_immutable();

commit;
