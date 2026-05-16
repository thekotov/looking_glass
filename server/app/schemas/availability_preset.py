import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class AvailabilityPresetBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    targets: list[str] = Field(min_length=1, max_length=50)
    check_icmp: bool = True
    check_tcp: bool = True
    tcp_port: int = Field(default=443, ge=1, le=65535)
    timeout_sec: int = Field(default=5, ge=1, le=30)
    ping_count: int = Field(default=4, ge=1, le=20)
    agent_ids: list[uuid.UUID] = Field(default_factory=list)


class AvailabilityPresetCreate(AvailabilityPresetBase):
    pass


class AvailabilityPresetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    targets: list[str] | None = Field(default=None, min_length=1, max_length=50)
    check_icmp: bool | None = None
    check_tcp: bool | None = None
    tcp_port: int | None = Field(default=None, ge=1, le=65535)
    timeout_sec: int | None = Field(default=None, ge=1, le=30)
    ping_count: int | None = Field(default=None, ge=1, le=20)
    agent_ids: list[uuid.UUID] | None = None


class AvailabilityPresetOut(AvailabilityPresetBase):
    id: uuid.UUID
    last_run_group_id: uuid.UUID | None = None
    last_run_at: datetime | None = None
    runs_total: int
    created_by: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
