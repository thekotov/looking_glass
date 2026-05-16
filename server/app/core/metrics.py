"""Prometheus metrics for the API.

Strategy:
- HTTP request metrics and `/metrics` endpoint come from prometheus-fastapi-instrumentator.
- App-domain gauges (agents/tasks by status, tasks by type) are refreshed every
  N seconds by a background task started in the FastAPI lifespan. This avoids
  running async DB queries from prometheus_client's sync collect() path, which
  can't safely use the running event loop.
"""
from __future__ import annotations

import asyncio
import logging

from prometheus_client import Gauge
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.models.agent import Agent
from app.models.task import Task

log = logging.getLogger(__name__)

REFRESH_INTERVAL_SEC = 15

_agents_g = Gauge(
    "lg_agents",
    "Agents grouped by lifecycle status.",
    labelnames=["status"],
)
_tasks_g = Gauge(
    "lg_tasks",
    "Tasks grouped by status (full history).",
    labelnames=["status"],
)
_tasks_by_type_g = Gauge(
    "lg_tasks_by_type",
    "Tasks grouped by type (full history).",
    labelnames=["type"],
)


async def _refresh_once() -> None:
    async with SessionLocal() as session:
        agents_q = await session.execute(
            select(Agent.status, func.count()).group_by(Agent.status)
        )
        tasks_q = await session.execute(
            select(Task.status, func.count()).group_by(Task.status)
        )
        types_q = await session.execute(
            select(Task.type, func.count()).group_by(Task.type)
        )

    # Reset labelled gauges so removed labels don't linger.
    _agents_g.clear()
    _tasks_g.clear()
    _tasks_by_type_g.clear()
    for status, count in agents_q.all():
        _agents_g.labels(status=status).set(count)
    for status, count in tasks_q.all():
        _tasks_g.labels(status=status).set(count)
    for type_, count in types_q.all():
        _tasks_by_type_g.labels(type=type_).set(count)


async def refresh_loop() -> None:
    """Background task started in lifespan — refreshes lg_* gauges from Postgres."""
    while True:
        try:
            await _refresh_once()
        except Exception:
            log.exception("metric refresh failed")
        await asyncio.sleep(REFRESH_INTERVAL_SEC)


def setup_metrics(app) -> None:
    """Attach the /metrics endpoint. Background refresher is started in main lifespan."""
    Instrumentator(
        excluded_handlers=["/api/health", "/metrics"],
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
