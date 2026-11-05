-- Paridad del contrato SiteDocument (P0-2 de la revisión del 14-oct-2026):
-- el mismo corpus que valida Zod en lib/site-document.sql-parity.test.ts
-- (tests/contract/site-document-cases.json) pasa aquí por
-- public.site_document_issue; cada caso debe dar el veredicto `valid`.
-- Solo una base DE PRUEBAS vacía con todas las migraciones; scripts/test-sql.sh
-- la ejecuta desde la raíz del repo (la ruta del corpus es relativa a ella).
-- Sin escrituras persistentes: todo se revierte con ROLLBACK.
\set ON_ERROR_STOP 1
\set corpus `cat tests/contract/site-document-cases.json`
begin;
create temp table parity_corpus as select :'corpus'::jsonb as body;

do $$
declare
  c jsonb;
  v_issue text;
  v_total integer := 0;
  v_bad text[] := '{}';
begin
  for c in select e from parity_corpus, pg_catalog.jsonb_array_elements(body -> 'cases') e loop
    v_total := v_total + 1;
    v_issue := public.site_document_issue(c -> 'doc');
    if (v_issue is null) <> (c ->> 'valid')::boolean then
      v_bad := v_bad || format('%s (esperado %s, SQL: %s)', c ->> 'name',
        case when (c ->> 'valid')::boolean then 'válido' else 'inválido' end,
        coalesce(v_issue, 'válido'));
    end if;
  end loop;
  if v_total < 10 then raise exception 'Corpus vacío o ilegible (% casos)', v_total; end if;
  if pg_catalog.array_length(v_bad, 1) > 0 then
    raise exception 'Zod y SQL discrepan en % de % casos: %', pg_catalog.array_length(v_bad, 1), v_total, pg_catalog.array_to_string(v_bad, '; ');
  end if;
end $$;

rollback;
