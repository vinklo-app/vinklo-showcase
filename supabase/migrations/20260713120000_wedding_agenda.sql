-- Logística del día para los invitados (feature 2026-07-13): la pareja
-- publica la agenda de la boda — ceremonia, cóctel, banquete, autobuses —
-- y los invitados la ven en /b/[slug]. Mismo patrón de seguridad que el
-- resto: la pareja gestiona por RLS (owns_wedding) y el invitado anónimo
-- lee SOLO a través de una vista definer con columnas curadas.

create table public.wedding_agenda_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  title text not null,
  -- Texto libre ("13:00", "a media tarde"): sin dramas de zona horaria.
  time_label text,
  place text,
  -- Dirección o enlace de Google Maps.
  address text,
  -- "Los buses salen de Plaza de España a las 12:15", etc.
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index wedding_agenda_items_wedding_idx
  on public.wedding_agenda_items (wedding_id, sort);

alter table public.wedding_agenda_items enable row level security;

create policy agenda_couple_all on public.wedding_agenda_items
  for all to authenticated
  using (public.owns_wedding(wedding_id))
  with check (public.owns_wedding(wedding_id));

grant select, insert, update, delete
  on public.wedding_agenda_items to authenticated;

-- Vista pública (columnas curadas, sin ids internos de la boda).
create view public.wedding_agenda_public
with (security_invoker = false)
as
select
  w.slug,
  a.id,
  a.title,
  a.time_label,
  a.place,
  a.address,
  a.notes,
  a.sort
from public.wedding_agenda_items a
join public.weddings w on w.id = a.wedding_id;

grant select on public.wedding_agenda_public to anon, authenticated;
