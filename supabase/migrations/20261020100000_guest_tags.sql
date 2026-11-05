-- Etiquetas y lado de los invitados (plan maestro 8-oct-2026, §3.1; D5 = sí).
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
-- Aditiva: aplicar ANTES del código que la usa. El código anterior sigue
-- funcionando con ella (guest_page y reminder_queue conservan sus argumentos
-- con los mismos nombres y añaden otros con default; las columnas nuevas van
-- antes de total_count / al final y los esquemas zod no son estrictos;
-- wedding_seating solo añade claves al jsonb). El código nuevo también
-- funciona sin ella (lib/data/attendance.ts y lib/actions/guests.ts reintentan
-- sin las columnas o los argumentos nuevos).
--
--  * Grupo    = «van juntos» (uno o ninguno; las mesas automáticas no lo parten).
--  * Etiquetas = «de qué os conocen» (varias; las mesas automáticas juntan a
--    quien comparte etiqueta). Texto libre, sin tabla aparte: existen mientras
--    alguien las use. Hasta 8 por invitado, 1–30 caracteres, recortadas y sin
--    repetidas (sin distinguir mayúsculas).
--  * Lado     = de quién es invitado: 'p1' (primer nombre de la boda), 'p2' o
--    'ambos'. null = sin indicar.
-- Solo la pareja lo ve; nunca va a vistas públicas.
begin;

-- ------------------------------------------------------------ columnas
create or replace function public.guest_tags_valid(p_tags text[])
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select p_tags is not null
     and pg_catalog.cardinality(p_tags) <= 8
     and not exists (
       select 1 from pg_catalog.unnest(p_tags) t
        where t is null or t <> pg_catalog.btrim(t) or pg_catalog.char_length(t) not between 1 and 30)
     and pg_catalog.cardinality(p_tags) = (select count(distinct pg_catalog.lower(t)) from pg_catalog.unnest(p_tags) t);
$$;
comment on function public.guest_tags_valid(text[]) is
  'CHECK de wedding_guests.tags: hasta 8, cada una recortada y de 1–30 caracteres, sin repetidas sin distinguir mayúsculas.';

alter table public.wedding_guests add column if not exists tags text[] not null default '{}';
alter table public.wedding_guests drop constraint if exists wedding_guests_tags_valid;
alter table public.wedding_guests add constraint wedding_guests_tags_valid check (public.guest_tags_valid(tags));
comment on column public.wedding_guests.tags is
  'Etiquetas del invitado elegidas por la pareja («Amigos de la uni», «Trabajo de Juan»…). Hasta 8, 1–30 caracteres. Privado de la pareja.';
create index if not exists wedding_guests_tags_gin on public.wedding_guests using gin (tags);

alter table public.wedding_guests add column if not exists side text;
alter table public.wedding_guests drop constraint if exists wedding_guests_side_check;
alter table public.wedding_guests add constraint wedding_guests_side_check check (side is null or side in ('p1', 'p2', 'ambos'));
comment on column public.wedding_guests.side is
  'De quién es invitado: p1 (partner_name_1), p2 (partner_name_2) o ambos. null = sin indicar. Privado de la pareja.';

-- ------------------------------------------------------------ guest_page
-- + tags y side (antes de total_count) y filtros p_tag / p_side al final.
-- Cambia el tipo de retorno → drop + create (una sola sobrecarga: dos harían
-- ambiguas en PostgREST las llamadas de 5 y 6 argumentos) y grants de nuevo.
-- p_tag: null = todas; otro = invitados con exactamente esa etiqueta.
-- p_side: null = todos; '' = sin indicar; 'p1' | 'p2' | 'ambos'.
-- Cuerpo: el de 20261015100000 (owns_wedding) más los dos filtros.
drop function if exists public.guest_page(uuid, text, text, integer, integer, text);
create function public.guest_page(p_wedding_id uuid, p_filter text, p_search text,
  p_limit integer, p_offset integer, p_group text default null, p_tag text default null,
  p_side text default null)
