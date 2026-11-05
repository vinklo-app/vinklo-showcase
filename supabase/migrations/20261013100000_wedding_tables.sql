-- Plan de mesas (2026-10-06): «Mesa 1», «Mesa presidencial», «Primos»…
-- Handoff: docs/handoffs/2026-10-06-crm-mesas/README.md
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
-- Aplicar ANTES del código que la usa (el código nuevo funciona sin ella: la
-- página /panel/mesas avisa de que falta la migración y el resumen no muestra
-- la línea de «sin mesa»). El código antiguo no la nota (columna nueva nullable).
--
-- Una mesa pertenece a una boda; un invitado está en una mesa o en ninguna
-- (wedding_guests.table_id). La FK compuesta (table_id, wedding_id) impide
-- sentar a un invitado en la mesa de otra boda (mismo patrón que
-- wedding_gift_givers). Borrar la mesa deja a sus invitados sin mesa.
-- Solo la pareja lo ve; nunca va a vistas públicas.
begin;

create table public.wedding_tables (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  name text not null
    constraint wedding_tables_name_check
    check (name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 40),
  seats integer not null default 10
    constraint wedding_tables_seats_check check (seats between 1 and 30),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint wedding_tables_wedding_name_key unique (wedding_id, name),
  constraint wedding_tables_id_wedding_key unique (id, wedding_id)
);
comment on table public.wedding_tables is
  'Mesas del banquete de una boda (privado de la pareja). seats = plazas (1–30); superarlas se permite y el panel avisa.';
create index wedding_tables_wedding_position_idx on public.wedding_tables (wedding_id, position, created_at);

alter table public.wedding_guests add column table_id uuid;
-- on delete set null (table_id): solo esa columna (sin la lista, Postgres
-- pondría también wedding_id a null y el borrado fallaría por NOT NULL).
alter table public.wedding_guests
  add constraint wedding_guests_table_fkey
  foreign key (table_id, wedding_id) references public.wedding_tables (id, wedding_id)
  on delete set null (table_id);
comment on column public.wedding_guests.table_id is
  'Mesa del invitado (wedding_tables, misma boda por FK compuesta). null = sin mesa. Privado de la pareja.';
create index wedding_guests_table_idx on public.wedding_guests (table_id) where table_id is not null;

-- ------------------------------------------------------------ RLS y grants
alter table public.wedding_tables enable row level security;
create policy "wedding_tables_select_couple" on public.wedding_tables for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_tables_insert_couple" on public.wedding_tables for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_tables_update_couple" on public.wedding_tables for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
create policy "wedding_tables_delete_couple" on public.wedding_tables for delete
  to authenticated using (public.owns_wedding(wedding_id));

-- Mínimos por columna (como wedding_gifts). wedding_id no se puede cambiar.
-- wedding_guests.table_id no necesita grant nuevo: wedding_guests ya tiene
-- update a nivel de tabla para authenticated (20260930210000) y su RLS manda.
revoke all on public.wedding_tables from public, anon, authenticated;
grant select, delete on public.wedding_tables to authenticated;
grant insert (wedding_id, name, seats, position) on public.wedding_tables to authenticated;
grant update (name, seats, position) on public.wedding_tables to authenticated;
grant all on public.wedding_tables to service_role;

-- ------------------------------------------------------------ plan de mesas
-- Invoker + couple_id explícito (como guest_group_summary): boda ajena o sin
-- sesión = plan vacío. Un solo jsonb:
--   tables:   mesas en orden, con ocupación y sus invitados.
--     attending = personas que vienen (invitado + acompañantes de los «si»);
--     pending   = invitados sentados sin respuesta;
--     declined  = invitados sentados que no vienen (no ocupan).
--   unseated: invitados sin mesa (los que vienen primero, luego sin respuesta,
--             luego los que no vienen; después por grupo y nombre).
create function public.wedding_seating(p_wedding_id uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with w as (
    select w.id from public.weddings w
    where w.id = p_wedding_id and w.couple_id = (select auth.uid())
  ),
  g as (
    select g.id, g.name, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.group_name, g.table_id,
      case g.rsvp_status when 'si' then 0 when 'pendiente' then 1 else 2 end as rank
    from public.wedding_guests g join w on w.id = g.wedding_id
  ),
  gj as (
    select g.*, pg_catalog.jsonb_build_object(
      'id', g.id, 'name', g.name, 'rsvp_status', g.rsvp_status,
      'companions', g.rsvp_companions, 'notes', g.rsvp_notes, 'group_name', g.group_name) as doc
    from g
  )
  select pg_catalog.jsonb_build_object(
    'tables', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', t.id, 'name', t.name, 'seats', t.seats, 'position', t.position,
          'attending', coalesce((select sum(1 + x.rsvp_companions) from g x where x.table_id = t.id and x.rsvp_status = 'si'), 0),
          'pending', (select count(*) from g x where x.table_id = t.id and x.rsvp_status = 'pendiente'),
          'declined', (select count(*) from g x where x.table_id = t.id and x.rsvp_status = 'no'),
          'guests', coalesce((select pg_catalog.jsonb_agg(x.doc order by x.rank, pg_catalog.lower(x.name), x.id)
                              from gj x where x.table_id = t.id), '[]'::jsonb))
        order by t.position, t.created_at, t.id)
      from public.wedding_tables t join w on w.id = t.wedding_id), '[]'::jsonb),
    'unseated', coalesce((
      select pg_catalog.jsonb_agg(x.doc order by x.rank, x.group_name is null, pg_catalog.lower(x.group_name),
                                  pg_catalog.lower(x.name), x.id)
      from gj x where x.table_id is null), '[]'::jsonb)
  );
$$;
revoke all on function public.wedding_seating(uuid) from public, anon;
grant execute on function public.wedding_seating(uuid) to authenticated, service_role;

commit;
