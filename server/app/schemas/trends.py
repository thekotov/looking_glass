import uuid
from datetime import datetime

from pydantic import BaseModel


class TargetListItem(BaseModel):
    """A target that has at least one task in the lookback window."""

    target: str
    task_count: int
    last_seen: datetime
    types: list[str]
    distinct_agents: int


class TargetAgentStats(BaseModel):
    """Per-agent rollup for one target over the requested period."""

    agent_id: uuid.UUID
    agent_label: str
    agent_tags: list[str]
    samples: int
    success_count: int
    failure_count: int
    availability_percent: float
    rtt_avg_ms: float | None = None
    rtt_min_ms: float | None = None
    rtt_max_ms: float | None = None
    loss_percent: float | None = None
    last_sample_at: datetime | None = None


class TargetSummary(BaseModel):
    target: str
    type: str
    since: datetime
    until: datetime
    total_samples: int
    overall_availability_percent: float
    per_agent: list[TargetAgentStats]


class TargetSeriesPoint(BaseModel):
    bucket_start: datetime
    agent_id: uuid.UUID
    samples: int
    rtt_avg_ms: float | None = None
    rtt_min_ms: float | None = None
    rtt_max_ms: float | None = None
    loss_percent: float | None = None
    success_count: int
    failure_count: int


class TargetSeriesAgent(BaseModel):
    """Per-agent legend metadata for chart rendering."""

    agent_id: uuid.UUID
    agent_label: str
    agent_tags: list[str]


class TargetSeries(BaseModel):
    target: str
    type: str
    since: datetime
    until: datetime
    bucket_seconds: int
    agents: list[TargetSeriesAgent]
    points: list[TargetSeriesPoint]
