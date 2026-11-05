-- Enlace personal sin datos privados, PASO 2 de 2 (revisión de seguridad M1,
-- 14-oct-2026; revisión del bloque 1, F1 y F5). Se aplica DESPUÉS de
-- desplegar el código que llama a la sobrecarga de 10 (20261101100000).
--
-- guest_rsvp_current (misma firma, mismos permisos):
--  * Ya no devuelve textos privados: ni 'notes' (salud), ni 'logistic_notes',
--    ni 'companion_list', ni 'health_consent_version'. Solo los booleanos del
--    paso 1: has_health_note (solo si la nota es del propio invitado: los
--    apuntes de la pareja siguen sin existir para él), has_logistic_note y
--    has_companion_names (solo nombres que escribió él). health_consent_at se
--    devuelve solo junto a su nota (fecha, no contenido).
--  * Sigue devolviendo lo que el formulario rellena sin riesgo: asistencia,
--    número de acompañantes, tope, respuestas de módulos (autobús,
--    alojamiento, menú, niños, canción) y responded_at.
--  * Con el plazo cerrado (guest_rsvp_closes_at: fecha límite de la pareja o
--    boda pasada) devuelve {"closed": true} y nada más. Nunca NULL para un
--    enlace válido: NULL significa «enlace no válido o revocado».
--
-- guest_rsvp_respond (9): pasa a envoltorio de la de 10 SIN pérdida de datos.
-- Tras este paso ningún formulario recibe ya los textos, así que si un
-- llamante antiguo (una instancia del despliegue anterior que siga viva) la
-- usara, un campo en blanco NO puede significar «bórralo»:
--  * nota de salud en blanco → se conserva la del invitado (keep = true);
--  * nota logística en blanco → NULL = no se toca;
--  * «sí» con lista de nombres vacía → NULL = no se tocan.
-- Lo que sí llega escrito se guarda como siempre. Con «no» la de 10 borra la
-- nota de salud del invitado (minimización) y la lista vacía sigue quitando
-- sus nombres, como hasta ahora. Las de 7 y 5 encadenan con esta.
begin;

-- ------------------------------------------------------------ guest_rsvp_respond (9)
create or replace function public.guest_rsvp_respond(
  p_slug text,
  p_token_hash text,
  p_status text,
  p_companions integer,
  p_health_notes text,
  p_logistic_notes text,
  p_health_consent_version text,
  p_answers jsonb,
  p_companion_list jsonb
) returns text
language sql volatile security definer set search_path = '' as $$
  select public.guest_rsvp_respond(
    p_slug, p_token_hash, p_status, p_companions,
    p_health_notes,
    nullif(pg_catalog.btrim(p_logistic_notes), ''),
    p_health_consent_version,
    p_answers,
    case
      when p_status = 'si' and p_companion_list is not null
           and pg_catalog.jsonb_typeof(p_companion_list) = 'array'
           and pg_catalog.jsonb_array_length(p_companion_list) = 0 then null::jsonb
      else p_companion_list
    end,
    true);
$$;
comment on function public.guest_rsvp_respond(text, text, text, integer, text, text, text, jsonb, jsonb) is
  'Envoltorio (20261101110000) de la de 10 para llamantes antiguos: en blanco nunca borra (salud conservada, logística y nombres NULL = no se tocan). Solo service_role.';
revoke all on function public.guest_rsvp_respond(text, text, text, integer, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.guest_rsvp_respond(text, text, text, integer, text, text, text, jsonb, jsonb) to service_role;

-- ------------------------------------------------------------ guest_rsvp_current
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

  select g.rsvp_status, g.rsvp_companions, g.rsvp_notes, g.rsvp_notes_by_guest, g.rsvp_logistic_notes,
         g.health_consent_at, g.rsvp_answers, g.responded_at, g.max_companions
    into v_row
    from public.wedding_guests g
   where g.id = v_guest_id and g.wedding_id = v_wedding_id;
  if not found then return null; end if;

  -- Pendiente: sin respuesta que rellenar (nada de la ficha), solo el tope.
  if v_row.rsvp_status is null or v_row.rsvp_status not in ('si', 'no') then
    return pg_catalog.jsonb_build_object('status', null, 'max_companions', v_row.max_companions);
  end if;

  return pg_catalog.jsonb_build_object(
    'max_companions', v_row.max_companions,
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
  'Lo que el formulario del enlace personal rellena sin riesgo: asistencia, acompañantes, tope, módulos y booleanos has_health_note / has_logistic_note / has_companion_names, nunca textos privados; {"closed": true} con el plazo cerrado; NULL si el enlace no es válido (20261101110000, paso 2 de 2). Solo service_role (página /b/[slug]).';
revoke all on function public.guest_rsvp_current(text, text) from public, anon, authenticated;
grant execute on function public.guest_rsvp_current(text, text) to service_role;

notify pgrst, 'reload schema';
commit;
