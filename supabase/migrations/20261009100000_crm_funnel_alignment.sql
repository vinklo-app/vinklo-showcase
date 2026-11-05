-- CRM: el embudo y los filtros cuentan lo mismo (2026-10-05).
-- 1) «Sin enviar» excluye a quien ya abrió su enlace (si lo abrió, le llegó),
--    igual que el cubo not_sent del embudo.
-- 2) to_remind = exactamente el filtro «para_recordar» (la misma cola que
--    /panel/invitados/recordatorios): el aviso del resumen ya no muestra un
--    número distinto al de esa pantalla.
-- Solo reemplaza dos funciones (misma firma); no toca datos.
begin;

create or replace function public.guest_in_filter(g public.wedding_guests, p_filter text)
returns boolean language sql stable set search_path = '' as $$
  select case p_filter
    when 'todos' then true
    when 'sin_enviar' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is null
      and g.invitation_opened_at is null
    when 'esperando' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is not null
    when 'para_recordar' then g.rsvp_status = 'pendiente' and g.invitation_sent_at is not null
      and not g.reminders_opt_out and public.whatsapp_number(g.phone) is not null
      and (g.last_reminder_at is null or g.last_reminder_at < pg_catalog.now() - interval '3 days')
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

create or replace function public.crm_funnel_summary(p_wedding_id uuid)
returns table(added bigint, prepared bigint, sent bigint, opened bigint, responded bigint,
  yes bigint, no bigint, attendees bigint, not_sent bigint, sent_unopened bigint,
  opened_unanswered bigint, to_remind bigint)
language sql stable security invoker set search_path = '' as $$
  select count(g.id),
    count(g.id) filter (where g.rsvp_status <> 'pendiente' or g.invitation_opened_at is not null
      or g.invitation_sent_at is not null or g.invitation_prepared_at is not null),
    count(g.id) filter (where g.rsvp_status <> 'pendiente' or g.invitation_opened_at is not null
      or g.invitation_sent_at is not null),
    count(g.id) filter (where g.rsvp_status <> 'pendiente' or g.invitation_opened_at is not null),
    count(g.id) filter (where g.rsvp_status <> 'pendiente'),
    count(g.id) filter (where g.rsvp_status = 'si'),
    count(g.id) filter (where g.rsvp_status = 'no'),
    (count(g.id) filter (where g.rsvp_status = 'si')
      + coalesce(sum(g.rsvp_companions) filter (where g.rsvp_status = 'si'), 0))::bigint,
    count(g.id) filter (where g.rsvp_status = 'pendiente' and g.invitation_sent_at is null
      and g.invitation_opened_at is null),
    count(g.id) filter (where g.rsvp_status = 'pendiente' and g.invitation_sent_at is not null
      and g.invitation_opened_at is null),
    count(g.id) filter (where g.rsvp_status = 'pendiente' and g.invitation_opened_at is not null),
    count(g.id) filter (where public.guest_in_filter(g, 'para_recordar'))
  from public.weddings w left join public.wedding_guests g on g.wedding_id = w.id
  where w.id = p_wedding_id and w.couple_id = (select auth.uid())
  group by w.id;
$$;

commit;
