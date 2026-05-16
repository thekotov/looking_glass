"""Lightweight enrichment lookups for a target: rDNS / ASN / org / city / AS path.

Used by the "About target" panel on the trends page. Two endpoints:
  - /lookup → resolve + RDNS + ASN + geo (single ip-api.com call)
  - /aspath → BGP AS path from RIPEstat looking-glass data
"""

import asyncio
import ipaddress
import logging
import socket
from collections import Counter
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.deps import CurrentUser

log = logging.getLogger(__name__)
router = APIRouter(prefix="/tools", tags=["tools"])

_IPAPI_URL = (
    "http://ip-api.com/json/{ip}"
    "?fields=status,message,country,countryCode,region,regionName,city,"
    "lat,lon,timezone,isp,org,as,asname,reverse"
)


class LookupResult(BaseModel):
    target: str
    resolved_ip: str | None = None
    is_ipv4: bool = False
    rdns: str | None = None
    asn: str | None = None
    asname: str | None = None
    org: str | None = None
    isp: str | None = None
    country: str | None = None
    country_code: str | None = None
    region: str | None = None
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    timezone: str | None = None
    error: str | None = None


def _is_routable(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (
        a.is_private
        or a.is_loopback
        or a.is_link_local
        or a.is_multicast
        or a.is_reserved
        or a.is_unspecified
    )


async def _resolve_to_ip(target: str) -> tuple[str | None, str | None]:
    """Returns (ip, error). Strips scheme if present (http://x → x)."""
    cleaned = target.strip()
    # Strip URL scheme + path.
    if "://" in cleaned:
        cleaned = cleaned.split("://", 1)[1]
    cleaned = cleaned.split("/", 1)[0].split(":", 1)[0]

    # Already an IP?
    try:
        ipaddress.ip_address(cleaned)
        return cleaned, None
    except ValueError:
        pass

    # DNS resolution. Done off-loop to keep the request cheap.
    try:
        infos = await asyncio.get_event_loop().getaddrinfo(
            cleaned, None, family=socket.AF_INET
        )
    except (socket.gaierror, OSError) as e:
        return None, f"DNS resolution failed: {e}"
    if not infos:
        return None, "no addresses resolved"
    # Pick the first IPv4.
    return infos[0][4][0], None


async def _rdns(ip: str) -> str | None:
    loop = asyncio.get_event_loop()
    try:
        host, _, _ = await loop.run_in_executor(None, socket.gethostbyaddr, ip)
        return host
    except (socket.herror, socket.gaierror, OSError):
        return None


async def _ipapi(ip: str) -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(_IPAPI_URL.format(ip=ip))
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, asyncio.TimeoutError) as e:
        log.warning("ip-api lookup failed for %s: %s", ip, e)
        return None


@router.get("/lookup", response_model=LookupResult)
async def lookup(
    _: CurrentUser,
    target: str = Query(..., min_length=1, max_length=255),
) -> LookupResult:
    """Resolve target → IP, then enrich with rDNS / ASN / geo via ip-api.com.

    Bounded by:
      - DNS resolution (a few hundred ms)
      - rDNS lookup (synchronous in stdlib, run in threadpool)
      - one HTTP call to ip-api.com (5s timeout)
    """
    ip, err = await _resolve_to_ip(target)
    if ip is None:
        return LookupResult(target=target, error=err or "could not resolve")
    if not _is_routable(ip):
        return LookupResult(
            target=target,
            resolved_ip=ip,
            is_ipv4=True,
            error="resolved to a non-public address; enrichment skipped",
        )

    # Fan out RDNS and ip-api in parallel — they're independent.
    rdns_task = asyncio.create_task(_rdns(ip))
    api_task = asyncio.create_task(_ipapi(ip))
    rdns, data = await asyncio.gather(rdns_task, api_task)

    result = LookupResult(target=target, resolved_ip=ip, is_ipv4=True, rdns=rdns)
    if data is None:
        result.error = "geo/ASN enrichment unavailable"
        return result
    if data.get("status") != "success":
        result.error = data.get("message") or "lookup failed"
        return result

    result.asn = data.get("as") or None
    result.asname = data.get("asname") or None
    result.org = data.get("org") or None
    result.isp = data.get("isp") or None
    result.country = data.get("country") or None
    result.country_code = data.get("countryCode") or None
    result.region = data.get("regionName") or None
    result.city = data.get("city") or None
    result.latitude = data.get("lat")
    result.longitude = data.get("lon")
    result.timezone = data.get("timezone") or None
    # ip-api also reports reverse — keep it as fallback if our rDNS missed.
    if not result.rdns and data.get("reverse"):
        result.rdns = data["reverse"]
    return result


