-- Nombres de acompañantes (plan maestro §4.3) y restricciones de las mesas
-- automáticas (§3.5): tablas y columnas. Las RPC que las usan van en
-- 20261023110000. Preparada y verificada en Postgres temporal. NO aplicada en
-- remoto. Aditiva: el código anterior no lee ni escribe nada de esto.
--
--  * wedding_guest_companions: un acompañante con nombre de un invitado (hasta
--    10, posición 0-9). is_kid desbloquea la mesa infantil; table_id null =
--    se sienta con su invitado; con mesa = sentado aparte (la mesa infantil).
--    by_guest: lo escribió el invitado desde su enlace (se le puede enseñar
--    al volver); cualquier cambio de la pareja lo pone a false (mismo patrón
--    que rsvp_notes_by_guest, 20261021120000).
--  * wedding_guest_apart: «No sentar con…». Pares simétricos guardados una
--    vez (guest_a < guest_b).
--  * wedding_tables.pinned_group: «Mesa fija para un grupo» (el grupo de
--    wedding_guests.group_name que las mesas automáticas sientan aquí).
-- Todo con FKs compuestas a la misma boda y RLS por owns_wedding.
begin;

-- ------------------------------------------------------------ acompañantes
create table if not exists public.wedding_guest_companions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  guest_id uuid not null,
  name text not null
    constraint wedding_guest_companions_name_check
    check (name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 80),
  is_kid boolean not null default false,
  notes text
    constraint wedding_guest_companions_notes_check
    check (notes is null or pg_catalog.char_length(notes) between 1 and 200),
  position smallint not null default 0
    constraint wedding_guest_companions_position_check check (position between 0 and 9),
  table_id uuid,
  by_guest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wedding_guest_companions_id_wedding_key unique (id, wedding_id),
  -- Diferida: reordenar (0↔1) dentro de una misma sentencia no choca.
  constraint wedding_guest_companions_guest_position_key unique (guest_id, position) deferrable initially deferred,
  constraint wedding_guest_companions_guest_fkey
    foreign key (guest_id, wedding_id) references public.wedding_guests (id, wedding_id) on delete cascade,
  constraint wedding_guest_companions_table_fkey
    foreign key (table_id, wedding_id) references public.wedding_tables (id, wedding_id) on delete set null (table_id)
);
comment on table public.wedding_guest_companions is
  'Acompañantes con nombre de un invitado (privado de la pareja; el invitado solo ve los que escribió él, by_guest). table_id null = con su invitado.';
create index if not exists wedding_guest_companions_wedding_idx on public.wedding_guest_companions (wedding_id, guest_id, position);
create index if not exists wedding_guest_companions_table_idx on public.wedding_guest_companions (table_id) where table_id is not null;

