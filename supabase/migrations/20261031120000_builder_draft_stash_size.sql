-- Copia del borrador del creador (builder_draft_stash): más sitio para el
-- contenido que la pareja pide al chat «Pedid cambios» (13-oct-2026).
-- Preparada en local. NO aplicada en remoto.
--
-- Desde este cambio el borrador guarda también el contenido de las secciones
-- que cambió la IA (programa, historia, detalles, preguntas, autobuses y
-- alojamiento; `sections`, lib/creator-sections.ts). Con 16 KB, un borrador
-- con muchas preguntas largas no cabía y la copia del servidor fallaba en
-- silencio. El documento de la web tiene un tope de 48 KB
-- (SITE_DOCUMENT_MAX_BYTES), así que 64 KB cubre el borrador con holgura.
--
-- Sin esta migración el código sigue funcionando: si la copia no cabe, se
-- guarda sin ese contenido (lib/actions/builder-stash.ts) y en el navegador
-- donde se pidió sigue entero.
begin;

alter table public.builder_draft_stash drop constraint if exists builder_draft_stash_draft_check;
alter table public.builder_draft_stash
  add constraint builder_draft_stash_draft_check
  check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 65536);

commit;
