import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    agents,
    audit,
    auth,
    availability,
    availability_presets,
    health,
    public,
    schedules,
    stats,
    targets,
    tasks,
    tools,
    users,
)
from app.core.config import settings
from app.core.metrics import refresh_loop as metrics_refresh_loop
from app.core.metrics import setup_metrics
from app.services.bootstrap import seed_admin_user
from app.services.scheduler import scheduler_loop
from app.ws import task_live

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    force=True,
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    log.info("Looking Glass server starting (env=%s)", settings.env)
    try:
        await seed_admin_user()
    except Exception:
        log.exception("admin seeding failed (continuing — migrations may not be applied yet)")
    metrics_task = asyncio.create_task(metrics_refresh_loop())
    scheduler_task = asyncio.create_task(scheduler_loop())
    try:
        yield
    finally:
        for task in (metrics_task, scheduler_task):
            task.cancel()
        for task in (metrics_task, scheduler_task):
            try:
                await task
            except asyncio.CancelledError:
                pass
        log.info("Looking Glass server shutting down")


app = FastAPI(
    title="Looking Glass API",
    version="0.1.0",
    docs_url="/api/docs" if settings.debug else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.debug else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(availability.router, prefix="/api")
app.include_router(availability_presets.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(targets.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(public.public_router, prefix="/api")
app.include_router(public.admin_router, prefix="/api")
app.include_router(schedules.router, prefix="/api")
app.include_router(tools.router, prefix="/api")
app.include_router(task_live.router)  # WebSocket — no /api prefix

setup_metrics(app)
