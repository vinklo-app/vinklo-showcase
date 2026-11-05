-- Recordatorios: la apertura cuenta como entrega SIN escribirla en la ficha, y
-- el SQL aplica las mismas reglas que lib/messages/reminder-rules.ts
-- (revisión del bloque 1, F3 y F10; 15-oct-2026).
--
-- Antes, para recordar a quien abrió su enlace sin que la pareja marcase
-- «Sí, enviada», el código copiaba la fecha de apertura en
-- invitation_sent_at: el campo «enviado confirmado manualmente» acababa con
-- una fecha deducida (CLAUDE.md: distingue preparado, enviado confirmado y
-- respuesta). Ahora nadie escribe nada: la entrega se DEDUCE al leer.
--
--  * Entrega = coalesce(invitation_sent_at, invitation_opened_at): envío
--    confirmado o, si no, primera apertura del enlace personal (la registra
--    guest_invitation_opened, que ya excluye a los miembros de la boda).
--  * guest_in_filter('para_recordar') (y con él guest_filter_counts,
--    crm_funnel_summary.to_remind, guest_page y reminder_queue), igual que
--    isReminderDue en TS:
--      - sin respuesta, con entrega, con móvil para WhatsApp y sin «no recordar»;
--      - plazo cerrado (fecha límite pasada o, sin ella, el día siguiente a la
--        boda pasado; fechas civiles de Madrid como rsvpWindow) → nadie;
--      - entre recordatorios, 3 días (<=, como TS);
--      - primer recordatorio: 3 días tras la entrega, salvo que la fecha
--        límite termine en 3 días o menos.
--    Así el chip «Para recordar» y /panel/invitados/recordatorios cuadran.
--  * reminder_queue: cambia el tipo de retorno (drop + create, mismos
--    grants): invitation_sent_at devuelve la ENTREGA (nunca NULL: el código
--    desplegado la exige con zod) y se añade al final delivered_by
--    ('sent' | 'opened') para que la fila diga «Abrió su invitación el…».
--    Orden: quien menos recientemente se contactó, primero.
--  * confirm_guest_reminder e issue_guest_token('reminder') aceptan la
--    entrega deducida (antes exigían invitation_sent_at).
--
-- Aditiva y segura en cualquier orden respecto al despliegue: el código
-- desplegado sigue leyendo las mismas columnas (con una más que ignora). Se
-- recomienda aplicarla ANTES de desplegar, para que la fila de recordatorios
-- del código nuevo incluya ya a quien abrió sin envío confirmado.
begin;

-- ------------------------------------------------------------ plazo para recordatorios
-- 'closed' | 'soon' | 'open'. Mismas reglas que rsvpWindow + reminderPeriod (TS).
create or replace function public.reminder_window_state(p_wedding_date date, p_rsvp_deadline date)
returns text
language sql stable set search_path = '' as $$
  select case
    when p_rsvp_deadline is not null then
      case when t.today > p_rsvp_deadline then 'closed'
           when p_rsvp_deadline - t.today <= 3 then 'soon'
           else 'open' end
    when p_wedding_date is not null and t.today > p_wedding_date + 1 then 'closed'
    else 'open'
  end
  from (select (pg_catalog.now() at time zone 'Europe/Madrid')::date as today) t;
$$;
comment on function public.reminder_window_state(date, date) is
  'Plazo visto desde los recordatorios (20261101120000): closed (fecha límite pasada o boda pasada), soon (la fecha límite termina en 3 días o menos) u open. Fechas civiles de Madrid, como rsvpWindow en TS.';
revoke all on function public.reminder_window_state(date, date) from public, anon;
grant execute on function public.reminder_window_state(date, date) to authenticated, service_role;

-- ------------------------------------------------------------ guest_in_filter
-- Mismo cuerpo que 20261009100000 salvo 'para_recordar'.
create or replace function public.guest_in_filter(g public.wedding_guests, p_filter text)
returns boolean language sql stable set search_path = '' as $$
  select case p_filter
    when 'todos' then true
    when 'sin_enviar' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is null
      and g.invitation_opened_at is null
    when 'esperando' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is not null
    when 'para_recordar' then g.rsvp_status = 'pendiente'
      and coalesce(g.invitation_sent_at, g.invitation_opened_at) is not null
      and not g.reminders_opt_out and public.whatsapp_number(g.phone) is not null
      and (g.last_reminder_at is null or g.last_reminder_at <= pg_catalog.now() - interval '3 days')
      and coalesce((
        select case public.reminder_window_state(w.wedding_date, w.rsvp_deadline)
                 when 'closed' then false
                 when 'soon' then true
                 else g.last_reminder_at is not null
                   or coalesce(g.invitation_sent_at, g.invitation_opened_at) <= pg_catalog.now() - interval '3 days'
               end
          from public.weddings w where w.id = g.wedding_id), false)
    when 'vienen' then g.rsvp_status = 'si'
    when 'no_vienen' then g.rsvp_status = 'no'
    when 'sin_telefono' then public.whatsapp_number(g.phone) is null
    when 'con_notas' then coalesce(pg_catalog.btrim(g.rsvp_notes), '') <> ''
    when 'sin_respuesta' then g.rsvp_status = 'pendiente'
    when 'enviada_sin_abrir' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is not null
      and g.invitation_opened_at is null
    when 'abierta_sin_responder' then g.rsvp_status = 'pendiente' and g.invitation_opened_at is not null
    when 'con_regalo' then exists (select 1 from public.wedding_gift_givers gg where gg.guest_id = g.id)
    when 'sin_regalo' then g.gift_none
      and not exists (select 1 from public.wedding_gift_givers gg where gg.guest_id = g.id)
    when 'regalo_sin_indicar' then not g.gift_none
      and not exists (select 1 from public.wedding_gift_givers gg where gg.guest_id = g.id)
    when 'sin_agradecer' then exists (
      select 1 from public.wedding_gift_givers gg join public.wedding_gifts f on f.id = gg.gift_id
       where gg.guest_id = g.id and f.thanked_at is null)
    else false
  end;
