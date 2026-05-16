import ipaddress
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class AgentRegisterRequest(BaseModel):
    hostname: str = Field(min_length=1, max_length=255)
    version: str = Field(default="", max_length=64)
    capabilities: list[str] = Field(default_factory=list)


class AgentRegisterResponse(BaseModel):
    agent_id: uuid.UUID
    token: str
    poll_interval: int = 5


class AgentHeartbeatRequest(BaseModel):
    version: str | None = None
    capabilities: list[str] | None = None


class AgentHeartbeatResponse(BaseModel):
    status: str
    poll_interval: int = 5


class AgentOut(BaseModel):
    id: uuid.UUID
    hostname: str
    display_name: str | None = None
    description: str | None = None
    version: str
    status: str
    public_ip: str | None = None
    capabilities: list[str]
    tags: list[str]
    last_seen: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    city: str | None = None
    country_code: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("public_ip", mode="before")
    @classmethod
    def _ip_to_str(cls, v: Any) -> Any:
        # Postgres INET → Python ipaddress.IPv4Address / IPv6Address; coerce to str.
        if isinstance(v, ipaddress.IPv4Address | ipaddress.IPv6Address):
            return str(v)
        return v


class AgentApproveRequest(BaseModel):
    tags: list[str] = Field(default_factory=list)


class AgentUpdateRequest(BaseModel):
    """Admin-side update of mutable agent metadata.

    Fields are optional — only the keys present in the request body are
    applied. Pass an empty string for display_name/description to clear them.
    Status can only be flipped between active and disabled; pending/rejected
    transitions go through dedicated endpoints.
    """

    display_name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    tags: list[str] | None = None
    status: str | None = Field(default=None, pattern=r"^(active|disabled)$")
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    city: str | None = Field(default=None, max_length=128)
    country_code: str | None = Field(default=None, max_length=8)

    @field_validator("tags")
    @classmethod
    def _trim_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        # Normalise: trim, lowercase, drop empties, dedupe (preserve order).
        seen: set[str] = set()
        out: list[str] = []
        for raw in v:
            t = raw.strip().lower()
            if not t or t in seen:
                continue
            if len(t) > 32:
                continue
            seen.add(t)
            out.append(t)
        return out
