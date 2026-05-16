"""Schemas for the availability-check fan-out (matrix-style probing).

A single user action creates one task per (target, check_type, agent) triple
under a shared group_id. Reuses existing `ping` and `tcp_connect` task types —
no new agent code, no new DB tables.
"""
from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, model_validator


CheckType = Literal["icmp", "tcp"]


class AvailabilityCheckCreate(BaseModel):
    targets: list[str] = Field(min_length=1, max_length=50)
    check_types: list[CheckType] = Field(min_length=1, max_length=2)
    tcp_port: int = Field(default=443, ge=1, le=65535)
    # None or empty → all currently-active agents.
    agent_ids: list[uuid.UUID] | None = None
    timeout_sec: int = Field(default=5, ge=1, le=30)
    # ping `count` — average over a few packets gives more useful RTT than a one-shot.
    ping_count: int = Field(default=4, ge=1, le=20)

    @model_validator(mode="after")
    def _dedupe_types(self) -> "AvailabilityCheckCreate":
        seen: list[CheckType] = []
        for t in self.check_types:
            if t not in seen:
                seen.append(t)
        self.check_types = seen
        return self


class SkippedPair(BaseModel):
    agent_id: uuid.UUID
    hostname: str
    check_type: CheckType
    reason: str


class AvailabilityCheckResponse(BaseModel):
    group_id: uuid.UUID
    task_count: int
    skipped: list[SkippedPair] = Field(default_factory=list)
