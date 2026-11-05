#!/usr/bin/env bash
# Tipos de la base (lib/supabase/database.types.ts) generados desde una base de
# PRUEBAS con todas las migraciones aplicadas (nunca producción). Es el mismo
# generador que `supabase gen types typescript --db-url … --schema public`
# (postgres-meta 0.96.6, el de Supabase CLI 2.109.1), pero sin Docker: se
# instala desde scripts/db-types con su lockfile, que fija también el
# formateador. Uso, tras scripts/test-sql.sh (cada suite se revierte):
#   TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/vinklo_test scripts/gen-db-types.sh          # escribe
#   TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/vinklo_test scripts/gen-db-types.sh --check  # CI: falla si difiere
set -euo pipefail
: "${TEST_DATABASE_URL:?Falta TEST_DATABASE_URL (base de pruebas con las migraciones; ver scripts/test-sql.sh)}"
case "$TEST_DATABASE_URL" in *supabase.co*|*pooler.supabase*) echo "Rechazado: parece una base de Supabase real." >&2; exit 2;; esac
mode="write"
case "${1:-}" in "") ;; --check) mode="check" ;; *) echo "Uso: $0 [--check]" >&2; exit 2;; esac

cd "$(dirname "$0")/.."
root="$(pwd)"
target="lib/supabase/database.types.ts"
out=""; log=""; tmp_tool_dir=""
trap 'rm -f "$out" "$log"; [ -z "$tmp_tool_dir" ] || rm -rf "$tmp_tool_dir"' EXIT

# Herramienta fuera del repo, en la caché de ESTE usuario (nunca en un /tmp
# compartido: se ejecuta su node_modules); se reutiliza mientras no cambie el
# lockfile. Solo se reutiliza un directorio propio y no escribible por grupo
# ni por otros; si no, se instala en uno nuevo de mktemp.
lock_hash="$(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex").slice(0,16))' scripts/db-types/package-lock.json)"
tool_dir="${DB_TYPES_TOOL_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/vinklo-db-types-${lock_hash}}"
safe_dir() {
  [ -d "$1" ] && [ ! -L "$1" ] && [ -O "$1" ] && [ -z "$(find "$1" -maxdepth 0 \( -perm -g+w -o -perm -o+w \))" ]
}
if [ -e "$tool_dir" ] && ! safe_dir "$tool_dir"; then
  echo "Aviso: $tool_dir no es tuyo o es escribible por otros; se instala en un directorio temporal nuevo." >&2
  tool_dir="$(mktemp -d)"
  tmp_tool_dir="$tool_dir"
fi
if [ ! -e "$tool_dir" ]; then
  mkdir -p "$(dirname "$tool_dir")"
  mkdir -m 700 "$tool_dir"
fi
server="$tool_dir/node_modules/@supabase/postgres-meta/dist/server/server.js"
if [ ! -f "$server" ]; then
  cp scripts/db-types/package.json scripts/db-types/package-lock.json "$tool_dir/"
  (cd "$tool_dir" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error)
fi

out="$(mktemp)"; log="$(mktemp)"
{
  echo "// Generado por scripts/gen-db-types.sh desde supabase/migrations (no editar a mano)."
  echo "// Regenerar: TEST_DATABASE_URL=… scripts/test-sql.sh && TEST_DATABASE_URL=… scripts/gen-db-types.sh"
  echo
  # Mismas variables que pasa `supabase gen types` a la imagen de postgres-meta.
  (cd "$tool_dir" && \
    PG_META_DB_URL="$TEST_DATABASE_URL" \
    PG_CONN_TIMEOUT_SECS=15 \
    PG_QUERY_TIMEOUT_SECS=15 \
    PG_META_GENERATE_TYPES=typescript \
    PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public \
    PG_META_GENERATE_TYPES_SWIFT_ACCESS_CONTROL=internal \
    PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true \
    node "$server" 2> "$log")
} > "$out" || { cat "$log" >&2; echo "Falló la generación de tipos." >&2; exit 1; }
if ! grep -q "^export type Database = {" "$out"; then
  cat "$log" >&2; echo "La salida no parece un fichero de tipos de Supabase." >&2; exit 1
fi

if [ "$mode" = "check" ]; then
  if ! diff -u "$root/$target" "$out"; then
    echo "::error file=$target::Los tipos de la base no coinciden con las migraciones. Regenera con scripts/gen-db-types.sh (ver cabecera) y súbelos." >&2
    exit 1
  fi
  echo "ok   $target al día con las migraciones"
else
  cp "$out" "$root/$target"
  echo "Escrito $target ($(wc -l < "$root/$target" | tr -d ' ') líneas)"
fi
