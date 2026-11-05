-- Proveedores de la boda: lista de contactos de la pareja (2026-10-05).
-- Contrato: docs/handoffs/2026-10-05-proveedores/datos.md
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto: la ordena y aplica el coordinador.
--
-- SIN DINERO. Es una agenda: con quién trabaja la pareja (catering, fotografía,
-- lugar…), cómo contactarle, en qué punto está y una nota libre sobre pagos que
-- escribe la pareja. No hay importes, céntimos, «pagado», facturas ni vínculo
-- con Stripe. Nada se cobra ni se calcula aquí (CLAUDE.md: «Los pagos nuevos
-- permanecen desactivados»).
--
-- Tabla NUEVA e independiente de public.vendors (20260707090339), que sigue
-- dormida con sus tokens de invitación y tramos de pago. No se referencian.
begin;

create table public.wedding_vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- text + CHECK (no enum de Postgres): ampliar la lista es una migración de una línea.
  category text not null default 'otro' check (category in (
    'lugar', 'catering', 'fotografia', 'video', 'musica', 'flores', 'decoracion',
    'vestuario', 'belleza', 'tarta', 'transporte', 'papeleria', 'otro')),
  contact_name text check (char_length(contact_name) <= 120),
  phone text check (char_length(phone) <= 20),
  email text check (char_length(email) <= 254 and position('@' in email) > 1),
  status text not null default 'por_contactar' check (status in (
    'por_contactar', 'contactado', 'en_conversacion', 'contratado', 'descartado')),
  payment_note text check (char_length(payment_note) <= 300),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.wedding_vendor_contacts is
  'Agenda de proveedores de la pareja. Sin importes ni pagos: Vinklo no cobra, no factura ni calcula nada aquí. Independiente de public.vendors (legado dormido).';
comment on column public.wedding_vendor_contacts.status is
  'Punto de la relación según la pareja (por_contactar, contactado, en_conversacion, contratado, descartado). No es un estado de pago.';
comment on column public.wedding_vendor_contacts.payment_note is
  'Nota libre que escribe la pareja (p. ej. «señal 30 % antes del 1 de marzo»). Nunca es un importe que Vinklo calcule, procese o siga.';

create index wedding_vendor_contacts_wedding_idx on public.wedding_vendor_contacts (wedding_id, created_at, id);

-- updated_at: mismo patrón que wedding_sites (trigger propio, acotado a la tabla).
create or replace function public.wedding_vendor_contacts_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.wedding_vendor_contacts_touch_updated_at() from public, anon, authenticated;

create trigger wedding_vendor_contacts_touch_updated_at
  before update on public.wedding_vendor_contacts
  for each row execute function public.wedding_vendor_contacts_touch_updated_at();

alter table public.wedding_vendor_contacts enable row level security;
create policy "wedding_vendor_contacts_select_couple" on public.wedding_vendor_contacts for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_vendor_contacts_insert_couple" on public.wedding_vendor_contacts for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_vendor_contacts_update_couple" on public.wedding_vendor_contacts for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
create policy "wedding_vendor_contacts_delete_couple" on public.wedding_vendor_contacts for delete
  to authenticated using (public.owns_wedding(wedding_id));

-- Patrón 20260907 / CRM mensajes: nada implícito, columnas explícitas.
-- wedding_id, id, created_at y updated_at no se actualizan por la Data API.
revoke all on public.wedding_vendor_contacts from public, anon, authenticated;
grant select, delete on public.wedding_vendor_contacts to authenticated;
grant insert (wedding_id, name, category, contact_name, phone, email, status, payment_note, notes)
  on public.wedding_vendor_contacts to authenticated;
grant update (name, category, contact_name, phone, email, status, payment_note, notes)
  on public.wedding_vendor_contacts to authenticated;
grant all on public.wedding_vendor_contacts to service_role;

-- Resumen para el panel. Invoker + couple_id explícito (como attendance_summary):
-- boda ajena o sin sesión = 0 filas.
create or replace function public.wedding_vendor_summary(p_wedding_id uuid)
returns table(total bigint, por_contactar bigint, contactado bigint, en_conversacion bigint,
  contratado bigint, descartado bigint)
language sql stable security invoker set search_path = '' as $$
  select count(v.id),
    count(v.id) filter (where v.status = 'por_contactar'),
    count(v.id) filter (where v.status = 'contactado'),
    count(v.id) filter (where v.status = 'en_conversacion'),
    count(v.id) filter (where v.status = 'contratado'),
    count(v.id) filter (where v.status = 'descartado')
  from public.weddings w left join public.wedding_vendor_contacts v on v.wedding_id = w.id
  where w.id = p_wedding_id and w.couple_id = (select auth.uid())
  group by w.id;
$$;
revoke all on function public.wedding_vendor_summary(uuid) from public, anon;
grant execute on function public.wedding_vendor_summary(uuid) to authenticated, service_role;

commit;
