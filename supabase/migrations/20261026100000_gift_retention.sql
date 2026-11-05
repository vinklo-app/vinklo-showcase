-- Retención de los regalos anotados tras la boda (plan maestro §5.9).
-- Decisión del propietario (9-oct-2026): «a los 12 meses hay que anonimizarlo
-- pero debería quedarse esta info la pareja». La pareja puede descargar antes
-- el CSV de regalos y agradecimientos (panel) y el aviso de 30 días lo dice.
--
-- Preparada en local. NO aplicada en remoto. Aditiva: redefine
-- anonymise_expired_guests (cuerpo ACTUAL de 20261024100000 + regalos) y el
-- trigger de regalos huérfanos; no cambia firmas ni grants.
--
-- Regla (misma fecha y mismas condiciones que los invitados):
--   wedding_gift_givers de la boda -> borrados (quién hizo cada regalo:
--                                     el vínculo con el invitado)
--   wedding_gifts.note             -> null (notas de la pareja)
--   wedding_gifts.description      -> null (texto libre: puede llevar nombres)
--   Se conservan kind, amount_cents, received_on, thanked_at y created_at:
--   número de regalos, totales por tipo y «agradecido» siguen cuadrando.
--
-- Trigger de huérfanos (20261008100000): borrar el último regalante de un
-- regalo borra el regalo. En una boda ya anonimizada (wedding_retention.
-- anonymised_at no nulo) un regalo sin regalantes es legítimo y se conserva.
-- Por eso la función marca anonymised_at ANTES de borrar los regalantes
-- (misma transacción: el trigger ya lo ve).
--
-- Idempotente: solo procesa bodas con anonymised_at nulo; reejecutar = 0.
begin;

create or replace function public.wedding_gift_givers_drop_orphan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Boda anonimizada por retención: el regalo se queda sin regalantes a propósito.
  if exists (select 1 from public.wedding_retention r
              where r.wedding_id = old.wedding_id and r.anonymised_at is not null) then
    return null;
  end if;
  if not exists (select 1 from public.wedding_gift_givers gg where gg.gift_id = old.gift_id) then
    delete from public.wedding_gifts g where g.id = old.gift_id;
  end if;
  return null;
end;
$$;
revoke all on function public.wedding_gift_givers_drop_orphan() from public, anon, authenticated;

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

  -- Primero la marca: el trigger de huérfanos de regalos la consulta para no
  -- borrar los regalos al quitarles los regalantes (20261026100000).
  update public.wedding_retention r
     set anonymised_at = pg_catalog.now()
   where r.wedding_id = any(v_ids);

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

  -- Regalos (20261026100000): fuera quién y el texto libre; se quedan tipo,
  -- importe, fechas y «agradecido».
  delete from public.wedding_gift_givers gg where gg.wedding_id = any(v_ids);

  update public.wedding_gifts f
     set note = null,
         description = null
   where f.wedding_id = any(v_ids)
     and (f.note is not null or f.description is not null);

  return pg_catalog.cardinality(v_ids);
end;
$$;
revoke all on function public.anonymise_expired_guests(date, integer) from public, anon, authenticated;
grant execute on function public.anonymise_expired_guests(date, integer) to service_role;

commit;
