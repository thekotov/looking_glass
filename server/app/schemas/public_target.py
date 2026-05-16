import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class PublicTargetOut(BaseModel):
    id: uuid.UUID
    target: str
    label: str | None = None
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class PublicTargetCreate(BaseModel):
    target: str = Field(min_length=1, max_length=512)
    label: str | None = Field(default=None, max_length=128)
    sort_order: int = Field(default=0)


class PublicTargetUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=128)
    sort_order: int | None = None


class PublicAgentRollup(BaseModel):
    """Per-agent slice shown on the public /status page. Strips sensitive bits."""

    agent_id: uuid.UUID
    agent_label: str  # display_name or hostname
    agent_tags: list[str]
    samples: int
    availability_percent: float
    rtt_avg_ms: float | None = None
    loss_percent: float | None = None
    last_sample_at: datetime | None = None


class PublicTargetStatus(BaseModel):
    target: str
    label: str | None = None
    sort_order: int
    window_seconds: int
    overall_availability_percent: float
    per_agent: list[PublicAgentRollup]


class PublicStatusResponse(BaseModel):
    generated_at: datetime
    window_seconds: int
    targets: list[PublicTargetStatus]
