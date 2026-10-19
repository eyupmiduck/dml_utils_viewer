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
#   VIEWER_HOST         host the pre-flight check probes (default: 127.0.0.1)
#   VIEWER_PORT         port the pre-flight check probes (default: 5432)
#                       Note: these only affect the check; the server reads
#                       host/port from the configuration file.
#   VIEWER_PIDFILE      where to record the server PID, for stop-local.sh
#                       (default: $XDG_RUNTIME_DIR or $TMPDIR/dml-utils-viewer.pid)

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

# These only control the pre-flight check below; the server itself reads the
# database host/port from the configuration file.
host="${VIEWER_HOST:-127.0.0.1}"
port="${VIEWER_PORT:-5432}"
if command -v pg_isready >/dev/null 2>&1 &&
    ! pg_isready -q -h "$host" -p "$port" -d dml_utils -U postgres 2>/dev/null; then
    echo "warning: no PostgreSQL server at $host:$port" >&2
    echo "         start the dml_utils database (see dml_utils/scripts)" >&2
fi

pidfile="${VIEWER_PIDFILE:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/dml-utils-viewer.pid}"
# Never write through a symlink: another user could pre-create one and have the
# redirect below overwrite an arbitrary file we can write.
if [ -L "$pidfile" ]; then
    echo "refusing to use pidfile $pidfile: it is a symlink" >&2
    exit 1
fi
if [ -f "$pidfile" ]; then
    old="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "$old" ] && kill -0 "$old" 2>/dev/null &&
        ps -p "$old" -o command= 2>/dev/null | grep -Eq '[n]ode .*src/server\.js'; then
        echo "dml-utils-viewer already running (pid $old); run scripts/stop-local.sh first" >&2
        exit 1
    fi
fi

# Record the PID before exec: exec keeps the same PID, so the file ends up
# holding the node process, which stop-local.sh can then stop.
echo "$$" > "$pidfile"

echo "Starting dml-utils-viewer against the dml_utils database (pid $$)..."
exec node src/server.js "$@"
