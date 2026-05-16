# Deployment

## Server (single VPS)

Requirements: Linux host with Docker 24+, Compose v2, ports 80/443 free.

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
- `CORS_ORIGINS` — JSON array of origins your frontend will be served from.

### 2. TLS cert

For dev, nginx auto-generates a self-signed cert into the `nginx-certs` volume on first start.

For production:

1. Get a real cert (e.g. from Let's Encrypt via your reverse-proxy host, or by pre-generating with certbot).
2. Place `server.crt` and `server.key` into the `looking-glass_nginx-certs` Docker volume:
   ```bash
   docker volume create looking-glass_nginx-certs
   docker run --rm -v looking-glass_nginx-certs:/certs -v /etc/letsencrypt/live/yourdomain:/src alpine \
     sh -c 'cp /src/fullchain.pem /certs/server.crt && cp /src/privkey.pem /certs/server.key && chmod 600 /certs/server.key'
   ```
3. Set up a renewal cron that overwrites the files in that volume and runs `docker compose -f deploy/docker-compose.server.yml exec nginx nginx -s reload`.

The auto-cert script (`deploy/nginx/gen-cert.sh`) only runs when no cert exists — your real cert won't be overwritten.

### 3. First boot

```bash
docker compose -f deploy/docker-compose.server.yml up -d --build
```

Apply migrations:

```bash
docker compose -f deploy/docker-compose.server.yml exec api alembic upgrade head
```

The admin user is seeded automatically on first start if the table is empty.

### 4. Verify

- `https://yourdomain/api/health` → `{"status":"ok"}`
- `https://yourdomain/api/health/db` → `{"status":"ok","component":"postgres"}`
- `https://yourdomain/metrics` → Prometheus text format (no auth — scrape it from your monitoring or block at nginx if exposing externally)
- `https://yourdomain/` → login screen

Log in with the admin credentials from `.env`. Change the password through the API (M7 will add a UI for this).

### 5. Operations

- **Logs**: `docker compose -f deploy/docker-compose.server.yml logs -f api`
- **Update code**: `git pull && docker compose -f deploy/docker-compose.server.yml up -d --build`
- **Rotate password**: re-set `ADMIN_PASSWORD` in `.env`, restart api — the bootstrap only seeds when no user exists, so it WON'T overwrite. Use the API to update an existing user instead (M7 endpoint pending).
- **Wipe everything**: `docker compose -f deploy/docker-compose.server.yml down -v` (removes Postgres + Redis + nginx-certs volumes).

## Production notes

- Run behind a real reverse proxy (Cloudflare / ALB / etc.) — nginx in this stack is mostly for dev TLS termination. In prod, use it for local routing only.
- Enable `prometheus` access controls if `/metrics` is exposed externally. Default is unauthenticated.
- Rotate `SECRET_KEY` only with planned downtime — existing JWTs become invalid.
- Postgres + Redis volumes contain all state. Back them up.
- The default settings have `DEBUG=true` and `SQL_ECHO=false`. For prod set `DEBUG=false` (hides `/api/docs`).