# ---------- AS path ----------


class ASPathResult(BaseModel):
    target: str
    resolved_ip: str | None = None
    origin_asn: int | None = None
    prefix: str | None = None
    # Each entry is a sequence of ASNs from a peer towards the destination.
    # Multiple paths come from different RIPE RIS collectors / peers.
    paths: list[list[int]] = []
    # Most-common path (mode across all peers) — useful as the "consensus" path.
    consensus_path: list[int] = []
    error: str | None = None


_RIPE_LG_URL = "https://stat.ripe.net/data/looking-glass/data.json?resource={ip}"


@router.get("/aspath", response_model=ASPathResult)
async def aspath(
    _: CurrentUser,
    target: str = Query(..., min_length=1, max_length=255),
) -> ASPathResult:
    """BGP AS path from publicly visible RIS routes for the target.

    Calls RIPEstat looking-glass endpoint which aggregates BGP routes seen by
    the RIS collectors worldwide. Returns the most common path plus a sample
    of all distinct paths.
    """
    ip, err = await _resolve_to_ip(target)
    if ip is None:
        return ASPathResult(target=target, error=err or "could not resolve")
    if not _is_routable(ip):
        return ASPathResult(
            target=target,
            resolved_ip=ip,
            error="resolved to a non-public address",
        )

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(_RIPE_LG_URL.format(ip=ip))
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, asyncio.TimeoutError) as e:
        log.warning("ripestat fetch failed for %s: %s", ip, e)
        return ASPathResult(
            target=target,
            resolved_ip=ip,
            error=f"ripestat unavailable: {e}",
        )

    body = data.get("data") or {}
    rrcs = body.get("rrcs") or []
    paths: list[list[int]] = []
    prefix: str | None = None
    for rrc in rrcs:
        for peer in rrc.get("peers") or []:
            raw = peer.get("as_path", "")
            asns = _parse_as_path(raw)
            if asns:
                paths.append(asns)
            if not prefix and peer.get("prefix"):
                prefix = peer["prefix"]

    if not paths:
        return ASPathResult(
            target=target,
            resolved_ip=ip,
            prefix=prefix,
            error="no BGP routes seen",
        )

    # Consensus: most-common full path (as a tuple). Falls back to longest if tied.
    counter = Counter(tuple(p) for p in paths)
    consensus = list(counter.most_common(1)[0][0])
    # Dedupe paths for display.
    distinct: list[list[int]] = []
    seen: set[tuple[int, ...]] = set()
    for p in paths:
        key = tuple(p)
        if key in seen:
            continue
        seen.add(key)
        distinct.append(p)

    origin = consensus[-1] if consensus else None
    return ASPathResult(
        target=target,
        resolved_ip=ip,
        origin_asn=origin,
        prefix=prefix,
        paths=distinct[:8],  # cap to keep payload small
        consensus_path=consensus,
    )


def _parse_as_path(raw: str) -> list[int]:
    """RIPEstat returns AS path as a space-separated string of decimal ASNs,
    occasionally with `{set}` notation for AS sets — we strip those."""
    if not raw:
        return []
    out: list[int] = []
    for tok in raw.split():
        # Drop `{1234,5678}` AS-set notation.
        if tok.startswith("{") or "," in tok:
            continue
        try:
            out.append(int(tok))
        except ValueError:
            continue
    return out
