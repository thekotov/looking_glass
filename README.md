# 🔭 Looking Glass

Self-hosted распределённая сетевая диагностика. Один сервер, много агентов в разных регионах, веб-UI — запускай `ping / mtr / traceroute / tcp-scan / syn-scan / hping3 / dns / http / tls` к любой публичной цели с live-стримом.

## ✨ Фичи

- 🌍 **Мульти-агент** — выбор по списку или по тегам (`eu`, `us`, `asia`)
- 📡 **Live-стрим** результатов через WebSocket с авто-реконнектом
- 📊 **Парсинг в JSON** — графики latency, hop-таблицы MTR, матрица портов
- ⏰ **Расписания** — cron-подобные задачи с пауза/возобновление
- 🟢 **Status-страница** — публичный аптайм-трекер с 90-дневной полоской
- 🔐 **JWT + RBAC** — роли `admin / operator / readonly`, аудит-лог
- 🛡️ **Target-валидатор на сервере И на агенте** — RFC1918, multicast, metadata-IP отсекаются
- ⌨️ **Command palette** (`Ctrl+K`) и глобальные шорткаты
- 📈 **Prometheus `/metrics`** на api и на агентах

## 🏗️ Архитектура

```
браузер ──HTTPS/WSS──▶ host nginx ──HTTP──▶ docker nginx ──▶ FastAPI + WS hub ──▶ Postgres + Redis
                                                  ▲
                                                  │ poll / stream
                                             ┌────┴────┐
                                           агенты (Go, host network, CAP_NET_RAW)
```

TLS терминируется хостовым nginx — внутренний контейнер слушает только HTTP. Для дева достаточно одного docker nginx на `http://localhost:8080`.

## 🚀 Быстрый старт

Требования: **Docker 24+**, **Compose v2**.

```bash
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.server.yml up -d --build
docker compose -f deploy/docker-compose.server.yml exec api alembic upgrade head
```

- 🌐 UI — `http://localhost:8080`
- 🔧 API — `http://localhost:8080/api/health`
- 👤 Логин — `admin` / `admin` (поменяй в `deploy/.env` **до** старта)

В проде TLS терминируется на хостовом nginx — см. `deploy/nginx/lg.example.com.conf` и [docs/DEPLOY.md](docs/DEPLOY.md).

### Поднять агента

```bash
docker compose -f deploy/docker-compose.agent.yml up -d --build
```

Если хостовый nginx использует self-signed cert: `INSECURE_TLS=true` в `deploy/.env`.

Затем в UI → **Manage › Agents** → проставь теги → **Approve**.

## 🏭 Production

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Жёсткий CSP, HSTS, rate-limits, gzip, статика вместо Vite. Обязательные env: `POSTGRES_PASSWORD`, `SECRET_KEY`, `ADMIN_PASSWORD`. Полные инструкции — [docs/DEPLOY.md](docs/DEPLOY.md).

## 📦 Стек

| Слой    | Технологии                                                               |
| ------- | ------------------------------------------------------------------------ |
| Сервер  | Python 3.13, FastAPI, async SQLAlchemy 2, Alembic, Postgres 16, Redis 7  |
| Агент   | Go 1.25, один бинарь, `network_mode: host` + `CAP_NET_RAW/NET_ADMIN`     |
| Фронт   | React 19, Vite 6, TypeScript, Tailwind 3, TanStack Query                 |
| Инфра   | nginx 1.27, Docker Compose v2                                            |

## 📁 Структура

```
server/    FastAPI — app/api/, app/models/, alembic/
agent/     Go — cmd/agent, internal/tasks/
frontend/  React SPA — pages/, components/, api/
deploy/    docker-compose + nginx
docs/      ARCHITECTURE / DEPLOY / AGENT_SETUP
```

## 🛠️ Полезное

```bash
docker compose -f deploy/docker-compose.server.yml logs -f api      # логи
docker compose -f deploy/docker-compose.server.yml down             # стоп
docker compose -f deploy/docker-compose.server.yml down -v          # стоп + wipe
```

📚 [Архитектура](docs/ARCHITECTURE.md) · [Деплой](docs/DEPLOY.md) · [Агент](docs/AGENT_SETUP.md)
