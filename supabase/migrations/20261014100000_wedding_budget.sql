-- Presupuesto de la boda (2026-10-06): lo que la pareja prevé gastar, lo que
-- acuerda con cada proveedor y los pagos que anota.
-- Handoff: docs/handoffs/2026-10-06-crm-planificar/README.md
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
-- Aplicar ANTES del código que la usa (el código nuevo funciona sin ella: la
-- sección de presupuesto de /panel/proveedores avisa y la agenda sigue igual).
--
-- ES UN REGISTRO. Vinklo no cobra, no factura, no custodia ni mueve dinero:
-- todos los importes los escribe la pareja como anotación propia. Enteros en
-- céntimos (sin decimales flotantes), siempre ≥ 0.
--
--   wedding_budgets          1 fila por boda: total previsto por la pareja.
--   wedding_budget_items     partidas (categoría, concepto, proveedor opcional
--                            de la agenda, presupuestado y acordado).
--   wedding_budget_payments  pagos anotados de una partida: importe, fecha
--                            prevista y fecha en que la pareja lo marcó como
--                            pagado (paid_on). «Pagado» se DERIVA de aquí
--                            (suma de los que tienen paid_on); no hay otra
--                            columna de pagado.
--
-- La agenda (wedding_vendor_contacts, 20261005100000) sigue SIN dinero: el
-- vínculo va de la partida al contacto, nunca al revés. Para la FK compuesta
-- (misma boda) se añade unique (id, wedding_id) a la agenda.
-- RLS solo con public.owns_wedding(wedding_id): sin RPC ni couple_id en línea.
begin;

-- ------------------------------------------------------------ agenda: clave compuesta
alter table public.wedding_vendor_contacts
  add constraint wedding_vendor_contacts_id_wedding_key unique (id, wedding_id);

