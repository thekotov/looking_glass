# Deployment

## Server (single VPS)

Requirements: Linux host with Docker 24+, Compose v2, and a host-level nginx (or any other reverse proxy) terminating TLS.

### Architecture

```
internet ──HTTPS──▶ host nginx ──HTTP──▶ docker nginx (127.0.0.1:8080) ──▶ FastAPI / static frontend
```

TLS lives on the host, NOT inside docker. The in-stack nginx speaks plain HTTP only and is meant to be reached over loopback by the host proxy.

### 1. Configure environment

```bash
git clone <repo>
cd looking_glass
cp deploy/.env.example deploy/.env
```

Edit `deploy/.env`:

- `SECRET_KEY` — rotate to a strong value:
  ```bash
  openssl rand -hex 32
  ```
- `POSTGRES_PASSWORD` — strong password.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — first-admin seed. Change `ADMIN_PASSWORD` to something strong **before** first start, or change it via API after.
- `CORS_ORIGINS` — JSON array of origins your frontend will be served from (e.g. `["https://lg.example.com"]`).
- `HTTP_BIND=127.0.0.1` and `HTTP_PORT=8080` — keep the docker listener on loopback so only the host proxy can reach it.

### 2. Host nginx + TLS

The docker stack does not generate or hold TLS certs. Terminate TLS on a host-level nginx and proxy plain HTTP to `127.0.0.1:${HTTP_PORT}`.

`deploy/nginx/lg.example.com.conf` is a starter server block (HTTP only). For production, add a TLS block on the same `server_name` and let certbot or your existing renewal flow manage the cert:

```bash
sudo cp deploy/nginx/lg.example.com.conf /etc/nginx/conf.d/lg.example.com.conf
# edit server_name, then:
sudo certbot --nginx -d lg.example.com
sudo nginx -t && sudo systemctl reload nginx
```

After certbot's run, the file in `/etc/nginx/conf.d/` will have both `:80` (redirect to https) and `:443` (TLS) server blocks pointing at `127.0.0.1:8080`. Renewals are handled by certbot's systemd timer.

### 3. First boot

```bash
docker compose -f deploy/docker-compose.server.yml up -d --build
```

For the production overlay (built SPA, tighter CSP, rate limits, loopback bind):

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Apply migrations:

```bash
docker compose -f deploy/docker-compose.server.yml exec api alembic upgrade head
```

The admin user is seeded automatically on first start if the table is empty.

### 4. Verify

Through the host nginx (replace `lg.example.com` with your domain):

- `https://lg.example.com/api/health` → `{"status":"ok"}`
- `https://lg.example.com/api/health/db` → `{"status":"ok","component":"postgres"}`
- `https://lg.example.com/metrics` → Prometheus text format (no auth — restrict it at the host nginx if exposed externally)
- `https://lg.example.com/` → login screen

Locally, you can also hit the docker nginx directly (plain HTTP):

- `http://127.0.0.1:8080/api/health`

Log in with the admin credentials from `.env`. Change the password through the API (M7 will add a UI for this).

### 5. Operations

- **Logs**: `docker compose -f deploy/docker-compose.server.yml logs -f api`
- **Update code**: `git pull && docker compose -f deploy/docker-compose.server.yml up -d --build`
- **Rotate password**: re-set `ADMIN_PASSWORD` in `.env`, restart api — the bootstrap only seeds when no user exists, so it WON'T overwrite. Use the API to update an existing user instead (M7 endpoint pending).
- **Wipe everything**: `docker compose -f deploy/docker-compose.server.yml down -v` (removes Postgres + Redis volumes).

### 6. Auto-deploy

`deploy/deploy-server.sh` wraps the pull → build → migrate → health-check loop into a single idempotent script. Run it on the server (the VPS hosting Docker, not your laptop):

```bash
cd /srv/looking_glass
./deploy/deploy-server.sh
```

Defaults: pulls `origin/main`, uses `docker-compose.prod.yml`, runs Alembic, probes `/api/health` for up to 120s, and **auto-rolls back to the previous commit** if health fails.

Useful flags:

- `--branch=NAME` — deploy a different branch.
- `--no-pull` — deploy the current working tree (skip `git pull`).
- `--no-migrate` — skip Alembic (e.g. for a pure code-only rollback).
- `--no-rollback` — leave the failed state in place for debugging instead of reverting.
- `--compose=PATH` — use a different compose file (e.g. `deploy/docker-compose.server.yml` for the dev overlay).
- `--timeout=SECS` — health-check timeout (default 120).

To trigger remotely from CI or your laptop:

```bash
ssh deploy@lg.example.com 'cd /srv/looking_glass && ./deploy/deploy-server.sh'
```

The script refuses to run if the working tree has uncommitted changes (you'd lose them on the hard reset), so the server checkout should be deploy-only — no manual edits.

## Production notes

- The docker `nginx` is for in-stack routing only. All TLS, HSTS, and edge-level access control belong on the host nginx (or a CDN / load balancer in front of it).
- Enable `prometheus` access controls if `/metrics` is exposed externally. Default is unauthenticated.
- Rotate `SECRET_KEY` only with planned downtime — existing JWTs become invalid.
- Postgres + Redis volumes contain all state. Back them up.
- The default settings have `DEBUG=true` and `SQL_ECHO=false`. For prod set `DEBUG=false` (hides `/api/docs`).
