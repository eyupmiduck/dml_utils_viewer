#!/usr/bin/env bash
#
# Stop the dml-utils-viewer server started by run-local.sh.
#
# Usage:
#   scripts/stop-local.sh
#
# Environment overrides:
#   VIEWER_PIDFILE      pidfile written by run-local.sh
#                       (default: $XDG_RUNTIME_DIR or $TMPDIR/dml-utils-viewer.pid)
#   VIEWER_SERVER_PORT  server port, for the port-scoped fallback (default: 3220)

set -euo pipefail

pidfile="${VIEWER_PIDFILE:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/dml-utils-viewer.pid}"
server_port="${VIEWER_SERVER_PORT:-3220}"

# Guards against a recycled PID: the process must still be our node server.
is_server() {
    local pid="$1"
    ps -p "$pid" -o command= 2>/dev/null | grep -Eq '[n]ode .*src/server\.js'
}

stop_pid() {
    local pid="$1"
    kill "$pid" 2>/dev/null || return 1
    for _ in $(seq 1 40); do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.25
    done
    echo "process $pid did not stop; sending SIGKILL" >&2
    kill -9 "$pid" 2>/dev/null || true
}

# Stops the process listening on the configured port, which is scoped to this
# instance rather than to a shared command line. Returns non-zero if there is
# none (or it is not our server).
stop_by_port() {
    command -v lsof >/dev/null 2>&1 || return 1
    local pid
    pid="$(lsof -nP -ti "tcp:${server_port}" -sTCP:LISTEN 2>/dev/null | head -n1 || true)"
    [ -n "$pid" ] || return 1
    is_server "$pid" || return 1
    stop_pid "$pid"
}

# Stops every node server process matching this checkout's command line. May
# match another checkout on the same machine, so stop_by_port is preferred.
stop_all() {
    local pid found=1
    for pid in $(pgrep -f '[n]ode .*src/server\.js' || true); do
        found=0
        stop_pid "$pid" || true
    done
    return $found
}

if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && is_server "$pid"; then
        stop_pid "$pid"
        echo "Stopped dml-utils-viewer (pid $pid)"
        rm -f "$pidfile"
        exit 0
    fi
    echo "dml-utils-viewer pidfile was stale; checking for a running server"
    rm -f "$pidfile"
fi

# No live pidfile (for example the server was started with `npm start`): stop
# the listener on our port if there is one, otherwise the matching process.
if stop_by_port || stop_all; then
    echo "Stopped dml-utils-viewer"
else
    echo "dml-utils-viewer is not running"
fi
