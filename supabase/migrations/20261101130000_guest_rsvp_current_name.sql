-- Saludo por nombre en el enlace personal (revisión de producto, ítem 11;
-- bloque 3 «experiencia del invitado», 17-oct-2026). ADITIVA: se puede aplicar
-- antes o después de desplegar el código; el código anterior ignora la clave
-- nueva y el nuevo, sin ella, no saluda por nombre («Tienes una invitación»).
--
-- guest_rsvp_current (misma firma, mismos permisos, cuerpo de 20261101110000):
--  * Añade 'guest_name' cuando el enlace es válido y el plazo sigue abierto
--    (pendiente o con respuesta): el `name` de la ficha del PROPIO titular del
--    token. Nunca nombres de acompañantes (siguen sin devolverse, M1) ni de
--    otros invitados.
--  * Decisión de privacidad: quien tenga el enlace (también si se reenvía) verá
--    el nombre de pila del invitado al que se envió. La página
--    (app/b/[slug]/page.tsx) lo reduce con firstName() a «Carmen» antes de
--    pintarlo; el nombre completo se queda en el servidor.
--  * Con el plazo cerrado sigue devolviendo {"closed": true} y nada más.
begin;

create or replace function public.guest_rsvp_current(p_slug text, p_token_hash text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_wedding_id uuid;
  v_wedding_date date;
  v_rsvp_deadline date;
  v_guest_id uuid;
  v_token_created timestamptz;
  v_row record;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$'
     or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select w.id, w.wedding_date, w.rsvp_deadline into v_wedding_id, v_wedding_date, v_rsvp_deadline
    from public.weddings w where w.slug = p_slug;
  if v_wedding_id is null then return null; end if;
  -- El token solo vale dentro de SU boda y si sigue activo.
  select t.guest_id, t.created_at into v_guest_id, v_token_created
    from public.wedding_guest_tokens t
   where t.wedding_id = v_wedding_id and t.token_hash = p_token_hash and t.revoked_at is null;
  if v_guest_id is null then return null; end if;

  -- Plazo cerrado: el enlace es válido pero ya no hay nada que rellenar.
  if pg_catalog.now() >= public.guest_rsvp_closes_at(v_wedding_date, v_rsvp_deadline, v_token_created) then
    return pg_catalog.jsonb_build_object('closed', true);
  end if;

  select g.name, g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.rsvp_notes_by_guest, g.rsvp_logistic_notes,
         g.health_consent_at, g.rsvp_answers, g.responded_at, g.max_companions
    into v_row
    from public.wedding_guests g
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  if not found then return null; end if;

  -- Pendiente: sin respuesta que rellenar (nada de la ficha), solo el tope.
  if v_row.rsvp_status is null or v_row.rsvp_status not in ('si', 'no') then
    return pg_catalog.jsonb_build_object('status', null, 'max_companions', v_row.max_companions,
      'guest_name', nullif(pg_catalog.btrim(v_row.name), ''));
  end if;

  return pg_catalog.jsonb_build_object(
    'max_companions', v_row.max_companions,
    -- 20261101130000: el nombre de la ficha del PROPIO titular del token (nunca
    -- de acompañantes ni de otros invitados). La página solo pasa al HTML su
    -- nombre de pila (firstName); el nombre completo no sale del servidor.
    'guest_name', nullif(pg_catalog.btrim(v_row.name), ''),
    'status', v_row.rsvp_status,
    'companions', coalesce(v_row.rsvp_companions, 0),
    -- Solo si la nota es SUYA (la pareja usa el mismo campo para apuntes
    -- privados) y nunca su texto: es un dato de salud.
    'has_health_note', coalesce(v_row.rsvp_notes_by_guest and v_row.rsvp_notes is not null, false),
    'health_consent_at', case when v_row.rsvp_notes_by_guest and v_row.rsvp_notes is not null then v_row.health_consent_at end,
    'has_logistic_note', v_row.rsvp_logistic_notes is not null,
    'has_companion_names', v_row.rsvp_status = 'si' and exists (
      select 1 from public.wedding_guest_companions c
       where c.guest_id = v_guest_id and c.wedding_id = v_wedding_id and c.by_guest),
    'answers', v_row.rsvp_answers,
    'responded_at', v_row.responded_at
  );
end;
$$;
comment on function public.guest_rsvp_current(text, text) is
  'Lo que el formulario del enlace personal rellena sin riesgo: asistencia, acompañantes, tope, módulos, booleanos has_health_note / has_logistic_note / has_companion_names y guest_name (nombre de la ficha del propio titular, 20261101130000), nunca textos privados; {"closed": true} con el plazo cerrado; NULL si el enlace no es válido. Solo service_role (página /b/[slug]).';
revoke all on function public.guest_rsvp_current(text, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_current(text, text) to service_role;

notify pgrst, 'reload schema';
commit;
