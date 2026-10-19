#!/usr/bin/env bash
#
# Start dml-utils-viewer against the local dml_utils development database.
#
# That database is the compose `postgres` service from the dml_utils repo:
# 127.0.0.1:5432, database `dml_utils`, user `postgres`, password `postgres`.
# It is the same target as the default config (config/default.yaml), so this
# script only supplies the password and (optionally) checks that it is up.
#
# Usage:
#   scripts/run-local.sh [viewer args...]
#
# Examples:
#   scripts/run-local.sh
#   scripts/run-local.sh --config config/prod.yaml
#
# Environment overrides:
#   VIEWER_DB_PASSWORD  database password (default: postgres)
#   VIEWER_HOST         host to check (default: 127.0.0.1)
#   VIEWER_PORT         port to check (default: 5432)
#   VIEWER_PIDFILE      where to record the server PID, for stop-local.sh
#                       (default: ${TMPDIR:-/tmp}/dml-utils-viewer.pid)

set -euo pipefail

script_path="$0"
if command -v readlink >/dev/null 2>&1; then
    resolved="$(readlink -f "$script_path" 2>/dev/null || true)"
    [ -n "$resolved" ] && script_path="$resolved"
fi
repo_root="$(cd "$(dirname "$script_path")/.." && pwd)"

cd "$repo_root"

if ! command -v node >/dev/null 2>&1; then
    echo "node is required (see .nvmrc)" >&2
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npm install
fi

export VIEWER_DB_PASSWORD="${VIEWER_DB_PASSWORD:-postgres}"

host="${VIEWER_HOST:-127.0.0.1}"
port="${VIEWER_PORT:-5432}"
if command -v pg_isready >/dev/null 2>&1 &&
    ! pg_isready -q -h "$host" -p "$port" -d dml_utils -U postgres 2>/dev/null; then
    echo "warning: no PostgreSQL server at $host:$port" >&2
    echo "         start the dml_utils database (see dml_utils/scripts)" >&2
fi

pidfile="${VIEWER_PIDFILE:-${TMPDIR:-/tmp}/dml-utils-viewer.pid}"
# Record the PID before exec: exec keeps the same PID, so the file ends up
# holding the node process, which stop-local.sh can then stop.
echo "$$" > "$pidfile"

echo "Starting dml-utils-viewer against the dml_utils database (pid $$)..."
exec node src/server.js "$@"