-- Autoría: una escritura fuera de guest_rsvp_respond es de la pareja.
create or replace function public.wedding_guest_companions_owner()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(pg_catalog.current_setting('vinklo.guest_rsvp_write', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.by_guest := false;
    elsif new.name is distinct from old.name or new.is_kid is distinct from old.is_kid or new.notes is distinct from old.notes then
      new.by_guest := false;
    end if;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.wedding_guest_companions_owner() from public, anon, authenticated;
drop trigger if exists wedding_guest_companions_owner on public.wedding_guest_companions;
create trigger wedding_guest_companions_owner
  before insert or update on public.wedding_guest_companions
  for each row execute function public.wedding_guest_companions_owner();

alter table public.wedding_guest_companions enable row level security;
drop policy if exists "wedding_guest_companions_select_couple" on public.wedding_guest_companions;
drop policy if exists "wedding_guest_companions_insert_couple" on public.wedding_guest_companions;
drop policy if exists "wedding_guest_companions_update_couple" on public.wedding_guest_companions;
drop policy if exists "wedding_guest_companions_delete_couple" on public.wedding_guest_companions;
create policy "wedding_guest_companions_select_couple" on public.wedding_guest_companions for select
  to authenticated using ((select public.owns_wedding(wedding_id)));
create policy "wedding_guest_companions_insert_couple" on public.wedding_guest_companions for insert
  to authenticated with check ((select public.owns_wedding(wedding_id)));
create policy "wedding_guest_companions_update_couple" on public.wedding_guest_companions for update
  to authenticated using ((select public.owns_wedding(wedding_id))) with check ((select public.owns_wedding(wedding_id)));
create policy "wedding_guest_companions_delete_couple" on public.wedding_guest_companions for delete
  to authenticated using ((select public.owns_wedding(wedding_id)));

-- Mínimos por columna. by_guest nunca es de la pareja; wedding_id y guest_id no cambian.
revoke all on public.wedding_guest_companions from public, anon, authenticated;
grant select, delete on public.wedding_guest_companions to authenticated;
grant insert (wedding_id, guest_id, name, is_kid, notes, position, table_id) on public.wedding_guest_companions to authenticated;
grant update (name, is_kid, notes, position, table_id) on public.wedding_guest_companions to authenticated;
grant all on public.wedding_guest_companions to service_role;

-- ------------------------------------------------------------ no sentar juntos
create table if not exists public.wedding_guest_apart (
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  guest_a uuid not null,
  guest_b uuid not null,
  created_at timestamptz not null default now(),
  primary key (wedding_id, guest_a, guest_b),
  -- Simétrico: el par se guarda una vez, con el id menor primero.
  constraint wedding_guest_apart_order_check check (guest_a < guest_b),
  constraint wedding_guest_apart_a_fkey
    foreign key (guest_a, wedding_id) references public.wedding_guests (id, wedding_id) on delete cascade,
  constraint wedding_guest_apart_b_fkey
    foreign key (guest_b, wedding_id) references public.wedding_guests (id, wedding_id) on delete cascade
);
comment on table public.wedding_guest_apart is
  '«No sentar con…»: pares de invitados que las mesas automáticas no sientan juntos (guest_a < guest_b). Privado de la pareja.';
create index if not exists wedding_guest_apart_b_idx on public.wedding_guest_apart (guest_b);

alter table public.wedding_guest_apart enable row level security;
drop policy if exists "wedding_guest_apart_select_couple" on public.wedding_guest_apart;
drop policy if exists "wedding_guest_apart_insert_couple" on public.wedding_guest_apart;
drop policy if exists "wedding_guest_apart_delete_couple" on public.wedding_guest_apart;
create policy "wedding_guest_apart_select_couple" on public.wedding_guest_apart for select
  to authenticated using ((select public.owns_wedding(wedding_id)));
create policy "wedding_guest_apart_insert_couple" on public.wedding_guest_apart for insert
  to authenticated with check ((select public.owns_wedding(wedding_id)));
create policy "wedding_guest_apart_delete_couple" on public.wedding_guest_apart for delete
  to authenticated using ((select public.owns_wedding(wedding_id)));

revoke all on public.wedding_guest_apart from public, anon, authenticated;
grant select, delete on public.wedding_guest_apart to authenticated;
grant insert (wedding_id, guest_a, guest_b) on public.wedding_guest_apart to authenticated;
grant all on public.wedding_guest_apart to service_role;

-- ------------------------------------------------------------ mesa fija para un grupo
alter table public.wedding_tables add column if not exists pinned_group text;
alter table public.wedding_tables drop constraint if exists wedding_tables_pinned_group_check;
alter table public.wedding_tables add constraint wedding_tables_pinned_group_check
  check (pinned_group is null or (pinned_group = pg_catalog.btrim(pinned_group) and pg_catalog.char_length(pinned_group) between 1 and 40));
comment on column public.wedding_tables.pinned_group is
  'Grupo (wedding_guests.group_name) que las mesas automáticas sientan en esta mesa. null = ninguno.';
grant insert (pinned_group) on public.wedding_tables to authenticated;
grant update (pinned_group) on public.wedding_tables to authenticated;

commit;
