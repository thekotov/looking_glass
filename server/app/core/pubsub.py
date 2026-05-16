"""Thin Redis pub/sub + buffer wrapper for live task streaming.

Design:
- Each task gets a Redis channel `lg:task:<id>:stream` for live updates.
- Each task ALSO gets a capped list `lg:task:<id>:buf` (TTL 1h) so a late
  UI viewer can catch up on chunks emitted before they connected.
- When the task reaches a terminal state, a final `{"event":"done"}` message
  is published and the buffer is left in place until it TTLs out.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import redis.asyncio as aioredis

from app.core.config import settings

_BUFFER_MAX_LEN = 5000  # per-task line cap
_BUFFER_TTL_SEC = 3600  # 1h


def _channel(task_id: str) -> str:
    return f"lg:task:{task_id}:stream"


def _buffer_key(task_id: str) -> str:
    return f"lg:task:{task_id}:buf"


class PubSub:
    def __init__(self, url: str) -> None:
        self._client = aioredis.from_url(url, decode_responses=True)

    @property
    def client(self) -> aioredis.Redis:
        return self._client

    async def publish_chunk(self, task_id: str, chunk: dict[str, Any]) -> None:
        """Publish a chunk AND append it to the persistent buffer."""
        data = json.dumps(chunk, ensure_ascii=False)
        async with self._client.pipeline() as pipe:
            pipe.rpush(_buffer_key(task_id), data)
            pipe.ltrim(_buffer_key(task_id), -_BUFFER_MAX_LEN, -1)
            pipe.expire(_buffer_key(task_id), _BUFFER_TTL_SEC)
            pipe.publish(_channel(task_id), data)
            await pipe.execute()

    async def replay_buffer(self, task_id: str) -> list[dict[str, Any]]:
        """Return all buffered chunks for this task (for late joiners)."""
        items: list[str] = await self._client.lrange(_buffer_key(task_id), 0, -1)
        return [json.loads(x) for x in items]

    async def subscribe(self, task_id: str) -> AsyncIterator[dict[str, Any]]:
        """Yield new chunks as they're published. Caller must close the iterator."""
        pubsub = self._client.pubsub()
        await pubsub.subscribe(_channel(task_id))
        try:
            async for msg in pubsub.listen():
                if msg is None:
                    continue
                if msg.get("type") != "message":
                    continue
                data = msg.get("data")
                if not data:
                    continue
                try:
                    yield json.loads(data)
                except json.JSONDecodeError:
                    continue
        finally:
            await pubsub.unsubscribe(_channel(task_id))
            await pubsub.aclose()

    async def close(self) -> None:
        await self._client.aclose()


_singleton: PubSub | None = None


def get_pubsub() -> PubSub:
    global _singleton
    if _singleton is None:
        _singleton = PubSub(str(settings.redis_url))
    return _singleton
