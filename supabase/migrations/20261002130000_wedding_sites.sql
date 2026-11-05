-- Fase 1 del motor de webs (docs/ARQUITECTURA-Y-PLAN-CLAUDE.md §3): borrador y
-- publicación por boda con instantáneas inmutables y optimistic locking.
--
--   wedding_sites            1 fila por boda: borrador (draft_document, draft_version)
--                            + puntero a la revisión publicada.
--   wedding_site_revisions   instantáneas inmutables del documento (number secuencial
--                            por sitio). Solo las crea la RPC wedding_site_publish.
--   wedding_sites_public     vista para el servidor (service_role) que sirve /b/[slug]
--                            desde la revisión publicada; mismo cierre que weddings_public.
--
-- Modelo de acceso (mismo que el resto del esquema):
--   * La pareja (authenticated) gestiona SU borrador por RLS (owns_wedding) y con
--     privilegios POR COLUMNA: nunca puede mover el puntero published_revision_id
--     ni escribir revisiones directamente; eso solo lo hace la RPC.
--   * Las RPC son SECURITY DEFINER (patrón rl_check) con comprobación explícita
--     de propiedad: el owner de la función salta RLS, así que la autorización va
--     dentro. Se eligió definer y no invoker (patrón attendance_summary) porque
--     invoker exigiría conceder a authenticated insert en revisiones y update en
--     el puntero, y eso reabriría escrituras directas vía PostgREST fuera del
--     invariante "revisión primero, number = max+1, puntero después".
--   * anon no tiene NINGÚN privilegio. La vista pública solo la lee service_role.
--
-- NO migra datos: las bodas sin fila en wedding_sites se siguen sirviendo con el
-- adaptador v1 en código (lib/site-document.ts → documentFromLegacy sobre
-- weddings.page_config). La fila se crea la primera vez que la pareja guarda el
-- borrador en el editor nuevo.

begin;

-- ============================================================ wedding_sites
create table public.wedding_sites (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null unique references public.weddings (id) on delete cascade,
  -- Documento validado por Zod en servidor (lib/site-document.ts, 32 KB de JSON).
  -- pg_column_size mide el jsonb binario (≈1,2–1,5× el texto), de ahí 64 KB.
  draft_document jsonb not null
    check (jsonb_typeof(draft_document) = 'object')
    check (pg_column_size(draft_document) <= 65536)
    -- La RPC lee schemaVersion como entero; sin esta check fallaría con un
    -- not-null opaco en la revisión. El `?` es necesario: con la clave ausente
    -- jsonb_typeof devuelve NULL y una CHECK con NULL se da por cumplida. El
    -- regex (S-08) excluye 1.5 / 1e300, que `::integer` convertiría en 22P02.
    check (draft_document ? 'schemaVersion'
      and jsonb_typeof(draft_document -> 'schemaVersion') = 'number'
      and (draft_document ->> 'schemaVersion') ~ '^[1-9][0-9]{0,8}$'),
  -- Optimistic locking: el cliente envía la versión base; el update exige
  -- igualdad e incrementa (update ... where draft_version = base).
  draft_version integer not null default 1 check (draft_version >= 1),
  published_revision_id uuid,
  -- Última publicación. Se CONSERVA al retirar la web (S-02): una web que se
  -- publicó alguna vez y se retira devuelve 404; una fila nunca publicada
  -- sigue sirviéndose por el adaptador v1.
  published_at timestamptz,
  -- Fijada por wedding_site_unpublish; wedding_site_publish la vuelve a null.
  unpublished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Tres estados y solo tres:
  --   publicada       puntero ≠ null, published_at ≠ null, unpublished_at = null
  --   retirada        puntero = null, published_at ≠ null, unpublished_at ≠ null
  --   nunca publicada puntero = null, published_at = null, unpublished_at = null
  constraint wedding_sites_publish_state check (
    (published_revision_id is not null and published_at is not null and unpublished_at is null)
    or (published_revision_id is null and published_at is null and unpublished_at is null)
    or (published_revision_id is null and published_at is not null and unpublished_at is not null)
  )
);

comment on table public.wedding_sites is
  'Borrador de la web de boda (1 por boda) y puntero a la revisión publicada. Puntero solo movible por wedding_site_publish/unpublish. published_at sobrevive a la retirada (retirada = 404; nunca publicada = adaptador v1).';
comment on column public.wedding_sites.draft_version is
  'Optimistic locking del borrador: el cliente envía la versión que leyó; el update exige igualdad e incrementa. Publicar no la cambia.';

