"""Tests for the Redis-backed rate-limit helpers.

These hit the real Redis from the deployment. Each test wipes its own keys
in setup and teardown so reruns are clean. Skipped automatically if no Redis
is reachable (so unit-only runs don't have to spin one up).
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest
import redis.asyncio as aioredis
from fastapi import HTTPException

from app.core import pubsub as pubsub_module
from app.core.config import settings
from app.core.rate_limit import (
    PUBLIC_LOOKUP_THRESHOLD,
    check_login_rate_limit,
    check_public_lookup_rate_limit,
    record_login_failure,
    record_login_success,
)


@pytest.fixture(autouse=True)
async def _redis_or_skip() -> AsyncIterator[None]:
    """Rebind the pubsub singleton's client to the current event loop.

    `redis.asyncio` clients hold a connection bound to whatever loop opened it.
    pytest-asyncio's default function-scoped loop means a process-wide singleton
    gets a dead loop on test #2. We swap in a fresh client per test and tear it
    down at the end.
    """
    fresh = aioredis.from_url(str(settings.redis_url), decode_responses=True)
    try:
        await fresh.ping()
    except Exception as exc:
        await fresh.aclose()
        pytest.skip(f"Redis not reachable: {exc}")

    # Replace whichever client the pubsub singleton was using with our
    # per-test one. The module-level helpers (check_*, record_*) call
    # `get_pubsub().client`, so this is the only thing that needs swapping.
    if pubsub_module._singleton is None:
        pubsub_module._singleton = pubsub_module.PubSub(str(settings.redis_url))
    original = pubsub_module._singleton._client
    pubsub_module._singleton._client = fresh
    try:
        yield
    finally:
        pubsub_module._singleton._client = original
        await fresh.aclose()


async def _flush_keys(prefix: str) -> None:
    """Delete every key matching the prefix. SCAN-based so we don't FLUSHDB."""
    client = pubsub_module._singleton._client  # set by the autouse fixture
    async for key in client.scan_iter(match=f"{prefix}*"):
        await client.delete(key)


# ---------- login fail counter ----------


async def test_login_rate_limit_allows_under_threshold() -> None:
    ip = "203.0.113.42"  # TEST-NET-3, won't collide with real traffic
    user = "test_under_threshold"
    await _flush_keys(f"lg:rl:login_fail:ip:{ip}")
    await _flush_keys(f"lg:rl:login_fail:user:{user}")

    # 5 failures < threshold of 10 — must not block.
    for _ in range(5):
        await record_login_failure(ip, user)
    await check_login_rate_limit(ip, user)  # should not raise


async def test_login_rate_limit_blocks_after_threshold() -> None:
    ip = "203.0.113.43"
    user = "test_over_threshold"
    await _flush_keys(f"lg:rl:login_fail:ip:{ip}")
    await _flush_keys(f"lg:rl:login_fail:user:{user}")

    for _ in range(10):
        await record_login_failure(ip, user)

    with pytest.raises(HTTPException) as exc:
        await check_login_rate_limit(ip, user)
    assert exc.value.status_code == 429


async def test_login_success_clears_counter() -> None:
    ip = "203.0.113.44"
    user = "test_success_clears"
    await _flush_keys(f"lg:rl:login_fail:ip:{ip}")
    await _flush_keys(f"lg:rl:login_fail:user:{user}")

    for _ in range(8):
        await record_login_failure(ip, user)
    await record_login_success(ip, user)

    # The counter is gone — even another 8 fails should still be under threshold.
    for _ in range(8):
        await record_login_failure(ip, user)
    await check_login_rate_limit(ip, user)  # not raises


async def test_login_no_ip_does_not_crash() -> None:
    # No client IP (test client edge case). Should silently allow.
    await check_login_rate_limit(None, "anyuser")
    await record_login_failure(None, "anyuser")
    await record_login_success(None, "anyuser")


# ---------- public lookup quota ----------


async def test_public_lookup_under_quota() -> None:
    ip = "203.0.113.51"
    await _flush_keys(f"lg:rl:public_lookup:ip:{ip}")
    # PUBLIC_LOOKUP_THRESHOLD is the cap. Calls 1..THRESHOLD must all pass.
    for _ in range(PUBLIC_LOOKUP_THRESHOLD):
        await check_public_lookup_rate_limit(ip)


async def test_public_lookup_over_quota() -> None:
    ip = "203.0.113.52"
    await _flush_keys(f"lg:rl:public_lookup:ip:{ip}")
    for _ in range(PUBLIC_LOOKUP_THRESHOLD):
        await check_public_lookup_rate_limit(ip)
    # The +1 call must trip.
    with pytest.raises(HTTPException) as exc:
        await check_public_lookup_rate_limit(ip)
    assert exc.value.status_code == 429
    assert "too many lookups" in exc.value.detail.lower()


async def test_public_lookup_no_ip_refused() -> None:
    # Refusing-when-unknown is intentional: an attacker spoofing a missing
    # peer would otherwise punch past the rate limit.
    with pytest.raises(HTTPException) as exc:
        await check_public_lookup_rate_limit(None)
    assert exc.value.status_code == 429


async def test_public_lookup_different_ips_independent() -> None:
    a = "203.0.113.61"
    b = "203.0.113.62"
    await _flush_keys(f"lg:rl:public_lookup:ip:{a}")
    await _flush_keys(f"lg:rl:public_lookup:ip:{b}")

    # Burn through one IP's quota — the other must remain unaffected.
    for _ in range(PUBLIC_LOOKUP_THRESHOLD):
        await check_public_lookup_rate_limit(a)
    with pytest.raises(HTTPException):
        await check_public_lookup_rate_limit(a)
    # Other IP still fine.
    await check_public_lookup_rate_limit(b)


async def test_public_lookup_concurrent_callers_respect_cap() -> None:
    """Multiple concurrent callers from the same IP share the bucket — the
    Redis INCR is atomic, so the cap holds even under concurrency."""
    ip = "203.0.113.71"
    await _flush_keys(f"lg:rl:public_lookup:ip:{ip}")

    async def one_call() -> bool:
        try:
            await check_public_lookup_rate_limit(ip)
            return True
        except HTTPException:
            return False

    # Fire 3x more calls than the quota in parallel.
    results = await asyncio.gather(
        *[one_call() for _ in range(PUBLIC_LOOKUP_THRESHOLD * 3)]
    )
    allowed = sum(results)
    # Exactly THRESHOLD pass — anything more would indicate INCR isn't atomic.
    assert allowed == PUBLIC_LOOKUP_THRESHOLD
