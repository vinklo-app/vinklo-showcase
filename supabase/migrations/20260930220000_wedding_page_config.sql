-- Content chosen by the couple for their public invitation.
-- This migration preserves the server-only public-view access boundary.
begin;

alter table public.weddings
  add column page_config jsonb not null default '{}'::jsonb
  check (jsonb_typeof(page_config) = 'object');

grant insert (page_config), update (page_config)
  on public.weddings to authenticated;
-- Existing owns_wedding/couple_id RLS policies still scope writes to owners.

-- Keep the existing column order: PostgreSQL permits appending a view column.
create or replace view public.weddings_public
with (security_invoker = true)
as select
  w.slug,
  w.partner_name_1,
  w.partner_name_2,
  w.wedding_date,
  w.cubierto_price_cents,
  w.cover_image_url,
  w.bizum_phone,
  w.stripe_onboarded,
  w.plan,
  w.page_config
from public.weddings w;

revoke all on public.weddings_public from public, anon, authenticated;
grant select on public.weddings_public to service_role;

commit;
