# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Distributed network diagnostics platform ("Looking Glass"). Public-facing: any authenticated user can ask agents in different regions to ping/mtr/traceroute/tcp-scan/hping3 a public target. Security model is built around strict target validation (RFC1918, multicast, metadata IPs are rejected on both server and agent).

Components live in this monorepo:

- `server/` — FastAPI (Python 3.13), async SQLAlchemy + Alembic, PostgreSQL, Redis
- `frontend/` — React 19 + Vite + Tailwind 3 + TypeScript
- `agent/` — Go 1.23+ single-binary, runs in Docker with `network_mode: host` and `CAP_NET_RAW`/`CAP_NET_ADMIN`
- `deploy/` — docker-compose files; in-stack nginx is HTTP only (TLS is meant to be terminated by a host-level nginx)

Agents register themselves on the server (status=pending) and an admin approves them in the UI. Agents poll the server for tasks; long-running tasks (MTR cycles, hping3) stream partial output back over WebSocket.

## Current phase

**M0 — Foundation.** Only skeletons exist: FastAPI `/api/health`, Go agent that logs a heartbeat, Vite/React/Tailwind page that fetches `/api/health`. No auth, no task model, no agents table yet. M1 adds auth + agent lifecycle.

Phase plan and all locked architectural decisions are in the project plan; do not redo those discussions. Key locked decisions:

- Agent language: **Go**
- Use case: **public looking glass** (strict target validation, no RFC1918)
- Live streaming: **yes**, via WebSocket from agent to server
- Agent registration: **auto-register + admin approval in UI**
- Task routing: **both modes** — pick specific agents OR pick by tags (eu/us/asia/...)
- hping3: in scope without flag restrictions, but with hard caps on packet count and rate limit (guards against abuse)

## Common commands

All commands assume working dir = repo root.

### Bring up server stack

```bash
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.server.yml up -d --build
```

UI: `http://localhost:8080`. API: `http://localhost:8080/api/health`.

The docker nginx is HTTP only by design — TLS is meant to be terminated by a host-level nginx (see `deploy/nginx/lg.example.com.conf`). For a public deployment, set `HTTP_BIND=127.0.0.1` in `deploy/.env` so only the host proxy can reach the container, and point a hostname at the host nginx with a real cert.

Logs: `docker compose -f deploy/docker-compose.server.yml logs -f api`.

Tear down (keep volumes): `docker compose -f deploy/docker-compose.server.yml down`.
Tear down (wipe volumes): `docker compose -f deploy/docker-compose.server.yml down -v`.

### Run an agent against the server

```bash
docker compose -f deploy/docker-compose.agent.yml up --build
```

Defaults in `deploy/.env.example` point the agent at `http://host.docker.internal:8080`. Override `SERVER_URL` (and set `INSECURE_TLS=true` if your host nginx uses a self-signed cert) for production.

### Agent dev (without Docker)

```bash
cd agent
SERVER_URL=http://localhost:8080 go run ./cmd/agent
```

Build binary: `go build -o bin/agent ./cmd/agent`.

### Server dev (without Docker, requires local Postgres + Redis)

```bash
cd server
python -m venv .venv && .venv\Scripts\activate     # Windows
pip install -e .[dev]
uvicorn app.main:app --reload --port 8000
```

### Alembic migrations

From `server/`:

- New migration: `alembic revision --autogenerate -m "describe change"`
- Apply: `alembic upgrade head`
- Roll back one: `alembic downgrade -1`

Inside the API container: `docker compose -f deploy/docker-compose.server.yml exec api alembic upgrade head`.

### Frontend dev

`cd frontend && npm install && npm run dev` (Vite on port 5173, no nginx).

Build: `npm run build`. Type-check only: `npm run typecheck`.

### Lint / typecheck (when tasks are added)

- Server: `ruff check server/` and `ruff format server/` (config in `server/pyproject.toml`)
- Agent: `cd agent && go vet ./... && go build ./...`
- Frontend: `cd frontend && npm run typecheck`

## Architecture notes that span multiple files

### Target validation lives on BOTH sides

Server validates targets at task creation (`server/app/validators/targets.py` once M2 lands). Agent ALSO validates before execution. If the server is compromised, the agent must not blindly ping `169.254.169.254`. When adding a new task type, update both validators.

### Polling-based task delivery (not push)

The base model is: agent polls `GET /api/tasks/poll`, claims a task with `POST /api/tasks/{id}/claim`, submits result with `POST /api/tasks/{id}/result`. WebSocket is ONLY for live-streaming partial output during execution (MTR cycles, hping3), not for delegating tasks. This keeps agents firewall-friendly behind NAT.

For multi-agent atomic claim across concurrent pollers, use `SELECT ... FOR UPDATE SKIP LOCKED` on the tasks table.

### Agent capabilities are declared, server respects them

On register, agent sends `capabilities: ["ping","mtr","tcp_scan","syn_scan","ipv6"]`. Server filters tasks: an agent without `syn_scan` never gets SYN scan tasks. When adding a task type, also add it to the capability list and to the server's capability check (`server/app/services/capability_check.py` once M6 lands).

### Network access in the agent

Agent runs with `network_mode: host` + `CAP_NET_RAW` + `CAP_NET_ADMIN`. This means the agent sees the host's network stack directly — necessary for accurate timing and raw sockets. Consequence: only one agent per host. Multi-tenancy is per-VPS, not per-container.

### nginx is HTTP only inside the docker stack

The docker `nginx` service listens on plain HTTP (port 80 in-container, published as `HTTP_PORT` on the host, default `8080`). It is intended to sit behind a host-level nginx that terminates TLS. `deploy/nginx/lg.example.com.conf` is a starter for that host-side server block — drop it into `/etc/nginx/conf.d/`, add your TLS block, and proxy to `127.0.0.1:8080`. There is no in-container cert generation any more.

### CORS / WebSocket through nginx

`/api/*` proxies to FastAPI. `/ws/*` proxies to FastAPI with `Upgrade`/`Connection` headers for WS. `/` proxies to the Vite dev server (which ALSO needs Upgrade for HMR). All three locations in `deploy/nginx/nginx.conf` must keep their Upgrade headers when modified.

## What to avoid

- **Do not execute shell commands with `shell=True` or pass user input directly to `exec.Command`.** Network tools (mtr, hping3, traceroute) take strictly-typed parameters which are mapped to whitelisted argv slices inside the agent. Validation happens before the slice is built.
- **Do not store secrets in compose files committed to git.** Use `deploy/.env` (gitignored).
- **Do not skip Alembic.** Schema changes must come with a migration. The CI gate (added later) will fail on missing migrations.
- **Do not relax target validators "just for testing".** Use a feature flag for an internal-monitoring mode instead, or write a focused unit test against the validator itself.

## Where to find context

- Project plan with all 8 phases (M0–M8) and locked decisions: `~/.claude/plans/mossy-conjuring-bubble.md` (session-local; ask the user if missing).
- High-level architecture and components: this file's "Architecture notes" section.
- Task spec (the original ТЗ): held by the user; key facts captured in plan + this file.
