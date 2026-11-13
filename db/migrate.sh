#!/bin/sh
# Runner oficial de migrations. Fonte unica: db/migrations/V*.sql (ordem alfabetica = ordem de versao).
# Controle em schema_migrations (versao + checksum). Cada arquivo ja traz seu proprio BEGIN/COMMIT.
# Conexao via PGHOST/PGUSER/PGPASSWORD/PGDATABASE. Idempotente: pode rodar a cada "up".
set -eu

DIR="${MIGRATIONS_DIR:-/migrations}"
PSQL="psql -v ON_ERROR_STOP=1 -X -q -t -A"

$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  versao      TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);"

# Baseline: bancos criados antes do runner (V001/V002 via initdb.d) ja tem as tabelas base.
if [ "$($PSQL -c "SELECT count(*) FROM schema_migrations")" = "0" ] \
   && [ "$($PSQL -c "SELECT to_regclass('public.usuarios') IS NOT NULL")" = "t" ]; then
  for f in "$DIR"/V001__*.sql "$DIR"/V002__*.sql; do
    [ -f "$f" ] || continue
    v=$(basename "$f" .sql); c=$(sha256sum "$f" | cut -d' ' -f1)
    echo "[migrate] baseline: $v"
    $PSQL -c "INSERT INTO schema_migrations (versao, checksum) VALUES ('$v', '$c') ON CONFLICT DO NOTHING;"
  done
fi

applied=0
for f in $(ls "$DIR"/V*.sql 2>/dev/null | sort); do
  v=$(basename "$f" .sql)
  c=$(sha256sum "$f" | cut -d' ' -f1)
  old=$($PSQL -c "SELECT checksum FROM schema_migrations WHERE versao = '$v'")
  if [ -n "$old" ]; then
    if [ "$old" != "$c" ]; then
      echo "[migrate] ERRO: $v foi alterada apos aplicada. Crie uma nova versao (V00N) em vez de editar." >&2
      exit 1
    fi
    continue
  fi
  echo "[migrate] aplicando: $v"
  $PSQL -f "$f"
  $PSQL -c "INSERT INTO schema_migrations (versao, checksum) VALUES ('$v', '$c');"
  applied=$((applied + 1))
done

echo "[migrate] concluido ($applied nova(s) migration(s))."

if [ -f "/db/seed.sql" ]; then
  echo "[migrate] executando seed..."
  $PSQL -f "/db/seed.sql"
fi

if [ -f "/db/seed_portfolio.sql" ] && [ "${SEED_PORTFOLIO:-true}" = "true" ]; then
  echo "[migrate] executando seed_portfolio..."
  $PSQL -f "/db/seed_portfolio.sql"
fi
