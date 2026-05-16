import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class ScheduleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    type: str = Field(min_length=1, max_length=32)
    target: str = Field(min_length=1, max_length=512)
    options: dict[str, Any] = Field(default_factory=dict)
    interval_seconds: int = Field(ge=60, le=7 * 86400)
    enabled: bool = True

    # Routing — exactly one of these must be non-empty.
    agent_ids: list[uuid.UUID] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    agents_per_tag: int = Field(default=1, ge=1, le=20)

    @model_validator(mode="after")
    def _routing(self) -> "ScheduleCreate":
        if bool(self.agent_ids) == bool(self.tags):
            raise ValueError("exactly one of agent_ids or tags must be set")
        return self


class ScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    interval_seconds: int | None = Field(default=None, ge=60, le=7 * 86400)
    options: dict[str, Any] | None = None
    target: str | None = Field(default=None, min_length=1, max_length=512)
    agent_ids: list[uuid.UUID] | None = None
    tags: list[str] | None = None
    agents_per_tag: int | None = Field(default=None, ge=1, le=20)


class ScheduleOut(BaseModel):
    id: uuid.UUID
    name: str
    enabled: bool
    type: str
    target: str
    options: dict[str, Any]
    agent_ids: list[uuid.UUID]
    tags: list[str]
    agents_per_tag: int
    interval_seconds: int
    next_run_at: datetime
    last_run_at: datetime | None = None
    last_run_group_id: uuid.UUID | None = None
    last_run_error: str | None = None
    runs_total: int
    runs_failed: int
    created_by: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ScheduleRunResponse(BaseModel):
    triggered: Literal[True] = True
    group_id: uuid.UUID
    task_count: int
