-- Envío en serie de la primera invitación (plan maestro §4.1, 2026-10-22).
-- `issue_guest_token` admite un tercer modo, 'invite': AÑADE un enlace
-- personal sin revocar los que ya tenga la persona, deja la invitación
-- preparada (invitation_prepared_at si no lo estaba) y NO toca
-- invitation_sent_at. Solo para quien aún no tiene el envío confirmado (con
-- el envío confirmado está 'reminder').
--
-- Por qué: en la fila de envío la pareja puede abrir WhatsApp dos veces para
-- la misma persona (iOS recarga la página al volver y el enlace no se guarda
-- en ningún sitio). Con 'regenerate', el segundo enlace revocaría el primero,
-- que quizá ya está en el chat. Y a quien tiene un enlace preparado sin
-- confirmar (quizá ya enviado) no se le puede dejar sin acceso.
--
-- Aditiva: misma firma (create or replace conserva los grants, una sola
-- sobrecarga) y los modos 'regenerate' y 'reminder' quedan exactamente igual.
-- El código anterior nunca pide 'invite'. Debe aplicarse ANTES del código que
-- lo pide (sin ella, el servidor cae a 'regenerate' solo si no hay enlace).
-- Mismo cuerpo que 20261015100000 añadiendo la rama 'invite'.
begin;
create or replace function public.issue_guest_token(p_guest_id uuid, p_token_hash text, p_mode text)
 returns table(token_id uuid)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_wedding uuid;
  v_sent timestamptz;
  v_now timestamptz := pg_catalog.now();
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_mode not in ('regenerate', 'reminder', 'invite') then
    return;
  end if;
  select g.wedding_id, g.invitation_sent_at into v_wedding, v_sent
    from public.wedding_guests g join public.weddings w on w.id = g.wedding_id
   where g.id = p_guest_id and public.owns_wedding(w.id)
   for update of g;
  if v_wedding is null then return; end if;

  if p_mode = 'reminder' then
    if v_sent is null then return; end if;
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
commit;
