#!/usr/bin/env bash
#
# Stop the dml-utils-viewer server started by run-local.sh.
#
# Usage:
#   scripts/stop-local.sh
#
# Environment overrides:
#   VIEWER_PIDFILE  pidfile written by run-local.sh
#                   (default: ${TMPDIR:-/tmp}/dml-utils-viewer.pid)

set -euo pipefail

pidfile="${VIEWER_PIDFILE:-${TMPDIR:-/tmp}/dml-utils-viewer.pid}"

# Guards against a recycled PID: the process must still be our server.
is_server() {
    local pid="$1"
    ps -p "$pid" -o command= 2>/dev/null | grep -q "src/server.js"
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

if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && is_server "$pid"; then
        stop_pid "$pid"
        echo "Stopped dml-utils-viewer (pid $pid)"
    else
        echo "dml-utils-viewer is not running (stale pidfile)"
    fi
    rm -f "$pidfile"
    exit 0
fi

# No pidfile (for example the server was started with `npm start`): fall back
# to matching the server process.
if pgrep -f "[n]ode src/server.js" >/dev/null 2>&1; then
    pkill -f "[n]ode src/server.js"
    echo "Stopped dml-utils-viewer"
else
    echo "dml-utils-viewer is not running"
fi
