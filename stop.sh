#!/usr/bin/env bash
# Stop the Looking Glass stack(s).
#
# Usage:
#     ./stop.sh               # stop server (dev) stack
#     ./stop.sh prod          # stop server (prod) stack
#     ./stop.sh agent         # stop the agent
#     ./stop.sh all           # stop server (dev) + agent
#     ./stop.sh prod-all      # stop server (prod) + agent
#     ./stop.sh -h | --help   # show this usage
#
# Flags:
#     -v, --volumes           ALSO remove named volumes (postgres-data,
#                             redis-data, agent-state). DESTRUCTIVE — wipes
#                             the database. Used when resetting a broken init
#                             (e.g. wrong POSTGRES_PASSWORD on first boot).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SERVER_DEV="deploy/docker-compose.server.yml"
SERVER_PROD="deploy/docker-compose.prod.yml"
AGENT="deploy/docker-compose.agent.yml"
ENV_FILE="deploy/.env"

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }

# --- pick docker compose binary (v2 plugin vs legacy) -----------------------
if docker compose version >/dev/null 2>&1; then
    DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
    DC=(docker-compose)
else
    echo "error: neither 'docker compose' nor 'docker-compose' is available" >&2
    exit 1
fi

# --- arg parsing -------------------------------------------------------------
TARGET="server"
REMOVE_VOLUMES=0
for arg in "$@"; do
    case "$arg" in
        server|prod|agent|all|prod-all) TARGET="$arg" ;;
        -v|--volumes) REMOVE_VOLUMES=1 ;;
        -h|--help)    usage; exit 0 ;;
        *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
    esac
done

case "$TARGET" in
    server)   FILES=("$SERVER_DEV") ;;
    prod)     FILES=("$SERVER_PROD") ;;
    agent)    FILES=("$AGENT") ;;
    all)      FILES=("$SERVER_DEV" "$AGENT") ;;
    prod-all) FILES=("$SERVER_PROD" "$AGENT") ;;
esac

# Build extra args for `down`.
DOWN_ARGS=()
if [[ "$REMOVE_VOLUMES" -eq 1 ]]; then
    DOWN_ARGS+=("-v")
    echo "WARNING: -v passed — named volumes (database, redis, agent state) will be DELETED."
    echo "         Press Ctrl-C within 3 seconds to abort."
    sleep 3
fi

ENV_ARG=()
[[ -f "$ENV_FILE" ]] && ENV_ARG=(--env-file "$ENV_FILE")

for f in "${FILES[@]}"; do
    [[ -f "$f" ]] || { echo "warn: compose file missing, skipping: $f"; continue; }
    echo "==> stopping $f"
    "${DC[@]}" -f "$f" "${ENV_ARG[@]}" down "${DOWN_ARGS[@]}"
done

echo "==> stack is down"
