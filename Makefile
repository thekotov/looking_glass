# Looking Glass — convenience commands.
#
# Most targets are thin wrappers around `npm`, `go test`, `pytest`,
# and `docker compose`. The point isn't to hide complexity — it's so you
# don't have to remember the exact flags / paths each time, and so CI has
# a single source of truth for what "all tests pass" means.

.PHONY: help \
        test test-all test-go test-ts test-py test-e2e \
        typecheck-ts lint-py \
        build build-frontend build-api build-agent \
        up down restart logs \
        migrate \
        clean

help:  ## Show this help (default target)
	@awk 'BEGIN{FS=":.*##"; printf "Available targets:\n"} \
	     /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' \
	     $(MAKEFILE_LIST)

# ---------- tests ----------

test: test-go test-ts test-py  ## Run all unit/integration tests (no e2e)
	@echo "✓ all unit tests passed"

test-go:  ## Go agent tests
	cd agent && go test ./...

test-ts:  ## Frontend typecheck (no separate unit tests yet)
	cd frontend && npm run typecheck

test-py:  ## Python server tests (requires postgres + redis running)
	cd server && python -m pytest tests/ -v

test-e2e:  ## Playwright smoke tests against the running stack
	cd frontend && npm run test:e2e

test-all: test test-e2e  ## Everything including e2e (needs stack up)
	@echo "✓ all suites passed"

# ---------- linting ----------

typecheck-ts: ## TypeScript typecheck only
	cd frontend && npm run typecheck

lint-py: ## Ruff lint for server
	cd server && ruff check app/ tests/

# ---------- build ----------

build: build-frontend build-api build-agent  ## Build everything

build-frontend:  ## Vite production build
	cd frontend && npm run build

build-api:  ## Rebuild api container
	docker compose -f deploy/docker-compose.server.yml build api

build-agent:  ## Rebuild agent container
	docker compose -f deploy/docker-compose.agent.yml build

# ---------- dev stack ----------

up:  ## Bring up the server stack
	docker compose -f deploy/docker-compose.server.yml up -d

down:  ## Tear down the server stack (keep volumes)
	docker compose -f deploy/docker-compose.server.yml down

restart:  ## Restart all server containers
	docker compose -f deploy/docker-compose.server.yml restart

logs:  ## Tail api logs
	docker compose -f deploy/docker-compose.server.yml logs -f api

migrate:  ## Apply pending Alembic migrations
	docker compose -f deploy/docker-compose.server.yml exec api alembic upgrade head

clean:  ## Remove generated build artefacts (NOT containers/volumes)
	rm -rf frontend/dist frontend/test-results frontend/playwright-report
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	find . -name ".pytest_cache" -type d -prune -exec rm -rf {} +
