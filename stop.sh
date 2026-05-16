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
#     -v, --volumes           ALSO remove this stack's named volumes
#                             (postgres-data, redis-data, agent-state).
#                             DESTRUCTIVE — wipes the database. Used when
#                             resetting a broken init (e.g. wrong
#                             POSTGRES_PASSWORD on first boot).
#     --all-volumes           Like -v, but ALSO wipes volumes from BOTH the
#                             dev (looking-glass_*) and prod
#                             (looking-glass-prod_*) compose namespaces.
#                             Useful when switching between dev/prod and
#                             leftover volumes from the other namespace are
#                             causing password mismatches.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SERVER_DEV="deploy/docker-compose.server.yml"
SERVER_PROD="deploy/docker-compose.prod.yml"
AGENT="deploy/docker-compose.agent.yml"
ENV_FILE="deploy/.env"

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; }

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
REMOVE_ALL_VOLUMES=0
for arg in "$@"; do
    case "$arg" in
        server|prod|agent|all|prod-all) TARGET="$arg" ;;
        -v|--volumes)   REMOVE_VOLUMES=1 ;;
        --all-volumes)  REMOVE_VOLUMES=1; REMOVE_ALL_VOLUMES=1 ;;
        -h|--help)      usage; exit 0 ;;
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

# If --all-volumes is requested, expand FILES to cover both dev and prod
# compose namespaces so neither is left with stale volumes.
if [[ "$REMOVE_ALL_VOLUMES" -eq 1 ]]; then
    FILES=("$SERVER_DEV" "$SERVER_PROD" "$AGENT")
fi

# Build extra args for `down`.
DOWN_ARGS=()
if [[ "$REMOVE_VOLUMES" -eq 1 ]]; then
    DOWN_ARGS+=("-v")
    if [[ "$REMOVE_ALL_VOLUMES" -eq 1 ]]; then
        echo "WARNING: --all-volumes — wiping volumes for BOTH dev and prod stacks (database, redis, agent state)."
    else
        echo "WARNING: -v — named volumes (database, redis, agent state) will be DELETED for this stack."
    fi
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
