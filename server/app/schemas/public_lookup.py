"""Schemas for the no-auth public looking-glass lookup endpoint."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

PublicLookupType = Literal["ping", "traceroute", "tcp_connect"]


class PublicLookupAgent(BaseModel):
    """Minimal agent metadata exposed to anonymous callers (no IPs / IDs leaked beyond UUID)."""

    id: uuid.UUID
    label: str
    tags: list[str]
    city: str | None = None
    country_code: str | None = None


class PublicLookupAgentsResponse(BaseModel):
    agents: list[PublicLookupAgent]


class PublicLookupCreate(BaseModel):
    """User-supplied parameters for the public looking-glass form.

    Strict: only ping/traceroute/tcp_connect, options capped by the server.
    """

    type: PublicLookupType
    target: str = Field(min_length=1, max_length=255)
    agent_id: uuid.UUID
    # Optional knobs. Server clamps each to a safe maximum regardless.
    count: int | None = Field(default=None, ge=1, le=10)
    port: int | None = Field(default=None, ge=1, le=65535)


class PublicLookupTask(BaseModel):
    task_id: uuid.UUID
    status: str
    type: str
    target: str
    created_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None
    error: str | None = None
    # Subset of result fields safe to expose to anonymous viewers.
    stdout: str | None = None
    parsed_json: dict[str, Any] | None = None
    agent: PublicLookupAgent
