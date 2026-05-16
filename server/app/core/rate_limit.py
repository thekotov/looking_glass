"""Redis-backed rate limits.

Two strategies in one place:

- ``check_login_rate_limit``: brute-force protection. Per-IP and per-username
  counters increment on failure, reset on success. Blocks after a threshold
  within the window.
- ``check_task_create_rate_limit``: per-user fixed-window counter. Blocks when
  the count exceeds the cap.

The blocking helpers raise ``HTTPException(429)`` — leaves logging to the caller.
"""
from __future__ import annotations

from fastapi import HTTPException

from app.core.pubsub import get_pubsub

LOGIN_FAIL_WINDOW_SEC = 60 * 10  # 10 min sliding-ish window
LOGIN_FAIL_THRESHOLD = 10
TASK_RATE_WINDOW_SEC = 60
TASK_RATE_THRESHOLD = 60  # tasks per user per minute


async def check_login_rate_limit(ip: str | None, username: str) -> None:
    """Raise 429 if either the IP or the username has too many recent failures."""
    if ip is None:
        return  # not enough info to rate-limit; just allow
    client = get_pubsub().client
    ip_key = f"lg:rl:login_fail:ip:{ip}"
    user_key = f"lg:rl:login_fail:user:{username}"
    ip_n = await client.get(ip_key)
    user_n = await client.get(user_key)
    if (ip_n and int(ip_n) >= LOGIN_FAIL_THRESHOLD) or (
        user_n and int(user_n) >= LOGIN_FAIL_THRESHOLD
    ):
        raise HTTPException(status_code=429, detail="too many login attempts, try again later")


async def record_login_failure(ip: str | None, username: str) -> None:
    if ip is None:
        return
    client = get_pubsub().client
    for key in (f"lg:rl:login_fail:ip:{ip}", f"lg:rl:login_fail:user:{username}"):
        async with client.pipeline() as pipe:
            pipe.incr(key)
            pipe.expire(key, LOGIN_FAIL_WINDOW_SEC)
            await pipe.execute()


async def record_login_success(ip: str | None, username: str) -> None:
    if ip is None:
        return
    client = get_pubsub().client
    await client.delete(f"lg:rl:login_fail:ip:{ip}", f"lg:rl:login_fail:user:{username}")


async def check_task_create_rate_limit(user_id: str) -> None:
    """Allow N task creations per user per minute. Returns silently if under cap."""
    client = get_pubsub().client
    key = f"lg:rl:task_create:{user_id}"
    async with client.pipeline() as pipe:
        pipe.incr(key)
        pipe.expire(key, TASK_RATE_WINDOW_SEC)
        n, _ = await pipe.execute()
    if int(n) > TASK_RATE_THRESHOLD:
        raise HTTPException(
            status_code=429,
            detail=f"task creation rate limit: {TASK_RATE_THRESHOLD}/min",
        )


PUBLIC_LOOKUP_WINDOW_SEC = 60 * 10  # 10 min
PUBLIC_LOOKUP_THRESHOLD = 10


async def check_public_lookup_rate_limit(ip: str | None) -> None:
    """Per-IP rate limit for the no-auth /api/public/lookup endpoint.

    Anonymous endpoint, so the only signal we have is the source IP. Whoever
    sits behind NAT shares the bucket — that's intentional for an abuse cap.
    """
    if ip is None:
        # No IP means we can't bucket the caller safely — refuse rather than
        # let an attacker punch through with X-Forwarded-For tricks.
        raise HTTPException(status_code=429, detail="cannot identify caller")
    client = get_pubsub().client
    key = f"lg:rl:public_lookup:ip:{ip}"
    async with client.pipeline() as pipe:
        pipe.incr(key)
        pipe.expire(key, PUBLIC_LOOKUP_WINDOW_SEC)
        n, _ = await pipe.execute()
    if int(n) > PUBLIC_LOOKUP_THRESHOLD:
        raise HTTPException(
            status_code=429,
            detail=(
                f"too many lookups from this IP "
                f"({PUBLIC_LOOKUP_THRESHOLD}/{PUBLIC_LOOKUP_WINDOW_SEC // 60} min)"
            ),
        )
