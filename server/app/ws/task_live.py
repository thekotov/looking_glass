"""WebSocket endpoint that streams live task chunks to the UI.

Flow:
1. UI connects to /ws/tasks/{task_id}/live?token=<jwt>
2. Server validates JWT (query param, since browser WS API doesn't expose headers)
3. Server replays buffered chunks (so late joiners see history)
4. Server subscribes to the task's Redis pubsub channel and forwards new chunks
5. When a {"event":"done"} message arrives, server closes the socket
"""
from __future__ import annotations

import asyncio
import logging
import uuid

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.pubsub import get_pubsub
from app.core.security import decode_token
from app.models.task import TERMINAL_STATUSES, Task
from app.models.user import User

log = logging.getLogger(__name__)
router = APIRouter()


async def _authenticate(token: str | None) -> User | None:
    if not token:
        return None
    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    try:
        uid = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        return None
    async with SessionLocal() as session:
        user = await session.get(User, uid)
        return user


@router.websocket("/ws/tasks/{task_id}/live")
async def task_live(
    websocket: WebSocket,
    task_id: uuid.UUID,
    token: str | None = Query(default=None),
) -> None:
    user = await _authenticate(token)
    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="unauthorized")
        return

    # Sanity-check the task exists. We won't enforce per-user ACL until M7.
    async with SessionLocal() as session:
        task_row = await session.execute(select(Task).where(Task.id == task_id))
        task = task_row.scalar_one_or_none()
        if task is None:
            await websocket.close(code=status.WS_1003_UNSUPPORTED_DATA, reason="task not found")
            return
        task_status = task.status

    await websocket.accept()
    pubsub = get_pubsub()
    log.info("ws connected task=%s viewer=%s", task_id, user.username)

    try:
        # Replay buffered chunks first.
        history = await pubsub.replay_buffer(str(task_id))
        for chunk in history:
            await websocket.send_json(chunk)

        # If the task is already terminal, we're done — send a final done marker.
        if task_status in TERMINAL_STATUSES:
            await websocket.send_json({"event": "done", "status": task_status})
            await websocket.close()
            return

        # Subscribe to live channel.
        async for chunk in pubsub.subscribe(str(task_id)):
            await websocket.send_json(chunk)
            if chunk.get("event") == "done":
                # Give the client a moment to render before closing.
                await asyncio.sleep(0.05)
                await websocket.close()
                return
    except WebSocketDisconnect:
        log.info("ws disconnect task=%s viewer=%s", task_id, user.username)
    except Exception:
        log.exception("ws error task=%s", task_id)
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except RuntimeError:
            pass
