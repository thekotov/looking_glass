import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator


class TaskCreateRequest(BaseModel):
    """Create one logical task, possibly fanned out across multiple agents.

    Three input modes (mutually exclusive):
    - ``agent_id``: single specific agent (M2 shorthand).
    - ``agent_ids``: explicit list of agents — one task row per agent.
    - ``tags`` + ``agents_per_tag``: server picks N active agents matching each tag.
    """

    type: str = Field(min_length=1, max_length=32)
    target: str = Field(min_length=1, max_length=2048)
    options: dict[str, Any] = Field(default_factory=dict)
    priority: int = Field(default=0, ge=0, le=10)

    # Mode selection — exactly one must be set.
    agent_id: uuid.UUID | None = None
    agent_ids: list[uuid.UUID] | None = None
    tags: list[str] | None = None
    agents_per_tag: int = Field(default=1, ge=1, le=20)

    @model_validator(mode="after")
    def _exactly_one_mode(self) -> "TaskCreateRequest":
        modes = sum(
            [
                self.agent_id is not None,
                bool(self.agent_ids),
                bool(self.tags),
            ]
        )
        if modes == 0:
            raise ValueError("must specify one of: agent_id, agent_ids, tags")
        if modes > 1:
            raise ValueError("agent_id, agent_ids, and tags are mutually exclusive")
        if self.tags is not None and any(not t.strip() for t in self.tags):
            raise ValueError("tags must be non-empty strings")
        return self


class ResultOut(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    agent_id: uuid.UUID
    stdout: str
    stderr: str
    exit_code: int | None
    duration_ms: int | None
    parsed_json: dict[str, Any] | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskOut(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    type: str
    target: str
    options: dict[str, Any]
    status: str
    priority: int
    agent_id: uuid.UUID
    created_by: uuid.UUID | None
    error: str | None
    created_at: datetime
    claimed_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class TaskDetailOut(TaskOut):
    result: ResultOut | None = None
    # Sibling task IDs in the same group (excluding self).
    siblings: list[uuid.UUID] = Field(default_factory=list)


class TaskGroupTaskOut(TaskOut):
    """Task plus its result, for the group view."""

    result: ResultOut | None = None


class TaskGroupOut(BaseModel):
    """Aggregate view: one user action, possibly N agent rows."""

    group_id: uuid.UUID
    type: str
    target: str
    options: dict[str, Any]
    created_at: datetime
    created_by: uuid.UUID | None
    tasks: list[TaskGroupTaskOut]


class AgentTaskOut(BaseModel):
    """What the agent sees when polling — fewer fields, no DB internals."""

    id: uuid.UUID
    type: str
    target: str
    options: dict[str, Any]


class TaskResultSubmit(BaseModel):
    stdout: str = ""
    stderr: str = ""
    exit_code: int | None = None
    duration_ms: int | None = None
    parsed_json: dict[str, Any] | None = None
    # Final task status — agent reports whether the run succeeded or failed.
    status: str = Field(default="completed")
    error: str | None = None


class TaskChunkSubmit(BaseModel):
    """Incremental output from a running task. Seq is monotonic per task."""

    seq: int = Field(ge=0)
    stream: str = Field(default="stdout", max_length=8)  # "stdout" | "stderr"
    text: str = Field(max_length=64 * 1024)


class TaskCreateResponse(BaseModel):
    """Response to a fan-out create — single-agent calls still get one row."""

    group_id: uuid.UUID
    tasks: list[TaskOut]