-- ==================================================== wedding_site_revisions
create table public.wedding_site_revisions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.wedding_sites (id) on delete cascade,
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  number integer not null check (number >= 1),
  document jsonb not null
    check (jsonb_typeof(document) = 'object')
    check (pg_column_size(document) <= 65536)
    check (document ? 'schemaVersion'
      and jsonb_typeof(document -> 'schemaVersion') = 'number'
      and (document ->> 'schemaVersion') ~ '^[1-9][0-9]{0,8}$'),
  schema_version integer not null check (schema_version >= 1),
  published_by uuid,
  created_at timestamptz not null default now(),
  unique (site_id, number),
  -- Clave para la FK compuesta desde wedding_sites: el puntero nunca puede
  -- apuntar a una revisión de otra boda.
  unique (id, wedding_id)
);

comment on table public.wedding_site_revisions is
  'Instantáneas inmutables del documento publicado. Solo las inserta wedding_site_publish; sin update (trigger + sin grants).';

create index wedding_site_revisions_site_number_idx
  on public.wedding_site_revisions (site_id, number desc);

-- FK compuesta: (puntero, boda) debe existir en revisiones de ESA boda.
alter table public.wedding_sites
  add constraint wedding_sites_published_revision_fkey
  foreign key (published_revision_id, wedding_id)
  references public.wedding_site_revisions (id, wedding_id);

-- ================================================================ triggers
-- updated_at: no existe patrón en el repo (el código lo escribe a mano en
-- wedding_guests); aquí se acota a esta tabla.
create or replace function public.wedding_sites_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.wedding_sites_touch_updated_at() from public, anon, authenticated;

create trigger wedding_sites_touch_updated_at
  before update on public.wedding_sites
  for each row execute function public.wedding_sites_touch_updated_at();

-- Inmutabilidad de revisiones. SOLO update: el delete debe seguir funcionando
-- para que el borrado de una boda cascadee (weddings → wedding_sites → revisions).
create or replace function public.wedding_site_revisions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '0A000', -- feature_not_supported
    message = 'wedding_site_revisions_immutable',
    hint = 'Las revisiones publicadas no se modifican; publicad una nueva.';
end;
$$;
revoke all on function public.wedding_site_revisions_immutable() from public, anon, authenticated;

create trigger wedding_site_revisions_immutable
  before update on public.wedding_site_revisions
  for each row execute function public.wedding_site_revisions_immutable();

-- ===================================================================== RLS
alter table public.wedding_sites enable row level security;
alter table public.wedding_site_revisions enable row level security;

create policy "wedding_sites_select_couple" on public.wedding_sites for select
  to authenticated using (public.owns_wedding(wedding_id));
create policy "wedding_sites_insert_couple" on public.wedding_sites for insert
  to authenticated with check (public.owns_wedding(wedding_id));
create policy "wedding_sites_update_couple" on public.wedding_sites for update
  to authenticated using (public.owns_wedding(wedding_id)) with check (public.owns_wedding(wedding_id));
-- Sin delete: el sitio vive y muere con la boda (cascade).

-- Revisiones: la pareja solo LEE las suyas. No hay política de insert a
-- propósito: sin grant sería código muerto y la única vía es la RPC definer.
create policy "wedding_site_revisions_select_couple" on public.wedding_site_revisions for select
  to authenticated using (public.owns_wedding(wedding_id));

-- ================================================================== grants
revoke all on public.wedding_sites from public, anon, authenticated;
revoke all on public.wedding_site_revisions from public, anon, authenticated;

grant select on public.wedding_sites to authenticated;
-- draft_version en insert: lib/actions/site.ts envía draft_version=1 al crear
-- la fila; la check (>= 1) y RLS acotan el valor. Nunca el puntero.
grant insert (wedding_id, draft_document, draft_version) on public.wedding_sites to authenticated;
grant update (draft_document, draft_version) on public.wedding_sites to authenticated;
grant select on public.wedding_site_revisions to authenticated;

grant all on public.wedding_sites to service_role;
grant all on public.wedding_site_revisions to service_role;