-- ------------------------------------------------------------ total previsto
create table public.wedding_budgets (
  wedding_id uuid primary key references public.weddings (id) on delete cascade,
  total_cents integer
    constraint wedding_budgets_total_check check (total_cents between 0 and 999999999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.wedding_budgets is
  'Total previsto del presupuesto que anota la pareja (céntimos). Registro propio: Vinklo no cobra ni mueve dinero.';

-- ------------------------------------------------------------ partidas
create table public.wedding_budget_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  category text not null default 'otros'
    constraint wedding_budget_items_category_check check (category in (
      'finca', 'catering', 'fotografia', 'musica', 'flores', 'vestido', 'traje', 'otros')),
  label text not null
    constraint wedding_budget_items_label_check
    check (label = pg_catalog.btrim(label) and pg_catalog.char_length(label) between 1 and 120),
  vendor_contact_id uuid,
  budgeted_cents integer
    constraint wedding_budget_items_budgeted_check check (budgeted_cents between 0 and 999999999),
  agreed_cents integer
    constraint wedding_budget_items_agreed_check check (agreed_cents between 0 and 999999999),
  notes text constraint wedding_budget_items_notes_check check (pg_catalog.char_length(notes) <= 500),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wedding_budget_items_id_wedding_key unique (id, wedding_id),
  -- Solo un contacto de la MISMA boda; borrar el contacto deja la partida sin proveedor.
  constraint wedding_budget_items_vendor_fkey foreign key (vendor_contact_id, wedding_id)
    references public.wedding_vendor_contacts (id, wedding_id) on delete set null (vendor_contact_id)
);
comment on table public.wedding_budget_items is
  'Partidas del presupuesto de la pareja: presupuestado y acordado en céntimos, anotados por la pareja. No es una factura ni un cobro.';
create index wedding_budget_items_wedding_idx on public.wedding_budget_items (wedding_id, position, created_at);
create index wedding_budget_items_vendor_idx on public.wedding_budget_items (vendor_contact_id) where vendor_contact_id is not null;

-- ------------------------------------------------------------ pagos anotados
create table public.wedding_budget_payments (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  item_id uuid not null,
  amount_cents integer not null
    constraint wedding_budget_payments_amount_check check (amount_cents between 0 and 999999999),
  due_on date,
  paid_on date,
  note text constraint wedding_budget_payments_note_check check (pg_catalog.char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wedding_budget_payments_item_fkey foreign key (item_id, wedding_id)
    references public.wedding_budget_items (id, wedding_id) on delete cascade
);
comment on table public.wedding_budget_payments is
  'Pagos que la pareja anota para una partida: importe, fecha prevista (due_on) y fecha en que lo marcó como pagado (paid_on). Vinklo no ejecuta ni verifica pagos.';
create index wedding_budget_payments_item_idx on public.wedding_budget_payments (item_id);
create index wedding_budget_payments_wedding_due_idx on public.wedding_budget_payments (wedding_id, due_on);

-- ------------------------------------------------------------ updated_at
create or replace function public.wedding_budget_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.wedding_budget_touch_updated_at() from public, anon, authenticated;

create trigger wedding_budgets_touch_updated_at before update on public.wedding_budgets
  for each row execute function public.wedding_budget_touch_updated_at();
create trigger wedding_budget_items_touch_updated_at before update on public.wedding_budget_items
  for each row execute function public.wedding_budget_touch_updated_at();
create trigger wedding_budget_payments_touch_updated_at before update on public.wedding_budget_payments
  for each row execute function public.wedding_budget_touch_updated_at();

-- ------------------------------------------------------------ RLS
alter table public.wedding_budgets enable row level security;
create policy "wedding_budgets_select_couple" on public.wedding_budgets for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_budgets_insert_couple" on public.wedding_budgets for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_budgets_update_couple" on public.wedding_budgets for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
create policy "wedding_budgets_delete_couple" on public.wedding_budgets for delete
  to authenticated using (public.owns_wedding(wedding_id));

alter table public.wedding_budget_items enable row level security;
create policy "wedding_budget_items_select_couple" on public.wedding_budget_items for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_budget_items_insert_couple" on public.wedding_budget_items for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_budget_items_update_couple" on public.wedding_budget_items for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
create policy "wedding_budget_items_delete_couple" on public.wedding_budget_items for delete
  to authenticated using (public.owns_wedding(wedding_id));

alter table public.wedding_budget_payments enable row level security;
create policy "wedding_budget_payments_select_couple" on public.wedding_budget_payments for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_budget_payments_insert_couple" on public.wedding_budget_payments for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_budget_payments_update_couple" on public.wedding_budget_payments for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
create policy "wedding_budget_payments_delete_couple" on public.wedding_budget_payments for delete
  to authenticated using (public.owns_wedding(wedding_id));

-- ------------------------------------------------------------ grants (por columna, sin anon)
revoke all on public.wedding_budgets from public, anon, authenticated;
grant select, delete on public.wedding_budgets to authenticated;
grant insert (wedding_id, total_cents) on public.wedding_budgets to authenticated;
grant update (total_cents) on public.wedding_budgets to authenticated;
grant all on public.wedding_budgets to service_role;

revoke all on public.wedding_budget_items from public, anon, authenticated;
grant select, delete on public.wedding_budget_items to authenticated;
grant insert (wedding_id, category, label, vendor_contact_id, budgeted_cents, agreed_cents, notes, position)
  on public.wedding_budget_items to authenticated;
grant update (category, label, vendor_contact_id, budgeted_cents, agreed_cents, notes, position)
  on public.wedding_budget_items to authenticated;
grant all on public.wedding_budget_items to service_role;

revoke all on public.wedding_budget_payments from public, anon, authenticated;
grant select, delete on public.wedding_budget_payments to authenticated;
grant insert (wedding_id, item_id, amount_cents, due_on, paid_on, note)
  on public.wedding_budget_payments to authenticated;
grant update (amount_cents, due_on, paid_on, note)
  on public.wedding_budget_payments to authenticated;
grant all on public.wedding_budget_payments to service_role;

commit;
