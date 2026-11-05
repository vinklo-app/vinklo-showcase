-- Cierre de fuga de datos (2026-07-14): las vistas públicas eran definer
-- (security_invoker=false, saltan RLS) SIN filtro por fila y otorgadas a
-- `anon` Y `authenticated`. Como el Data API de Supabase acepta la anon key
-- (pública, va en el bundle), cualquiera podía volcar TODA la base de
-- clientes —nombres, fechas, direcciones— sin autenticar; y cualquier
-- usuario registrado, con más razón.
--
-- El grant estaba MUERTO: el único lector de estas vistas es el servidor
-- (app/b/[slug]/wedding-public.ts y lib/track.ts) vía service role, que
-- ignora estos grants. Revocar de ambos roles no rompe nada.
--
-- IMPORTANTE: revocar de anon Y authenticated (un revoke solo de anon deja
-- la vista volcable por cualquier cuenta registrada). Aplicado a prod vía
-- `supabase db query --linked` el 2026-07-14; verificado 401 a anon.

revoke select on public.weddings_public from anon, authenticated;
revoke select on public.wedding_agenda_public from anon, authenticated;

-- Nota sobre bizum_phone: sigue en la definición de weddings_public, pero ya
-- no se expone (la vista queda sin acceso para anon/authenticated) y su valor
-- es null en todas las filas (Bizum retirado del producto). No se quita aquí
-- porque `create or replace view` no permite eliminar columnas (error 42P16,
-- exige drop+create); se dejará para una migración dedicada si hace falta.
