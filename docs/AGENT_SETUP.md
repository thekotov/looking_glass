# Agent setup

Deploy one agent per geographic region. Each agent registers with the central server, waits for admin approval, and then polls for tasks.

## Requirements

- Linux host (the agent runs in Docker, but `network_mode: host` only behaves correctly on Linux).
- Docker 24+, Compose v2.
- Outbound HTTPS to your server.
- For accurate measurements: dedicated VPS, not a shared box (latency contention skews results).

## Setup

```bash
git clone <repo>
cd looking_glass
cp deploy/.env.example deploy/.env
```

Edit `deploy/.env`:

- `SERVER_URL` — `https://your-server.example`
- `INSECURE_TLS` — `false` in production (must be set; only `true` for self-signed dev certs)
- `AGENT_HOSTNAME` — optional, defaults to system hostname. Use this if you want a human-readable name in the UI.

Start the agent:

```bash
docker compose -f deploy/docker-compose.agent.yml up -d --build
```

Logs:

```bash
docker compose -f deploy/docker-compose.agent.yml logs -f agent
```

You should see:

```json
{"msg":"registering with server"}
{"msg":"registered, awaiting approval","agent_id":"..."}
{"msg":"heartbeat ok","status":"pending"}
```

## Approval

In the server UI:

1. Sign in as admin.
2. Open **Agents**.
3. Find the new pending agent (matches the hostname you set).
4. Set tags (e.g. `eu`, `us`, `asia`, `residential`, `ipv6`) and click **Approve**.

Within the next heartbeat tick (~15s) the agent will see `status=active` and start polling for tasks.

## What runs where

- The agent runs each task as a goroutine or `exec.Command`. For tools that need raw sockets (mtr, hping3, native ICMP ping), `CAP_NET_RAW` + `CAP_NET_ADMIN` are required — the compose file already sets them.
- State (agent_id + token) is persisted in the `agent-state` named volume. Wipe it with `docker volume rm looking-glass-agent_agent-state` to force re-registration as a new pending agent.

## Metrics

The agent exposes Prometheus metrics on `:9100/metrics`:

```bash
curl http://agent-host:9100/metrics | grep lg_agent
```

If you want to scrape externally, expose the port (default `:9100`). Otherwise leave it bound to localhost only. Customize via `METRICS_ADDR` env var.

## Updates

```bash
git pull
docker compose -f deploy/docker-compose.agent.yml up -d --build
```

The agent reuses its stored credentials across restarts — no re-approval needed unless the state volume is wiped.

## Troubleshooting

- **Agent stuck on `register failed`**: confirm `SERVER_URL` is reachable from the agent host. With self-signed certs you must set `INSECURE_TLS=true`. With real certs (Let's Encrypt etc.) keep it `false`.
- **Agent appears as pending forever**: admin hasn't approved it. Tasks won't be assigned to pending agents.
- **`stdbuf: command not found`**: should never happen (Debian-slim base includes coreutils), but if you swap the base image, the line-buffering helper needs `stdbuf`.
- **`mtr` shows only 1 hop**: you're running in an environment where the agent can't see beyond a single hop (e.g. Docker Desktop on Mac/Windows). Move to Linux with real `network_mode: host`.
