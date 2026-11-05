-- BodaBote core schema (PLAN.md §4)
-- Access model:
--   couple (authenticated)  → owns wedding rows via RLS
--   guest (anon)            → reads ONLY the weddings_public view; contributes via server action (service role)
--   vendor (magic link)     → NO direct Data API access; /v/[token] routes are server-validated with service role
-- Since 2026-04, new public tables are NOT auto-exposed to the Data API: grants below are explicit and minimal.

-- ============ enums ============
create type wedding_plan as enum ('free', 'premium');
create type profile_role as enum ('couple', 'planner');
create type vendor_status as enum ('invited', 'active');
create type tranche_status as enum ('pending', 'paid');
create type contribution_method as enum ('card', 'bizum_manual');
create type contribution_status as enum ('pending', 'confirmed', 'failed');

-- ============ tables ============
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  role profile_role not null default 'couple',
  created_at timestamptz not null default now()
);

create table public.weddings (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  couple_id uuid not null references public.profiles (id) on delete cascade,
  partner_name_1 text not null,
  partner_name_2 text not null,
  wedding_date date,
  guest_count_est int check (guest_count_est between 1 and 2000),
  cubierto_price_cents int not null default 15000 check (cubierto_price_cents between 0 and 100000),
  cover_image_url text,
  bizum_phone text,
  stripe_account_id text,
  stripe_onboarded boolean not null default false,
  plan wedding_plan not null default 'free',
  planner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index weddings_couple_id_idx on public.weddings (couple_id);
create index weddings_planner_id_idx on public.weddings (planner_id);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  name text not null,
  email text not null,
  category text not null,
  iban text,
  status vendor_status not null default 'invited',
  invite_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create index vendors_wedding_id_idx on public.vendors (wedding_id);

create table public.vendor_invoices (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  file_path text not null,
  total_cents int not null check (total_cents >= 0),
  notes text,
  uploaded_at timestamptz not null default now()
);
create index vendor_invoices_vendor_id_idx on public.vendor_invoices (vendor_id);

create table public.payment_tranches (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  label text not null,
  amount_cents int not null check (amount_cents > 0),
  due_date date,
  status tranche_status not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index payment_tranches_vendor_id_idx on public.payment_tranches (vendor_id);
create index payment_tranches_due_date_idx on public.payment_tranches (due_date) where status = 'pending';

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  guest_name text not null,
  guest_email text,
  n_cubiertos int not null default 1 check (n_cubiertos between 1 and 20),
  cubierto_cents int not null check (cubierto_cents >= 0),
  gift_cents int not null default 0 check (gift_cents >= 0),
  total_cents int not null check (total_cents >= 0),
  service_fee_cents int not null default 0 check (service_fee_cents >= 0),
  message text,
  method contribution_method not null,
  status contribution_status not null default 'pending',
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now()
);
create index contributions_wedding_id_idx on public.contributions (wedding_id);

create table public.events (
  id bigint generated always as identity primary key,
  wedding_id uuid references public.weddings (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_wedding_id_idx on public.events (wedding_id);
-- webhook idempotency: one row per Stripe event id
create unique index events_stripe_event_idx on public.events ((payload ->> 'stripe_event_id'))
  where payload ? 'stripe_event_id';

-- ============ profile auto-provision ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RLS ============
alter table public.profiles enable row level security;
alter table public.weddings enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_invoices enable row level security;
alter table public.payment_tranches enable row level security;
alter table public.contributions enable row level security;
alter table public.events enable row level security;

-- profiles: owner only
create policy "profiles_select_own" on public.profiles for select
  to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update
  to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- weddings: couple full control; planner read-only on assigned weddings
create policy "weddings_select_couple" on public.weddings for select
  to authenticated using ((select auth.uid()) = couple_id);
create policy "weddings_select_planner" on public.weddings for select
  to authenticated using ((select auth.uid()) = planner_id);
create policy "weddings_insert_couple" on public.weddings for insert
  to authenticated with check ((select auth.uid()) = couple_id);
create policy "weddings_update_couple" on public.weddings for update
  to authenticated using ((select auth.uid()) = couple_id) with check ((select auth.uid()) = couple_id);
create policy "weddings_delete_couple" on public.weddings for delete
  to authenticated using ((select auth.uid()) = couple_id);

-- helper predicate reused by child tables
create or replace function public.owns_wedding(w_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.weddings w
    where w.id = w_id and w.couple_id = (select auth.uid())
  );
$$;

-- vendors: couple manages; vendor NEVER reads via Data API (magic link is server-side only)
create policy "vendors_all_couple" on public.vendors for all
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));

create policy "vendor_invoices_all_couple" on public.vendor_invoices for all
  to authenticated
  using (public.owns_wedding((select v.wedding_id from public.vendors v where v.id = vendor_id)))
  with check (public.owns_wedding((select v.wedding_id from public.vendors v where v.id = vendor_id)));

create policy "payment_tranches_all_couple" on public.payment_tranches for all
  to authenticated
  using (public.owns_wedding((select v.wedding_id from public.vendors v where v.id = vendor_id)))
  with check (public.owns_wedding((select v.wedding_id from public.vendors v where v.id = vendor_id)));

-- contributions: couple reads + updates status (confirm Bizum); inserts happen via service role only
create policy "contributions_select_couple" on public.contributions for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "contributions_update_couple" on public.contributions for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));

-- events: couple reads own wedding events; writes via service role only
create policy "events_select_couple" on public.events for select
  to authenticated using (public.owns_wedding(wedding_id));

-- ============ public guest view ============
-- Definer view over a curated column list: the safe-columns contract IS the view;
-- anon has no grant on public.weddings itself.
create view public.weddings_public
with (security_invoker = false)
as
select
  w.slug,
  w.partner_name_1,
  w.partner_name_2,
  w.wedding_date,
  w.cubierto_price_cents,
  w.cover_image_url,
  w.bizum_phone,
  w.stripe_onboarded,
  w.plan
from public.weddings w;

-- ============ grants (tables are no longer auto-exposed; be explicit & minimal) ============
grant usage on schema public to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.weddings to authenticated;
grant select, insert, update, delete on public.vendors to authenticated;
grant select, insert, update, delete on public.vendor_invoices to authenticated;
grant select, insert, update, delete on public.payment_tranches to authenticated;
grant select, update on public.contributions to authenticated;
grant select on public.events to authenticated;

grant select on public.weddings_public to anon, authenticated;

-- service role: full access for server actions (guest contributions, vendor portal, webhooks)
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