-- ================================================================== RPCs
-- Publica el borrador actual como nueva revisión y mueve el puntero. Atómica
-- (una función = una transacción). NO incrementa draft_version: publicar no
-- cambia el borrador.
--   p_document: el documento que el servidor acaba de validar con Zod y
--   publishIssues. Debe ser IGUAL (igualdad jsonb, independiente del orden de
--   claves) al draft_document almacenado; si no, 40001. Cierra S-03: sin esto
--   la pareja podía escribir basura en draft_document por la Data API sin tocar
--   la versión y la RPC la publicaba tal cual. Así la revisión es exactamente
--   lo que pasó la validación en servidor.
--   40001 site_version_conflict  el borrador cambió desde que se leyó (versión
--                                distinta o documento distinto / p_document null)
--   42501 site_forbidden         la boda no es del usuario (o no existe)
--   P0002 site_not_found         la boda es suya pero aún no tiene fila (v1)
create or replace function public.wedding_site_publish(
  p_wedding_id uuid,
  p_expected_version integer,
  p_document jsonb
) returns table(revision_id uuid, published_at timestamptz, draft_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_site public.wedding_sites%rowtype;
  v_schema_version integer;
  v_revision_id uuid;
  v_published_at timestamptz := pg_catalog.now();
begin
  if v_uid is null or not exists (
    select 1 from public.weddings w where w.id = p_wedding_id and w.couple_id = v_uid
  ) then
    raise exception using errcode = '42501', message = 'site_forbidden';
  end if;

  select * into v_site
  from public.wedding_sites s
  where s.wedding_id = p_wedding_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'site_not_found';
  end if;

  -- `is distinct from`: con p_expected_version NULL, `<>` daría NULL y el if
  -- lo trataría como falso, saltándose el bloqueo optimista.
  if v_site.draft_version is distinct from p_expected_version then
    raise exception using errcode = '40001', message = 'site_version_conflict';
  end if;
  -- Igualdad jsonb semántica; `is distinct from` también rechaza p_document null.
  if v_site.draft_document is distinct from p_document then
    raise exception using errcode = '40001', message = 'site_version_conflict';
  end if;

  v_schema_version := (v_site.draft_document ->> 'schemaVersion')::integer;

  insert into public.wedding_site_revisions (site_id, wedding_id, number, document, schema_version, published_by)
  select v_site.id, v_site.wedding_id,
         coalesce(max(r.number), 0) + 1,
         v_site.draft_document, v_schema_version, v_uid
  from public.wedding_site_revisions r
  where r.site_id = v_site.id
  returning id into v_revision_id;

  update public.wedding_sites s
  set published_revision_id = v_revision_id,
      published_at = v_published_at,
      unpublished_at = null
  where s.id = v_site.id;

  return query select v_revision_id, v_published_at, v_site.draft_version;
end;
$$;

revoke all on function public.wedding_site_publish(uuid, integer, jsonb) from public, anon;
grant execute on function public.wedding_site_publish(uuid, integer, jsonb) to authenticated, service_role;

-- Retira la web: puntero a null, unpublished_at = now() y published_at se
-- CONSERVA (la vista devuelve la fila con is_published=false → el servidor
-- responde 404). Las revisiones se conservan (histórico). Idempotente: sobre
-- una web ya retirada o nunca publicada no cambia nada.
create or replace function public.wedding_site_unpublish(p_wedding_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (
    select 1 from public.weddings w where w.id = p_wedding_id and w.couple_id = v_uid
  ) then
    raise exception using errcode = '42501', message = 'site_forbidden';
  end if;

  update public.wedding_sites s
  set published_revision_id = null,
      unpublished_at = case
        when s.published_revision_id is not null then pg_catalog.now()
        else s.unpublished_at
      end
  where s.wedding_id = p_wedding_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'site_not_found';
  end if;
end;
$$;

revoke all on function public.wedding_site_unpublish(uuid) from public, anon;
grant execute on function public.wedding_site_unpublish(uuid) to authenticated, service_role;

-- ============================================================ vista pública
-- La lee SOLO el servidor con service_role (app/b/[slug]); mismo cierre que
-- weddings_public (20260907180000 / 20260930220000). security_invoker=true:
-- si alguien le diera grant a anon, RLS de las tablas base seguiría negando.
--
-- Una fila por cada sitio que se ha publicado ALGUNA VEZ (published_at ≠ null):
--   is_published = true   → document es la revisión publicada
--   is_published = false  → web retirada: document null, el servidor responde 404
-- Sin fila (boda sin wedding_sites o nunca publicada) → adaptador v1 en código.
create view public.wedding_sites_public
with (security_invoker = true)
as
select
  w.slug,
  w.plan,
  (s.published_revision_id is not null) as is_published,
  r.document,
  s.published_at,
  s.unpublished_at,
  r.schema_version,
  r.id as revision_id
from public.wedding_sites s
left join public.wedding_site_revisions r on r.id = s.published_revision_id
join public.weddings w on w.id = s.wedding_id
where s.published_at is not null;

revoke all on public.wedding_sites_public from public, anon, authenticated;
grant select on public.wedding_sites_public to service_role;

commit;
