-- Historial del borrador de la web (2026-10-27, editor «como Lovable»).
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
-- Aditiva: el código nuevo funciona sin ella (el chat del editor vive solo en
-- memoria y no hay historial al recargar). Aplicar ANTES de publicar el código
-- si se quiere conservar la conversación entre sesiones.
--
-- Cada cambio que la IA aplica al borrador (y los retoques a mano y las
-- restauraciones) deja aquí una fila con el documento resultante. El chat se
-- reconstruye desde esta tabla al abrir el editor, también para la otra
-- persona de la pareja. «Restaurar esta versión» guarda ese documento como
-- borrador NUEVO (no se borra nada). Nada de esto llega a los invitados: solo
-- publicar (wedding_site_publish) cambia la web pública.
--
--  - author_id lo fija la base (auth.uid()); el cliente no puede escribirlo.
--  - Solo insert y select para la pareja (owns_wedding). Sin update ni delete:
--    el historial no se reescribe. Al borrar la boda, cascada.
--  - Se conservan las 50 últimas filas por boda: el trigger recorta en la
--    misma transacción del insert (security definer: la pareja no tiene
--    permiso de borrado).
--  - Nada para anon. Ninguna vista pública la expone.
begin;

create table public.wedding_site_drafts_history (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  created_at timestamptz not null default now(),
  author_id uuid default auth.uid(),
  kind text not null
    constraint wedding_site_drafts_history_kind_check check (kind in ('ai', 'manual', 'restore')),
  prompt text not null default ''
    constraint wedding_site_drafts_history_prompt_check check (pg_catalog.char_length(prompt) <= 600),
  summary text not null default ''
    constraint wedding_site_drafts_history_summary_check check (pg_catalog.char_length(summary) <= 1200),
  changes jsonb not null default '[]'::jsonb
    constraint wedding_site_drafts_history_changes_check
    check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) <= 40 and pg_column_size(changes) <= 8192),
  document jsonb not null
    constraint wedding_site_drafts_history_document_check
    check (jsonb_typeof(document) = 'object' and pg_column_size(document) <= 65536),
  draft_version integer not null
    constraint wedding_site_drafts_history_version_check check (draft_version >= 1)
);
comment on table public.wedding_site_drafts_history is
  'Versiones del borrador de la web (chat del editor): IA, retoques a mano y restauraciones. Privado de la pareja; 50 últimas por boda.';

create index wedding_site_drafts_history_wedding_idx
  on public.wedding_site_drafts_history (wedding_id, created_at desc, id desc);

-- author_id: siempre quien inserta (nunca lo elige el cliente).
create or replace function public.wedding_site_drafts_history_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.author_id := (select auth.uid());
  new.created_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;
revoke all on function public.wedding_site_drafts_history_author() from public, anon, authenticated;

create trigger wedding_site_drafts_history_author
  before insert on public.wedding_site_drafts_history
  for each row execute function public.wedding_site_drafts_history_author();

-- Recorte a las 50 últimas por boda, en la misma transacción del insert.
create or replace function public.wedding_site_drafts_history_trim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.wedding_site_drafts_history h
  where h.wedding_id = new.wedding_id
    and h.id in (
      select x.id from public.wedding_site_drafts_history x
      where x.wedding_id = new.wedding_id
      order by x.created_at desc, x.id desc
      offset 50
    );
  return null;
end;
$$;
revoke all on function public.wedding_site_drafts_history_trim() from public, anon, authenticated;

create trigger wedding_site_drafts_history_trim
  after insert on public.wedding_site_drafts_history
  for each row execute function public.wedding_site_drafts_history_trim();

alter table public.wedding_site_drafts_history enable row level security;
create policy "wedding_site_drafts_history_select_couple" on public.wedding_site_drafts_history for select
  to authenticated using ((select public.owns_wedding(wedding_id)));
create policy "wedding_site_drafts_history_insert_couple" on public.wedding_site_drafts_history for insert
  to authenticated with check ((select public.owns_wedding(wedding_id)));

revoke all on public.wedding_site_drafts_history from public, anon, authenticated;
grant select on public.wedding_site_drafts_history to authenticated;
grant insert (wedding_id, kind, prompt, summary, changes, document, draft_version)
  on public.wedding_site_drafts_history to authenticated;
grant all on public.wedding_site_drafts_history to service_role;

commit;
