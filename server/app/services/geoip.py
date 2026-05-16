"""Server-side IP geolocation via ip-api.com (free tier, no key required).

This is a one-shot lookup invoked by the admin from the UI ("Detect from IP").
Result is persisted on the Agent row, so we never call out again at request time.

Notes:
- ip-api.com free tier is HTTP-only and rate-limited to 45 req/min per source IP.
  That's enormous for what we use it for (one click per agent per admin session).
- For air-gapped deploys this whole thing is optional — admin can fill lat/lon
  manually and never trigger geo-detect.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

_API_URL = "http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,city,lat,lon"


class GeoLookupError(Exception):
    """User-safe message about why the lookup failed."""


@dataclass
class GeoResult:
    latitude: float
    longitude: float
    city: str | None
    country_code: str | None


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


async def lookup_ip(ip: str, timeout_sec: float = 4.0) -> GeoResult:
    """Resolve a public IP to lat/lon via ip-api.com. Raises GeoLookupError on failure."""
    if not _is_routable(ip):
        raise GeoLookupError("IP is not a public address")

    url = _API_URL.format(ip=ip)
    try:
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, asyncio.TimeoutError) as e:
        log.warning("geoip lookup failed for %s: %s", ip, e)
        raise GeoLookupError(f"upstream geoip lookup failed: {e}") from e

    if data.get("status") != "success":
        raise GeoLookupError(data.get("message") or "geoip lookup did not succeed")

    lat = data.get("lat")
    lon = data.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        raise GeoLookupError("geoip response missing coordinates")

    return GeoResult(
        latitude=float(lat),
        longitude=float(lon),
        city=data.get("city") or None,
        country_code=data.get("countryCode") or None,
    )
