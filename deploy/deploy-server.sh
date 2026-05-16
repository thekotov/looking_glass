#!/usr/bin/env bash
# Auto-deploy script for the Looking Glass server stack.
#
# Designed to run ON the server itself (the VPS hosting docker), not from a
# developer machine. Wrap with ssh if you want remote-trigger:
#     ssh deploy@lg.example.com 'cd /srv/looking_glass && ./deploy/deploy-server.sh'
#
# What it does, in order:
#   1. Pulls the latest commit on the configured branch (default: main).
#   2. Builds and starts the stack via docker-compose.prod.yml.
#   3. Runs Alembic migrations inside the api container.
#   4. Probes /api/health until it returns 200, with a timeout.
#   5. On any failure: rolls the working tree back to the previous commit,
#      rebuilds, and re-deploys. Exits non-zero so the wrapping tool/CI knows.
#
# Idempotent. Safe to re-run. Does NOT touch deploy/.env (operator's secrets).
#
# Flags:
#   --branch=NAME     branch to deploy (default: main)
#   --no-pull         skip git pull (use current working tree)
#   --no-migrate      skip alembic upgrade
#   --no-rollback     do NOT auto-rollback on failure (leave bad state for debug)
#   --compose=PATH    override compose file (default: deploy/docker-compose.prod.yml)
#   --timeout=SECS    health-check timeout (default: 120)
#   -h, --help        show usage

set -euo pipefail

# --- defaults ----------------------------------------------------------------

BRANCH="main"
DO_PULL=1
DO_MIGRATE=1
DO_ROLLBACK=1
COMPOSE_FILE="deploy/docker-compose.prod.yml"
HEALTH_TIMEOUT=120
HEALTH_URL_DEFAULT="http://127.0.0.1:${HTTP_PORT:-8080}/api/health"

# --- arg parsing -------------------------------------------------------------

usage() {
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
    case "$arg" in
        --branch=*)     BRANCH="${arg#*=}" ;;
        --no-pull)      DO_PULL=0 ;;
        --no-migrate)   DO_MIGRATE=0 ;;
        --no-rollback)  DO_ROLLBACK=0 ;;
        --compose=*)    COMPOSE_FILE="${arg#*=}" ;;
        --timeout=*)    HEALTH_TIMEOUT="${arg#*=}" ;;
        -h|--help)      usage; exit 0 ;;
        *) echo "unknown flag: $arg" >&2; usage >&2; exit 2 ;;
    esac
done

# --- helpers -----------------------------------------------------------------

log()  { printf '[deploy %(%H:%M:%S)T] %s\n' -1 "$*"; }
fail() { log "FAIL: $*"; exit 1; }

# Find repo root (script may be invoked from anywhere).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

[[ -f "$COMPOSE_FILE" ]] || fail "compose file not found: $COMPOSE_FILE (cwd: $PWD)"
[[ -f "deploy/.env" ]]   || fail "deploy/.env is missing — copy from deploy/.env.example and fill in secrets"

# Pick docker-compose binary (v2 plugin vs legacy).
if docker compose version >/dev/null 2>&1; then
    DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
    DC=(docker-compose)
else
    fail "neither 'docker compose' nor 'docker-compose' is available"
fi

# Resolve health URL from .env if HTTP_PORT is overridden there.
# shellcheck disable=SC1091
HTTP_PORT="$(grep -E '^HTTP_PORT=' deploy/.env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
HEALTH_URL="http://127.0.0.1:${HTTP_PORT:-8080}/api/health"

compose() {
    "${DC[@]}" -f "$COMPOSE_FILE" --env-file deploy/.env "$@"
}

current_sha() {
    git rev-parse --short HEAD
}

# Bring the stack up and verify it's healthy. Returns 0 on success, 1 on failure.
deploy_current_tree() {
    log "building images and starting stack…"
    compose up -d --build || return 1

    if [[ "$DO_MIGRATE" -eq 1 ]]; then
        log "applying alembic migrations…"
        # `compose up -d` returns once containers are created; `api` may still
        # be in `starting` state when we get here. Retry exec for up to ~30s
        # to ride out container startup before giving up.
        local migrate_deadline=$(( $(date +%s) + 30 ))
        while true; do
            if compose exec -T api alembic upgrade head; then
                break
            fi
            if (( $(date +%s) >= migrate_deadline )); then
                log "alembic exec failed repeatedly; giving up"
                return 1
            fi
            sleep 2
        done
    else
        log "skipping migrations (--no-migrate)"
    fi

    log "probing $HEALTH_URL (timeout ${HEALTH_TIMEOUT}s)…"
    local deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
    while (( $(date +%s) < deadline )); do
        if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
            log "health OK"
            return 0
        fi
        sleep 2
    done

    log "health check timed out after ${HEALTH_TIMEOUT}s"
    log "last 60 lines of api logs:"
    compose logs --tail=60 api || true
    return 1
}

# --- pre-flight --------------------------------------------------------------

PREV_SHA="$(current_sha)"
log "current commit: $PREV_SHA"
log "compose file:   $COMPOSE_FILE"
log "branch:         $BRANCH"

if [[ "$DO_PULL" -eq 1 ]]; then
    log "fetching origin…"
    git fetch --prune origin
    log "checking out $BRANCH…"
    # Refuse to clobber local modifications — operator should commit or stash.
    if ! git diff --quiet || ! git diff --cached --quiet; then
        fail "working tree has local changes; commit/stash before deploying"
    fi
    git checkout "$BRANCH"
    git reset --hard "origin/${BRANCH}"
    log "now at: $(current_sha) ($(git log -1 --pretty=%s))"
else
    log "skipping git pull (--no-pull)"
fi

NEW_SHA="$(current_sha)"

# --- deploy ------------------------------------------------------------------

if deploy_current_tree; then
    log "deploy succeeded — $PREV_SHA → $NEW_SHA"
    exit 0
fi

# --- rollback ----------------------------------------------------------------

log "deploy FAILED at $NEW_SHA"

if [[ "$DO_ROLLBACK" -eq 0 ]]; then
    log "rollback disabled (--no-rollback); leaving stack as-is"
    exit 1
fi

if [[ "$PREV_SHA" == "$NEW_SHA" ]]; then
    log "no previous commit to roll back to (already at $PREV_SHA); leaving stack as-is"
    exit 1
fi

log "rolling back working tree to $PREV_SHA…"
git reset --hard "$PREV_SHA"

log "rebuilding previous version…"
# On rollback we keep migrations enabled (a forward migration that failed
# health doesn't mean the schema is wrong — and Alembic is a no-op if we're
# already at head). If you've added an irreversible migration in the failed
# release, you'll need manual recovery — that's the price of forward-only.
if deploy_current_tree; then
    log "rollback OK — stack is back on $PREV_SHA"
    exit 1
fi

log "ROLLBACK ALSO FAILED — manual intervention required"
exit 2
