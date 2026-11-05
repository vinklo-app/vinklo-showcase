#!/usr/bin/env bash
# Suites SQL contra una base de PRUEBAS vacía (nunca producción).
# Aplica el shim mínimo de Supabase, todas las migraciones en orden y cada
# tests/sql/*.sql (cada suite se revierte con ROLLBACK).
#   TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/vinklo_test scripts/test-sql.sh
set -euo pipefail
: "${TEST_DATABASE_URL:?Falta TEST_DATABASE_URL (base de pruebas vacía)}"
case "$TEST_DATABASE_URL" in *supabase.co*|*pooler.supabase*) echo "Rechazado: parece una base de Supabase real." >&2; exit 2;; esac
cd "$(dirname "$0")/.."
run() { psql -v ON_ERROR_STOP=1 -q -X "$TEST_DATABASE_URL" -f "$1" > /dev/null; }
run tests/sql/setup/supabase-shim.sql
for f in supabase/migrations/*.sql; do run "$f"; done
echo "Migraciones aplicadas: $(ls supabase/migrations/*.sql | wc -l | tr -d ' ')"
fail=0
for f in tests/sql/*.sql; do
  if out=$(psql -v ON_ERROR_STOP=1 -q -X "$TEST_DATABASE_URL" -f "$f" 2>&1); then echo "ok   $f"; else echo "FAIL $f"; echo "$out" | tail -5; fail=1; fi
done
exit $fail
