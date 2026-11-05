-- Waiting list pre-lanzamiento. Inserciones SOLO vía server action con service
-- role (sin grants a anon/authenticated: la tabla no es visible por Data API).
create type waitlist_kind as enum ('pareja', 'planner', 'proveedor', 'otro');

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text,
  kind waitlist_kind not null default 'pareja',
  wedding_date date,
  source text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;
grant all on public.waitlist to service_role;