returns table(id uuid, name text, phone text, rsvp_status text, rsvp_companions integer,
  rsvp_notes text, source text, invitation_prepared_at timestamptz, invitation_sent_at timestamptz,
  last_reminder_at timestamptz, reminder_count integer, reminders_opt_out boolean,
  created_at timestamptz, invitation_opened_at timestamptz, gift_none boolean,
  gift_count bigint, gift_unthanked boolean, gift_total_cents bigint, group_name text,
  tags text[], side text, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.name, g.phone, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.source,
    g.invitation_prepared_at, g.invitation_sent_at, g.last_reminder_at, g.reminder_count,
    g.reminders_opt_out, g.created_at, g.invitation_opened_at, g.gift_none,
    gs.gift_count, gs.gift_unthanked, gs.gift_total_cents, g.group_name, g.tags, g.side, count(*) over ()
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  cross join lateral (
    select count(f.id) as gift_count,
      coalesce(bool_or(f.thanked_at is null), false) as gift_unthanked,
      coalesce(sum(f.amount_cents), 0)::bigint as gift_total_cents
    from public.wedding_gift_givers gg join public.wedding_gifts f on f.id = gg.gift_id
    where gg.guest_id = g.id
  ) gs
  where g.wedding_id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
    and public.guest_in_filter(g, p_filter)
    and (p_group is null
      or (p_group = '' and g.group_name is null)
      or g.group_name = p_group)
    and (p_tag is null or g.tags @> array[p_tag])
    and (p_side is null
      or (p_side = '' and g.side is null)
      or g.side = p_side)
    and (coalesce(p_search, '') = '' or position(lower(p_search) in lower(g.name)) > 0)
  order by g.created_at, g.id
  limit least(greatest(coalesce(p_limit, 100), 1), 5000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.guest_page(uuid, text, text, integer, integer, text, text, text) from public, anon;
grant execute on function public.guest_page(uuid, text, text, integer, integer, text, text, text) to authenticated, service_role;

-- ------------------------------------------------------------ guest_tag_summary
-- Una fila por etiqueta en uso (alfabético). Invoker + owns_wedding: boda
-- ajena o sin sesión = 0 filas. attendees = confirmados + acompañantes.
create or replace function public.guest_tag_summary(p_wedding_id uuid)
returns table(tag text, guests bigint, confirmed bigint, attendees bigint)
language sql stable security invoker set search_path = '' as $$
  select t.tag,
    count(*),
    count(*) filter (where g.rsvp_status = 'si'),
    (count(*) filter (where g.rsvp_status = 'si')
      + coalesce(sum(g.rsvp_companions) filter (where g.rsvp_status = 'si'), 0))::bigint
  from public.wedding_guests g
  cross join lateral pg_catalog.unnest(g.tags) as t(tag)
  where g.wedding_id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  group by t.tag
  order by pg_catalog.lower(t.tag), t.tag;
$$;
revoke all on function public.guest_tag_summary(uuid) from public, anon;
grant execute on function public.guest_tag_summary(uuid) to authenticated, service_role;

-- ------------------------------------------------------------ escrituras
-- Normaliza una lista de etiquetas: recorta y colapsa espacios, quita vacías y
-- repetidas (sin mayúsculas, se queda la primera) y conserva el orden.
-- Recorta a 8 (las primeras ganan). Interna: solo la usan las RPC de abajo.
create or replace function public.guest_tags_clean(p_tags text[])
returns text[] language sql immutable parallel safe set search_path = '' as $$
  select coalesce(pg_catalog.array_agg(e.tag order by e.ord), '{}'::text[])
  from (
    select d.tag, d.ord from (
      select distinct on (pg_catalog.lower(c.tag)) c.tag, c.ord
      from (
        select pg_catalog.btrim(pg_catalog.regexp_replace(u.t, '\s+', ' ', 'g')) as tag, u.o as ord
        from pg_catalog.unnest(coalesce(p_tags, '{}'::text[])) with ordinality as u(t, o)
      ) c
      where c.tag is not null and c.tag <> ''
      order by pg_catalog.lower(c.tag), c.ord
    ) d
    order by d.ord
    limit 8
  ) e;
$$;
revoke all on function public.guest_tags_clean(text[]) from public, anon;
grant execute on function public.guest_tags_clean(text[]) to authenticated, service_role;

-- Añadir y quitar etiquetas a varios invitados en UNA escritura (selección
-- múltiple «Etiquetar…»). Invoker: la RLS de wedding_guests manda; además
-- owns_wedding y el wedding_id explícito. Lo añadido reutiliza la forma ya
-- usada en la boda («amigos de la uni» entra como «Amigos de la Uni»).
-- Quitar no distingue mayúsculas. Tope: 8 por invitado; las que ya tenía
-- ganan y las añadidas que no caben se descartan (sin error). Cada etiqueta
-- añadida debe tener 1–30 caracteres tras recortar (si no, error 22023).
-- Devuelve cuántos invitados cambiaron.
create or replace function public.set_guest_tags(p_wedding_id uuid, p_ids uuid[], p_add text[] default '{}', p_remove text[] default '{}')
returns integer language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_add text[];
  v_remove text[];
  v_count integer;
begin
  if not (select public.owns_wedding(p_wedding_id)) then
    raise exception 'boda ajena' using errcode = '42501';
  end if;
  if pg_catalog.cardinality(coalesce(p_ids, '{}')) > 500 then
    raise exception 'demasiados invitados' using errcode = '22023';
  end if;
  v_add := public.guest_tags_clean(p_add);
  if exists (select 1 from pg_catalog.unnest(v_add) t where pg_catalog.char_length(t) > 30) then
    raise exception 'etiqueta demasiado larga' using errcode = '22023';
  end if;
  v_remove := coalesce((select pg_catalog.array_agg(pg_catalog.lower(pg_catalog.btrim(t))) from pg_catalog.unnest(coalesce(p_remove, '{}'::text[])) t), '{}');
  -- Forma canónica: si la boda ya usa la etiqueta con otras mayúsculas, esa.
  v_add := coalesce((
    select pg_catalog.array_agg(coalesce(
      (select e.tag from public.wedding_guests eg cross join lateral pg_catalog.unnest(eg.tags) as e(tag)
        where eg.wedding_id = p_wedding_id and pg_catalog.lower(e.tag) = pg_catalog.lower(a.tag)
        order by e.tag limit 1),
      a.tag) order by a.ord)
    from pg_catalog.unnest(v_add) with ordinality as a(tag, ord)), '{}');

  with changed as (
    update public.wedding_guests g
       set tags = n.tags
      from (
        select g2.id, public.guest_tags_clean(
          coalesce((select pg_catalog.array_agg(t order by o) from pg_catalog.unnest(g2.tags) with ordinality as k(t, o)
                     where pg_catalog.lower(t) <> all (v_remove)), '{}'::text[])
          || coalesce((select pg_catalog.array_agg(t order by o) from pg_catalog.unnest(v_add) with ordinality as k(t, o)
                     where pg_catalog.lower(t) <> all (v_remove)), '{}'::text[])) as tags
        from public.wedding_guests g2
        where g2.wedding_id = p_wedding_id and g2.id = any (p_ids)
      ) n
     where g.id = n.id and g.wedding_id = p_wedding_id and g.tags is distinct from n.tags
    returning 1
  )
  select count(*) into v_count from changed;
  return v_count;
end;
$$;
revoke all on function public.set_guest_tags(uuid, uuid[], text[], text[]) from public, anon;
grant execute on function public.set_guest_tags(uuid, uuid[], text[], text[]) to authenticated, service_role;

-- Renombrar una etiqueta en todos los invitados de la boda (sin distinguir
-- mayúsculas). p_to vacío = quitarla a todos. Si alguien ya tenía la etiqueta
-- de destino, se fusionan (sin repetidas, en su sitio). Devuelve las filas
-- cambiadas. Invoker: RLS + owns_wedding.
create or replace function public.rename_guest_tag(p_wedding_id uuid, p_from text, p_to text)
returns integer language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_from text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_from, '')));
  v_to text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_to, ''), '\s+', ' ', 'g'));
  v_count integer;
