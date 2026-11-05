-- Grupos de invitados (2026-10-06): «Familia de Elena», «Amigos de Marcos», «Trabajo»…
-- Handoff: docs/handoffs/2026-10-06-crm-grupos/README.md
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
-- Aplicar ANTES del código que la usa. El código antiguo sigue funcionando con
-- ella aplicada (llama a guest_page con 5 argumentos nominales → p_group toma
-- su default; los z.object ignoran la columna nueva). El código nuevo también
-- funciona sin ella (sin grupos: ver lib/data/attendance.ts y lib/actions/guests.ts).
--
-- Un invitado está en un grupo o en ninguno (texto libre, no tabla aparte): los
-- grupos «existen» mientras alguien los use. La pareja los escribe y la ficha
-- sugiere los ya usados. Solo la pareja lo ve; nunca va a vistas públicas.
begin;

alter table public.wedding_guests
  add column group_name text
    constraint wedding_guests_group_name_check
    check (group_name is null or (group_name = pg_catalog.btrim(group_name)
      and pg_catalog.char_length(group_name) between 1 and 40));
comment on column public.wedding_guests.group_name is
  'Grupo del invitado elegido por la pareja (p. ej. «Familia de Elena»). null = sin grupo. Recortado, 1–40 caracteres. Privado de la pareja.';

create index wedding_guests_wedding_group_idx on public.wedding_guests (wedding_id, group_name);

-- Página de la lista + group_name y filtro por grupo. Cambia el tipo de retorno
-- → drop + create (una sola función: dos sobrecargas harían ambiguas las
-- llamadas de 5 argumentos en PostgREST) y grants de nuevo.
-- p_group: null = todos; '' = sin grupo (un nombre real nunca es '' por el CHECK);
-- otro = exactamente ese grupo.
drop function public.guest_page(uuid, text, text, integer, integer);
create function public.guest_page(p_wedding_id uuid, p_filter text, p_search text,
  p_limit integer, p_offset integer, p_group text default null)
returns table(id uuid, name text, phone text, rsvp_status text, rsvp_companions integer,
  rsvp_notes text, source text, invitation_prepared_at timestamptz, invitation_sent_at timestamptz,
  last_reminder_at timestamptz, reminder_count integer, reminders_opt_out boolean,
  created_at timestamptz, invitation_opened_at timestamptz, gift_none boolean,
  gift_count bigint, gift_unthanked boolean, gift_total_cents bigint, group_name text,
  total_count bigint)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.name, g.phone, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.source,
    g.invitation_prepared_at, g.invitation_sent_at, g.last_reminder_at, g.reminder_count,
    g.reminders_opt_out, g.created_at, g.invitation_opened_at, g.gift_none,
    gs.gift_count, gs.gift_unthanked, gs.gift_total_cents, g.group_name, count(*) over ()
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  cross join lateral (
    select count(f.id) as gift_count,
      coalesce(bool_or(f.thanked_at is null), false) as gift_unthanked,
      coalesce(sum(f.amount_cents), 0)::bigint as gift_total_cents
    from public.wedding_gift_givers gg join public.wedding_gifts f on f.id = gg.gift_id
    where gg.guest_id = g.id
  ) gs
  where g.wedding_id = p_wedding_id and w.couple_id = (select auth.uid())
    and public.guest_in_filter(g, p_filter)
    and (p_group is null
      or (p_group = '' and g.group_name is null)
      or g.group_name = p_group)
    and (coalesce(p_search, '') = '' or position(lower(p_search) in lower(g.name)) > 0)
  order by g.created_at, g.id
  limit least(greatest(coalesce(p_limit, 100), 1), 5000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.guest_page(uuid, text, text, integer, integer, text) from public, anon;
grant execute on function public.guest_page(uuid, text, text, integer, integer, text) to authenticated, service_role;

-- Resumen por grupo. Invoker + couple_id explícito (como crm_funnel_summary):
-- boda ajena o sin sesión = 0 filas. Una fila por grupo y otra con
-- group_name null para los invitados sin grupo (si los hay).
-- attendees = confirmados + sus acompañantes.
create function public.guest_group_summary(p_wedding_id uuid)
returns table(group_name text, guests bigint, confirmed bigint, declined bigint,
  pending bigint, attendees bigint)
language sql stable security invoker set search_path = '' as $$
  select g.group_name,
    count(*),
    count(*) filter (where g.rsvp_status = 'si'),
    count(*) filter (where g.rsvp_status = 'no'),
    count(*) filter (where g.rsvp_status = 'pendiente'),
    (count(*) filter (where g.rsvp_status = 'si')
      + coalesce(sum(g.rsvp_companions) filter (where g.rsvp_status = 'si'), 0))::bigint
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  where g.wedding_id = p_wedding_id and w.couple_id = (select auth.uid())
  group by g.group_name
  order by g.group_name is null, pg_catalog.lower(g.group_name), g.group_name;
$$;
revoke all on function public.guest_group_summary(uuid) from public, anon;
grant execute on function public.guest_group_summary(uuid) to authenticated, service_role;

commit;
