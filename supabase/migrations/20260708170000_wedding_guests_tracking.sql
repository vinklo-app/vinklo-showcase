-- Tracking de invitados (feedback 2026-07-08): la pareja lleva su lista de
-- invitados con nombre + teléfono y el estado de su regalo, incluyendo lo
-- que llega FUERA de la plataforma (bizum directo, efectivo, transferencia).

create type public.guest_gift_status as enum (
  'pendiente',
  'enlace',
  'bizum',
  'efectivo',
  'transferencia'
);

create table public.wedding_guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  phone text check (phone is null or char_length(phone) between 6 and 20),
  gift_status public.guest_gift_status not null default 'pendiente',
  amount_cents int check (amount_cents is null or amount_cents >= 0),
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index wedding_guests_wedding_id_idx on public.wedding_guests (wedding_id);

alter table public.wedding_guests enable row level security;

-- La pareja gestiona SOLO los invitados de su boda.
create policy "wedding_guests_select_couple" on public.wedding_guests
  for select using (
    exists (
      select 1 from public.weddings w
      where w.id = wedding_id and w.couple_id = auth.uid()
    )
  );

create policy "wedding_guests_insert_couple" on public.wedding_guests
  for insert with check (
    exists (
      select 1 from public.weddings w
      where w.id = wedding_id and w.couple_id = auth.uid()
    )
  );

create policy "wedding_guests_update_couple" on public.wedding_guests
  for update using (
    exists (
      select 1 from public.weddings w
      where w.id = wedding_id and w.couple_id = auth.uid()
    )
  );

create policy "wedding_guests_delete_couple" on public.wedding_guests
  for delete using (
    exists (
      select 1 from public.weddings w
      where w.id = wedding_id and w.couple_id = auth.uid()
    )
  );

revoke all on public.wedding_guests from anon;