$$;
revoke all on function public.guest_in_filter(public.wedding_guests, text) from public, anon;
grant execute on function public.guest_in_filter(public.wedding_guests, text) to authenticated, service_role;

-- ------------------------------------------------------------ reminder_queue
-- Cuerpo de 20261020100000: invitation_sent_at = entrega y + delivered_by al final.
drop function if exists public.reminder_queue(uuid, integer, text, text);
create function public.reminder_queue(p_wedding_id uuid, p_limit integer default 200, p_group text default null, p_tag text default null)
returns table(id uuid, name text, phone text, invitation_sent_at timestamptz,
  last_reminder_at timestamptz, reminder_count integer, total_count bigint, group_name text, tags text[],
  delivered_by text)
language sql stable security invoker set search_path = '' as $$
  select g.id, g.name, g.phone, coalesce(g.invitation_sent_at, g.invitation_opened_at),
    g.last_reminder_at, g.reminder_count, count(*) over (), g.group_name, g.tags,
    case when g.invitation_sent_at is not null then 'sent' else 'opened' end
  from public.wedding_guests g
  join public.weddings w on w.id = g.wedding_id
  where g.wedding_id = p_wedding_id and (select public.owns_wedding(p_wedding_id))
    and public.guest_in_filter(g, 'para_recordar')
    and (p_group is null or g.group_name = p_group)
    and (p_tag is null or g.tags @> array[p_tag])
  order by coalesce(g.last_reminder_at, g.invitation_sent_at, g.invitation_opened_at), g.id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;
comment on function public.reminder_queue(uuid, integer, text, text) is
  'Fila de recordatorios (guest_in_filter para_recordar). invitation_sent_at = entrega: envío confirmado o, si no, primera apertura (delivered_by dice cuál; 20261101120000).';
revoke all on function public.reminder_queue(uuid, integer, text, text) from public, anon;
grant execute on function public.reminder_queue(uuid, integer, text, text) to authenticated, service_role;

-- ------------------------------------------------------------ confirm_guest_reminder
-- Cuerpo de 20261015100000 aceptando la entrega deducida.
create or replace function public.confirm_guest_reminder(p_guest_id uuid)
 returns table(last_reminder_at timestamp with time zone, reminder_count integer)
 language sql
 set search_path to ''
as $function$
  update public.wedding_guests g
     set last_reminder_at = case when g.last_reminder_at > pg_catalog.now() - interval '60 seconds'
                                 then g.last_reminder_at else pg_catalog.now() end,
         reminder_count = case when g.last_reminder_at > pg_catalog.now() - interval '60 seconds'
                               then g.reminder_count else g.reminder_count + 1 end
    from public.weddings w
   where g.id = p_guest_id and w.id = g.wedding_id and public.owns_wedding(w.id)
     and coalesce(g.invitation_sent_at, g.invitation_opened_at) is not null
  returning g.last_reminder_at, g.reminder_count;
$function$;
revoke all on function public.confirm_guest_reminder(uuid) from public, anon;
grant execute on function public.confirm_guest_reminder(uuid) to authenticated, service_role;

-- ------------------------------------------------------------ issue_guest_token
-- Cuerpo de 20261022100000; 'reminder' acepta la entrega deducida. 'invite' y
-- 'regenerate' no cambian (siguen mirando solo el envío confirmado).
create or replace function public.issue_guest_token(p_guest_id uuid, p_token_hash text, p_mode text)
 returns table(token_id uuid)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_wedding uuid;
  v_sent timestamptz;
  v_opened timestamptz;
  v_now timestamptz := pg_catalog.now();
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_mode not in ('regenerate', 'reminder', 'invite') then
    return;
  end if;
  select g.wedding_id, g.invitation_sent_at, g.invitation_opened_at into v_wedding, v_sent, v_opened
    from public.wedding_guests g join public.weddings w on w.id = g.wedding_id
   where g.id = p_guest_id and public.owns_wedding(w.id)
   for update of g;
  if v_wedding is null then return; end if;

  if p_mode = 'reminder' then
    if coalesce(v_sent, v_opened) is null then return; end if;
  elsif p_mode = 'invite' then
    if v_sent is not null then return; end if;
    update public.wedding_guests g
       set invitation_prepared_at = coalesce(g.invitation_prepared_at, v_now),
           invitation_token_hash = coalesce(g.invitation_token_hash, p_token_hash)
     where g.id = p_guest_id;
  else
    update public.wedding_guest_tokens t set revoked_at = v_now
     where t.guest_id = p_guest_id and t.revoked_at is null;
    update public.wedding_guests g
       set invitation_token_hash = p_token_hash, invitation_prepared_at = v_now, invitation_sent_at = null
     where g.id = p_guest_id;
  end if;

  return query
    insert into public.wedding_guest_tokens (guest_id, wedding_id, token_hash, created_at)
    values (p_guest_id, v_wedding, p_token_hash, v_now)
    returning id;
end;
$function$;
revoke all on function public.issue_guest_token(uuid, text, text) from public, anon;
grant execute on function public.issue_guest_token(uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