begin
  if not (select public.owns_wedding(p_wedding_id)) then
    raise exception 'boda ajena' using errcode = '42501';
  end if;
  if v_from = '' then return 0; end if;
  if pg_catalog.char_length(v_to) > 30 then
    raise exception 'etiqueta demasiado larga' using errcode = '22023';
  end if;
  with changed as (
    update public.wedding_guests g
       set tags = public.guest_tags_clean(coalesce((
             select pg_catalog.array_agg(case when pg_catalog.lower(t) = v_from then v_to else t end order by o)
             from pg_catalog.unnest(g.tags) with ordinality as k(t, o)
             where not (pg_catalog.lower(t) = v_from and v_to = '')), '{}'::text[]))
     where g.wedding_id = p_wedding_id
       and exists (select 1 from pg_catalog.unnest(g.tags) t where pg_catalog.lower(t) = v_from)
    returning 1
  )
  select count(*) into v_count from changed;
  return v_count;
end;
$$;
revoke all on function public.rename_guest_tag(uuid, text, text) from public, anon;
grant execute on function public.rename_guest_tag(uuid, text, text) to authenticated, service_role;

-- ------------------------------------------------------------ wedding_seating
-- Igual que 20261015100000 y, en cada invitado, tags, side y kids (niños
-- dentro de sus acompañantes, de rsvp_answers->>'kids'; 0 si falta o no es
-- un número). Mismo tipo de retorno → create or replace (los grants siguen).
create or replace function public.wedding_seating(p_wedding_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  with w as (
    select w.id from public.weddings w
    where w.id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
  ),
  g as (
    select g.id, g.name, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.group_name, g.table_id,
      g.tags, g.side,
      case when g.rsvp_answers->>'kids' ~ '^[0-9]{1,2}$' then (g.rsvp_answers->>'kids')::int else 0 end as kids,
      case g.rsvp_status when 'si' then 0 when 'pendiente' then 1 else 2 end as rank
    from public.wedding_guests g join w on w.id = g.wedding_id
  ),
  gj as (
    select g.*, pg_catalog.jsonb_build_object(
      'id', g.id, 'name', g.name, 'rsvp_status', g.rsvp_status,
      'companions', g.rsvp_companions, 'notes', g.rsvp_notes, 'group_name', g.group_name,
      'tags', pg_catalog.to_jsonb(g.tags), 'side', g.side, 'kids', g.kids) as doc
    from g
  )
  select pg_catalog.jsonb_build_object(
    'tables', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', t.id, 'name', t.name, 'seats', t.seats, 'position', t.position,
          'attending', coalesce((select sum(1 + x.rsvp_companions) from g x where x.table_id = t.id and x.rsvp_status = 'si'), 0),
          'pending', (select count(*) from g x where x.table_id = t.id and x.rsvp_status = 'pendiente'),
          'declined', (select count(*) from g x where x.table_id = t.id and x.rsvp_status = 'no'),
          'guests', coalesce((select pg_catalog.jsonb_agg(x.doc order by x.rank, pg_catalog.lower(x.name), x.id)
                              from gj x where x.table_id = t.id), '[]'::jsonb))
        order by t.position, t.created_at, t.id)
      from public.wedding_tables t join w on w.id = t.wedding_id), '[]'::jsonb),
    'unseated', coalesce((
      select pg_catalog.jsonb_agg(x.doc order by x.rank, x.group_name is null, pg_catalog.lower(x.group_name),
                                  pg_catalog.lower(x.name), x.id)
      from gj x where x.table_id is null), '[]'::jsonb)
  );
$function$;

-- ------------------------------------------------------------ reminder_queue
-- + p_tag (al final, default null) y tags de cada persona (al final). Cambia
-- el tipo de retorno → drop + create, una sola versión, mismos grants.
drop function if exists public.reminder_queue(uuid, integer, text);
create function public.reminder_queue(p_wedding_id uuid, p_limit integer default 200, p_group text default null, p_tag text default null)
returns table(id uuid, name text, phone text, invitation_sent_at timestamptz,
  last_reminder_at timestamptz, reminder_count integer, total_count bigint, group_name text, tags text[])
language sql stable security invoker set search_path = '' as $$
  select g.id, g.name, g.phone, g.invitation_sent_at, g.last_reminder_at, g.reminder_count, count(*) over (), g.group_name, g.tags
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  where g.wedding_id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
    and public.guest_in_filter(g, 'para_recordar')
    and (p_group is null or g.group_name = p_group)
    and (p_tag is null or g.tags @> array[p_tag])
  order by coalesce(g.last_reminder_at, g.invitation_sent_at), g.id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;
revoke all on function public.reminder_queue(uuid, integer, text, text) from public, anon;
grant execute on function public.reminder_queue(uuid, integer, text, text) to authenticated, service_role;

commit;
