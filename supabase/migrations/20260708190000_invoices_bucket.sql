-- Vendor portal storage (PLAN.md §1, M2): a private bucket for the
-- invoice/presupuesto PDFs vendors upload through /v/[token]. No storage
-- policies needed — the vendor magic link has no Supabase session, so all
-- reads/writes go through the service-role admin client in
-- lib/actions/vendors.ts. The couple's panel never links to raw storage
-- URLs either; everything is served through server-validated actions.
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;
