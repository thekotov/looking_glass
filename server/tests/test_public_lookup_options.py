"""Tests for the anonymous-lookup option clamping.

The public endpoint accepts user-supplied params but force-clamps the actual
options dict that hits the agent — so e.g. an unauthenticated caller can't
ask for `count=10000`. These tests verify the clamps directly, without
spinning up the API.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.public import _build_public_options
from app.schemas.public_lookup import PublicLookupCreate


def _make(type_: str, **kwargs) -> PublicLookupCreate:
    return PublicLookupCreate(
        type=type_,
        target=kwargs.pop("target", "1.1.1.1"),
        agent_id="00000000-0000-0000-0000-000000000000",
        **kwargs,
    )


def test_ping_count_clamps_to_max() -> None:
    # Schema-level ge=1, le=10 already blocks count > 10. Confirm the
    # safe default path inside _build_public_options.
    opts = _build_public_options(_make("ping", count=10))
    assert opts == {
        "count": 10,
        "interval_ms": 1000,
        "timeout_sec": 5,
        "ipv6": False,
    }


def test_ping_default_count_when_missing() -> None:
    opts = _build_public_options(_make("ping"))
    assert opts["count"] == 5


def test_ping_clamps_silly_count_to_minimum() -> None:
    # Schema rejects count < 1 — confirm at the Pydantic boundary.
    with pytest.raises(Exception):
        _make("ping", count=0)


def test_traceroute_hops_fixed_regardless_of_input() -> None:
    # Anonymous traceroute is always capped at 20 hops, queries=1, timeout=3.
    opts = _build_public_options(_make("traceroute"))
    assert opts == {
        "max_hops": 20,
        "queries_per_hop": 1,
        "timeout_sec": 3,
        "ipv6": False,
    }


def test_tcp_connect_requires_port() -> None:
    with pytest.raises(HTTPException) as exc:
        _build_public_options(_make("tcp_connect"))
    assert exc.value.status_code == 400
    assert "port" in exc.value.detail.lower()


def test_tcp_connect_with_port() -> None:
    opts = _build_public_options(_make("tcp_connect", port=443))
    assert opts == {
        "port": 443,
        "timeout_sec": 5,
        "ipv6": False,
        "banner_grab": False,
    }


def test_banner_grab_always_off_for_anonymous() -> None:
    # No user-supplied way to enable banner grab via the public form.
    opts = _build_public_options(_make("tcp_connect", port=22))
    assert opts["banner_grab"] is False
