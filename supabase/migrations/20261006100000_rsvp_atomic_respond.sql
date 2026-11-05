-- RSVP con enlace personal: respuesta atómica y cierre operativo
-- (auditoría integral 2026-10-04, hallazgos H03 y H11).
-- Preparada y verificada en Postgres temporal. NO aplicada en remoto.
--
-- H03 — Antes, submitRsvp leía el token activo y actualizaba el invitado en
-- dos peticiones distintas: un «Regenerar enlace» entre ambas dejaba que el
-- enlace antiguo guardase la respuesta. Ahora todo ocurre en UNA transacción
-- (guest_rsvp_respond), con el mismo orden de locks que issue_guest_token:
--   1) fila de wedding_guests FOR UPDATE   (issue_guest_token también la toma
--      primero, antes de revocar tokens; borrar el invitado también)
--   2) token re-leído con revoked_at is null FOR SHARE, en otra sentencia
--      (snapshot nuevo): si la revocación se confirmó mientras esperábamos el
--      lock, aquí ya se ve y la respuesta se rechaza.
--   3) wedding_sites FOR SHARE: una web retirada no acepta respuestas
--      (wedding_site_unpublish/publish esperan o se ven confirmados).
-- Política explícita de la carrera:
--   * Revocar y responder se serializan. Si la respuesta adquiere el lock
--     antes, se guarda y la revocación posterior no la deshace (la respuesta
--     llegó con un enlace válido en ese momento). Si la revocación llega
--     antes, el enlace antiguo ya no guarda nada.
--   * Dos pestañas/dispositivos del mismo invitado: se serializan por el lock
--     de la fila y la ÚLTIMA respuesta confirmada manda (last-write-wins). No
--     hay mezcla de campos: cada respuesta escribe estado, acompañantes y
--     notas a la vez.
--
-- H11 — Cierre operativo de los enlaces personales (decisión 2026-10-06):
--   * Con fecha de boda (weddings.wedding_date, que publicar sincroniza desde
--     la portada): se aceptan respuestas hasta el final del día SIGUIENTE a la
--     boda, hora de Madrid. Margen de un día para respuestas tardías y husos.
--     Si la pareja cambia la fecha, el cierre se mueve con ella.
--   * Sin fecha: el enlace caduca 365 días después de emitirse.
--   Los enlaces existentes de bodas futuras siguen funcionando igual. Al
--   aplicar en producción, las bodas cuya fecha ya pasó (más el margen) dejan
--   de aceptar respuestas: es intencionado.
--   * Límite agregado por boda contado SOLO para tokens válidos (después de
--     validar el token, dentro de la transacción): 600 respuestas/hora. Así el
--     spam de tokens inventados no consume el cupo de los invitados reales.
--     Los límites por token e IP van en lib/actions/rsvp.ts (rl_check).
--
-- Solo service_role ejecuta la RPC (el invitado no tiene sesión; la server
-- action valida con Zod y llama con el cliente admin). El token en claro no
-- llega a la base: solo su SHA-256.
begin;

create or replace function public.guest_rsvp_closes_at(p_wedding_date date, p_token_created_at timestamptz)
returns timestamptz
language sql stable parallel safe set search_path = '' as $$
  select case
    when p_wedding_date is not null
      then ((p_wedding_date + 2)::timestamp at time zone 'Europe/Madrid')
    else p_token_created_at + interval '365 days'
  end;
$$;
comment on function public.guest_rsvp_closes_at(date, timestamptz) is
  'Momento en que un enlace personal deja de aceptar respuestas: fin del día siguiente a la boda (Europe/Madrid) o, sin fecha, 365 días tras emitir el token.';
revoke all on function public.guest_rsvp_closes_at(date, timestamptz) from public, anon, authenticated;
grant execute on function public.guest_rsvp_closes_at(date, timestamptz) to service_role;

-- Resultado (texto, nunca lanza por datos del invitado):
--   ok            respuesta guardada
--   invalid       datos fuera de contrato (la server action ya los valida)
--   unavailable   boda inexistente, token inexistente/revocado/de otra boda,
--                 o invitado borrado (misma respuesta: no enumera)
--   withdrawn     la pareja retiró la web
--   closed        enlace fuera de plazo (guest_rsvp_closes_at)
--   rate_limited  límite agregado de la boda superado
create or replace function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_notes text
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_wedding_id uuid;
  v_wedding_date date;
  v_guest_id uuid;
  v_token_created timestamptz;
  v_published_at timestamptz;
  v_revision uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_status is null or p_status not in ('si', 'no')
     or p_companions is null or p_companions < 0 or p_companions > 10
     or (p_notes is not null and pg_catalog.char_length(p_notes) > 500) then
    return 'invalid';
  end if;

  select w.id, w.wedding_date into v_wedding_id, v_wedding_date
    from public.weddings w where w.slug = p_slug;
  if v_wedding_id is null then return 'unavailable'; end if;

  -- Localiza el invitado (sin lock: aún no conocemos la fila a bloquear).
  select t.guest_id into v_guest_id
    from public.wedding_guest_tokens t
   where t.wedding_id = v_wedding_id and t.token_hash = p_token_hash and t.revoked_at is null;
  if v_guest_id is null then return 'unavailable'; end if;

  -- 1) Lock del invitado: mismo primer lock que issue_guest_token.
  perform 1 from public.wedding_guests g
    where g.id = v_guest_id and g.wedding_id = v_wedding_id
    for update;
  if not found then return 'unavailable'; end if;

  -- 2) Re-lectura del token bajo el lock (snapshot nuevo) + FOR SHARE: una
  --    revocación confirmada mientras esperábamos ya es visible aquí.
  select t.created_at into v_token_created
    from public.wedding_guest_tokens t
   where t.token_hash = p_token_hash and t.wedding_id = v_wedding_id
     and t.guest_id = v_guest_id and t.revoked_at is null
   for share;
  if not found then return 'unavailable'; end if;

  -- 3) Web retirada (publicada alguna vez y sin revisión vigente). Sin fila o
  --    nunca publicada = boda servida por el adaptador v1: se acepta, como en
  --    getPublicSite (que además valida el documento antes de llegar aquí).
  select s.published_at, s.published_revision_id into v_published_at, v_revision
    from public.wedding_sites s where s.wedding_id = v_wedding_id
    for share;
  if found and v_published_at is not null and v_revision is null then return 'withdrawn'; end if;

  if pg_catalog.now() >= public.guest_rsvp_closes_at(v_wedding_date, v_token_created) then
    return 'closed';
  end if;

  if not public.rl_check(
    'rsvp-wedding:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_wedding_id::text, 'UTF8')), 'hex'),
    600, 3600) then
    return 'rate_limited';
  end if;

  update public.wedding_guests g
     set rsvp_status = p_status,
         rsvp_companions = case when p_status = 'si' then p_companions else 0 end,
         rsvp_notes = nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
         updated_at = pg_catalog.now()
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  return 'ok';
end;
$$;
comment on function public.guest_rsvp_respond(text, text, text, integer, text) is
  'Respuesta RSVP con enlace personal en una transacción: lock del invitado, token activo re-leído bajo lock, web no retirada, plazo y límite por boda. Solo service_role.';
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text) to service_role;

commit;
