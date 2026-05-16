#!/usr/bin/env bash
# Start the Looking Glass stack(s).
#
# Usage:
#     ./start.sh              # server stack (dev compose)
#     ./start.sh prod         # server stack (prod compose)
#     ./start.sh agent        # agent only (talks to a remote server)
#     ./start.sh all          # server (dev) + agent on the same host
#     ./start.sh prod-all     # server (prod) + agent on the same host
#     ./start.sh -h | --help  # show this usage
#
# Flags:
#     --no-build              skip rebuilding images (use existing)
#     --no-migrate            skip alembic upgrade head after start
#     --logs                  follow logs after starting

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SERVER_DEV="deploy/docker-compose.server.yml"
SERVER_PROD="deploy/docker-compose.prod.yml"
AGENT="deploy/docker-compose.agent.yml"
ENV_FILE="deploy/.env"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; }

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
BUILD_FLAG="--build"
FOLLOW_LOGS=0
DO_MIGRATE=1
for arg in "$@"; do
    case "$arg" in
        server|prod|agent|all|prod-all) TARGET="$arg" ;;
        --no-build)   BUILD_FLAG="" ;;
        --no-migrate) DO_MIGRATE=0 ;;
        --logs)       FOLLOW_LOGS=1 ;;
        -h|--help)    usage; exit 0 ;;
        *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
    esac
done

[[ -f "$ENV_FILE" ]] || {
    echo "error: $ENV_FILE is missing — copy from ${ENV_FILE}.example and fill in values" >&2
    exit 1
}

# Files to start, by target.
case "$TARGET" in
    server)   FILES=("$SERVER_DEV") ;;
    prod)     FILES=("$SERVER_PROD") ;;
    agent)    FILES=("$AGENT") ;;
    all)      FILES=("$SERVER_DEV" "$AGENT") ;;
    prod-all) FILES=("$SERVER_PROD" "$AGENT") ;;
esac

for f in "${FILES[@]}"; do
    [[ -f "$f" ]] || { echo "error: compose file missing: $f" >&2; exit 1; }
done

# --- run ---------------------------------------------------------------------
for f in "${FILES[@]}"; do
    echo "==> starting $f"
    # shellcheck disable=SC2086  # BUILD_FLAG is intentionally word-split
    "${DC[@]}" -f "$f" --env-file "$ENV_FILE" up -d $BUILD_FLAG
done

# Apply migrations on any compose file that has an `api` service. The agent
# compose doesn't, so this loop skips it cleanly. `up -d` returns once the
# container is created — the api process inside may still be starting up,
# so retry exec for up to 30s before giving up.
if [[ "$DO_MIGRATE" -eq 1 ]]; then
    for f in "${FILES[@]}"; do
        if ! "${DC[@]}" -f "$f" --env-file "$ENV_FILE" config --services 2>/dev/null | grep -qx api; then
            continue
        fi
        echo "==> applying migrations ($f)"
        deadline=$(( $(date +%s) + 30 ))
        while true; do
            if "${DC[@]}" -f "$f" --env-file "$ENV_FILE" exec -T api alembic upgrade head; then
                break
            fi
            if (( $(date +%s) >= deadline )); then
                echo "error: alembic upgrade failed repeatedly — check 'docker compose logs api'" >&2
                exit 1
            fi
            sleep 2
        done
    done
fi

echo
echo "==> stack is up"
for f in "${FILES[@]}"; do
    "${DC[@]}" -f "$f" --env-file "$ENV_FILE" ps
    echo
done

if [[ "$FOLLOW_LOGS" -eq 1 ]]; then
    echo "==> following logs (Ctrl-C to detach; containers keep running)"
    # Multiplex logs from every compose file we started.
    LOG_CMD=()
    for f in "${FILES[@]}"; do
        LOG_CMD+=(-f "$f")
    done
    "${DC[@]}" "${LOG_CMD[@]}" --env-file "$ENV_FILE" logs -f --tail=50
fi
