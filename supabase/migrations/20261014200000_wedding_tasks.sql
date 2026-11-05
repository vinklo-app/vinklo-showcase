-- Lista de tareas de la boda (2026-10-06): lo que queda por hacer, con fecha
-- límite opcional. Handoff: docs/handoffs/2026-10-06-crm-planificar/README.md
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
-- Aplicar ANTES del código que la usa (el código nuevo funciona sin ella:
-- /panel/tareas avisa y el resumen no muestra la línea de tareas).
--
-- template_key: tareas añadidas desde las sugerencias de Vinklo («reservar
-- finca», «enviar invitaciones»…). unique (wedding_id, template_key) hace que
-- añadirlas dos veces no duplique nada; las tareas propias lo llevan a null.
-- Son sugerencias editables: nada se crea hecho ni con fecha fija; la fecha
-- la calcula el servidor desde weddings.wedding_date y la pareja la cambia.
-- done_at lo fija el trigger al marcar/desmarcar (no lo escribe el cliente).
-- RLS solo con public.owns_wedding(wedding_id). Nada para anon.
begin;

create table public.wedding_tasks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  title text not null
    constraint wedding_tasks_title_check
    check (title = pg_catalog.btrim(title) and pg_catalog.char_length(title) between 1 and 120),
  notes text constraint wedding_tasks_notes_check check (pg_catalog.char_length(notes) <= 1000),
  due_on date,
  done boolean not null default false,
  done_at timestamptz,
  category text
    constraint wedding_tasks_category_check check (category in (
      'finca', 'proveedores', 'invitados', 'ceremonia', 'vestuario', 'papeleo', 'dia', 'otros')),
  position integer not null default 0,
  template_key text
    constraint wedding_tasks_template_key_check check (template_key ~ '^[a-z0-9-]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wedding_tasks_wedding_template_key unique (wedding_id, template_key)
);
comment on table public.wedding_tasks is
  'Tareas de la pareja (privadas). template_key = sugerencia de Vinklo añadida por la pareja (editable); null = tarea propia.';
create index wedding_tasks_wedding_idx on public.wedding_tasks (wedding_id, done, due_on);

create or replace function public.wedding_tasks_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := pg_catalog.now();
    if new.done is distinct from old.done then
      new.done_at := case when new.done then pg_catalog.now() else null end;
    else
      new.done_at := old.done_at;
    end if;
  else
    new.done_at := case when new.done then pg_catalog.now() else null end;
  end if;
  return new;
end;
$$;
revoke all on function public.wedding_tasks_touch() from public, anon, authenticated;

create trigger wedding_tasks_touch before insert or update on public.wedding_tasks
  for each row execute function public.wedding_tasks_touch();

alter table public.wedding_tasks enable row level security;
create policy "wedding_tasks_select_couple" on public.wedding_tasks for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_tasks_insert_couple" on public.wedding_tasks for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_tasks_update_couple" on public.wedding_tasks for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
create policy "wedding_tasks_delete_couple" on public.wedding_tasks for delete
  to authenticated using (public.owns_wedding(wedding_id));

revoke all on public.wedding_tasks from public, anon, authenticated;
grant select, delete on public.wedding_tasks to authenticated;
grant insert (wedding_id, title, notes, due_on, done, category, position, template_key)
  on public.wedding_tasks to authenticated;
grant update (title, notes, due_on, done, category, position)
  on public.wedding_tasks to authenticated;
grant all on public.wedding_tasks to service_role;

commit;
