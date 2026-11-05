-- Retención de datos de invitados tras la boda (plan maestro §5.9, S1).
-- Preparada en local. NO aplicada en remoto. Aditiva: el código actual no la
-- usa; el cron diario la llama solo si existe (sin ella, registra un aviso).
--
-- Regla
--   * 12 meses después de weddings.wedding_date se anonimizan los datos de
--     contacto y las respuestas de los invitados de esa boda:
--       wedding_guests.phone, notes, rsvp_notes, rsvp_answers,
--       rsvp_key_hash, invitation_token_hash  -> null
--       wedding_guest_tokens de la boda        -> borrados (los enlaces dejan de valer)
--       wedding_guest_companions (si existe)   -> filas borradas
--     Se conservan nombre, estado de asistencia, número de acompañantes,
--     grupo, etiquetas y mesa: la lista de quién vino sigue siendo útil a la
--     pareja y no permite contactar a nadie.
--   * Aviso previo: a partir de 30 días antes (wedding_date + 12 meses - 30
--     días) el cron escribe a todos los miembros de la boda, UNA vez.
--   * La anonimización exige que el aviso se haya dado hace al menos 30 días:
--     una boda antigua que nunca recibió aviso (primera ejecución) tiene sus
--     30 días igualmente. Fecha efectiva = max(boda + 12 meses, aviso + 30 días).
--
-- Estado en public.wedding_retention (una fila por boda, solo service_role):
-- no en weddings, para que la pareja no pueda posponer ni marcar nada por la
-- Data API.
--
-- Funciones: security definer, search_path vacío, sin anon/authenticated,
-- solo service_role (el cron). p_today = fecha civil de Madrid que pasa el
-- cron (y que fijan los tests). Una sola sobrecarga por función.
begin;

create table if not exists public.wedding_retention (
  wedding_id uuid primary key references public.weddings (id) on delete cascade,
  notice_sent_at timestamptz,
  anonymised_at timestamptz
);
comment on table public.wedding_retention is
  'Retención tras la boda (§5.9): cuándo se avisó a la pareja y cuándo se anonimizaron los invitados. Solo service_role.';

alter table public.wedding_retention enable row level security;
revoke all on public.wedding_retention from public, anon, authenticated;
grant all on public.wedding_retention to service_role;

-- Bodas que deben recibir el aviso de 30 días (todavía sin aviso y sin
-- anonimizar). anonymise_on = fecha a partir de la cual se anonimizará si el
-- aviso se marca hoy.
create or replace function public.retention_notice_candidates(p_today date, p_limit integer default 200)
returns table (wedding_id uuid, slug text, wedding_date date, anonymise_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.slug, w.wedding_date,
         greatest((w.wedding_date + interval '12 months')::date, p_today + 30)
  from public.weddings w
  left join public.wedding_retention r on r.wedding_id = w.id
  where w.wedding_date is not null
    and (w.wedding_date + interval '12 months')::date - 30 <= p_today
    and r.notice_sent_at is null
    and r.anonymised_at is null
  order by w.wedding_date, w.id
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke all on function public.retention_notice_candidates(date, integer) from public, anon, authenticated;
grant execute on function public.retention_notice_candidates(date, integer) to service_role;

-- Marca el aviso como dado (idempotente: la primera marca manda).
create or replace function public.mark_retention_notice(p_wedding_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with upserted as (
    insert into public.wedding_retention as r (wedding_id, notice_sent_at)
    select w.id, pg_catalog.now() from public.weddings w where w.id = p_wedding_id
    on conflict (wedding_id) do update
      set notice_sent_at = coalesce(r.notice_sent_at, excluded.notice_sent_at)
    returning 1
  )
  select exists (select 1 from upserted);
$$;
revoke all on function public.mark_retention_notice(uuid) from public, anon, authenticated;
grant execute on function public.mark_retention_notice(uuid) to service_role;

-- Anonimiza las bodas vencidas. Devuelve cuántas bodas se han anonimizado en
-- esta llamada (0 en una reejecución: idempotente).
create or replace function public.anonymise_expired_guests(p_today date, p_limit integer default 200)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_has_companions boolean := pg_catalog.to_regclass('public.wedding_guest_companions') is not null;
begin
  if p_today is null then
    raise exception 'p_today is required';
  end if;

  select coalesce(array_agg(x.id), '{}') into v_ids
  from (
    select w.id
    from public.weddings w
    join public.wedding_retention r on r.wedding_id = w.id
    where w.wedding_date is not null
      and (w.wedding_date + interval '12 months')::date <= p_today
      and r.notice_sent_at is not null
      and (r.notice_sent_at at time zone 'Europe/Madrid')::date + 30 <= p_today
      and r.anonymised_at is null
    order by w.wedding_date, w.id
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
    for update of r skip locked
  ) x;

  if pg_catalog.cardinality(v_ids) = 0 then
    return 0;
  end if;

  -- Acompañantes con nombre (tabla de otra rama): si existe, sus filas se
  -- borran. Se localizan por wedding_id si la tabla lo tiene; si no, por guest_id.
  if v_has_companions then
    if exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.wedding_guest_companions'::regclass and a.attname = 'wedding_id' and not a.attisdropped
    ) then
      execute 'delete from public.wedding_guest_companions where wedding_id = any($1)' using v_ids;
    elsif exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.wedding_guest_companions'::regclass and a.attname = 'guest_id' and not a.attisdropped
    ) then
      execute 'delete from public.wedding_guest_companions c using public.wedding_guests g
               where c.guest_id = g.id and g.wedding_id = any($1)' using v_ids;
    end if;
  end if;

  delete from public.wedding_guest_tokens t where t.wedding_id = any(v_ids);

  update public.wedding_guests g
     set phone = null,
         notes = null,
         rsvp_notes = null,
         rsvp_answers = null,
         rsvp_key_hash = null,
         invitation_token_hash = null
   where g.wedding_id = any(v_ids);

  update public.wedding_retention r
     set anonymised_at = pg_catalog.now()
   where r.wedding_id = any(v_ids);

  return pg_catalog.cardinality(v_ids);
end;
$$;
revoke all on function public.anonymise_expired_guests(date, integer) from public, anon, authenticated;
grant execute on function public.anonymise_expired_guests(date, integer) to service_role;

commit;
