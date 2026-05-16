# Architecture

Distributed network diagnostics platform. One server, many agents, public targets.

## Components

```
                       ┌──────────────┐
                       │   browser    │
                       │ (React + Vite)
                       └──────┬───────┘
                              │  HTTPS / WSS
                              ▼
                       ┌──────────────┐
                       │    nginx     │  TLS termination, /api → api,
                       │              │  /ws → api, / → vite dev server
                       └──────┬───────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
      ┌──────────┐      ┌──────────┐      ┌──────────┐
      │ frontend │      │   api    │      │  api WS  │
      │  (vite)  │      │ (FastAPI)│      │/ws/tasks │
      └──────────┘      └─────┬────┘      └─────┬────┘
                              │                 │
                ┌─────────────┼─────────────┐   │
                ▼             ▼             ▼   ▼
          ┌──────────┐  ┌──────────┐  ┌──────────────┐
          │postgres  │  │  redis   │  │ pub/sub for  │
          │          │  │  buffer  │  │ live streams │
          └──────────┘  └──────────┘  └──────────────┘
                              ▲
                              │  HTTPS poll/heartbeat/chunk
                              │
                  ┌───────────┴───────────┐
                  ▼                       ▼
            ┌──────────┐            ┌──────────┐
            │  agent   │   ...      │  agent   │   N agents in different regions
            │  (Go)    │            │  (Go)    │
            └──────────┘            └──────────┘
```

- **Server** — Python 3.13 + FastAPI + async SQLAlchemy + Alembic. Postgres for state, Redis for live-stream buffer + pub/sub.
- **Agents** — Go 1.25 single-binary in Docker (`network_mode: host` for real-network measurements in prod; `CAP_NET_RAW` + `CAP_NET_ADMIN`).
- **Frontend** — React 19 + Vite + Tailwind + TanStack Query + react-router. Talks to the API and connects to WS for live task output.
- **nginx (in-stack)** — HTTP-only reverse proxy on port 8080. Routes `/api/*`, `/ws/*`, `/metrics` to FastAPI and `/` to the Vite dev server (or built static assets in prod). TLS is terminated by a separate host-level nginx in production — see `deploy/nginx/lg.example.com.conf`.

## Task lifecycle

```
user creates task (1+ agents)
        │
        ▼
   tasks.status = queued ───► agent polls /api/tasks/poll
                                       │
                                       ▼
                              SELECT FOR UPDATE SKIP LOCKED
                              status → claimed
                                       │
                                       ▼ runner.Run(ctx) starts
                              POST /api/tasks/{id}/chunk (per stdout line)
                                       │  (sets status=running on first chunk)
                                       │  (publishes to Redis pubsub)
                                       ▼
                              runner finishes
                                       │
                                       ▼
                              POST /api/tasks/{id}/result
                              status → completed/failed/timeout
                              publishes {"event":"done"} on pubsub
```

A logical user action can fan out into N task rows sharing a `group_id`. Each row has its own lifecycle and result.

## Security model

This is a **public looking glass** — any authenticated user can submit tasks against public targets.

- **Target validator** rejects RFC1918, link-local (incl. 169.254.169.254 metadata), multicast, loopback, broadcast, ULAv6, doc-prefixes. Same logic lives in `server/app/validators/targets.py` and `agent/internal/validator/targets.go`. If they drift, the agent's check is the last line of defense.
- **Argv whitelisting** for exec-based runners (mtr, traceroute, hping3). The agent never builds argv from raw strings — only validated typed params hit the slice.
- **Agent token** is opaque random + hashed at rest. Tokens are revoked by setting agent.status = rejected.
- **User auth** is JWT with 15min access + 7d refresh. Cookie-less, no CSRF concerns.

Hardening still on the roadmap (M7): RBAC roles, audit log, security headers, login rate limit.

## Live streaming

Long-running tasks (mtr, hping3, traceroute) stream stdout line-by-line via HTTP POST per chunk, not a persistent WebSocket from the agent. Server publishes each chunk to Redis pubsub (`lg:task:<id>:stream`) and appends to a capped Redis list (`lg:task:<id>:buf`, TTL 1h) so late UI viewers can replay history.

UI subscribes via WebSocket at `/ws/tasks/{id}/live?token=<jwt>`. Server first sends backfill, then forwards live chunks.

Agent uses `stdbuf -oL -eL <bin>` automatically when a chunk sender is in context — without it, hping3 buffers stdout to the pipe and the "live" stream arrives in bursts.

## Migrations

Alembic. Migration files in `server/alembic/versions/`. Applied with `alembic upgrade head` (in container).

Current chain: `0001_init` (users + agents) → `0002_tasks_results` → `0003_task_group_id`.

## Observability

- `/metrics` on the API (Prometheus text). HTTP request metrics + custom collector that queries Postgres at scrape time for `lg_agents{status}`, `lg_tasks{status}`, `lg_tasks_by_type`.
- `:9100/metrics` on each agent. `lg_agent_task_runs_total{type,status}`, `lg_agent_task_duration_seconds{type}`, `lg_agent_heartbeats_total{outcome}`, `lg_agent_up`.
- `/api/stats` aggregate JSON for the UI dashboard.
- `/api/health` and `/api/health/db` for liveness/DB probes.

## What's NOT in here yet

- RBAC roles (admin/operator/readonly) — M7
- Audit log of user actions — M7
- Security headers (CSP, HSTS) — M7
- Login rate limit — M7
- SYN scan via raw sockets, banner grabbing — M6
- Per-task-type rate limits with Redis token bucket — M6
