"""Target validation for a public looking glass.

Goal: refuse any target that would let a user weaponize the LG to probe
private/internal networks, cloud metadata services, or addresses that have
no business being on the public internet.

The same logic must exist on the agent (see agent/internal/validator/targets.go).
If the server is compromised, the agent must not blindly trust task payloads.

The validator accepts either:
  - a string parsed as IPv4/IPv6 address
  - a hostname → resolved via DNS; ALL resolved IPs must pass the check
"""
from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass, field
from typing import Iterable
from urllib.parse import urlparse

# Networks that are forbidden as targets in public-LG mode.
# Order: most likely abuse first (private, link-local, metadata).
_BLOCKED_V4 = [
    ipaddress.ip_network("0.0.0.0/8"),          # "this network"
    ipaddress.ip_network("10.0.0.0/8"),         # RFC1918
    ipaddress.ip_network("100.64.0.0/10"),      # CGNAT
    ipaddress.ip_network("127.0.0.0/8"),        # loopback
    ipaddress.ip_network("169.254.0.0/16"),     # link-local (incl. 169.254.169.254 metadata)
    ipaddress.ip_network("172.16.0.0/12"),      # RFC1918
    ipaddress.ip_network("192.0.0.0/24"),       # IETF assignment
    ipaddress.ip_network("192.0.2.0/24"),       # TEST-NET-1
    ipaddress.ip_network("192.168.0.0/16"),     # RFC1918
    ipaddress.ip_network("198.18.0.0/15"),      # benchmarking
    ipaddress.ip_network("198.51.100.0/24"),    # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),     # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),        # multicast
    ipaddress.ip_network("240.0.0.0/4"),        # reserved
    ipaddress.ip_network("255.255.255.255/32"), # broadcast
]

_BLOCKED_V6 = [
    ipaddress.ip_network("::/128"),       # unspecified
    ipaddress.ip_network("::1/128"),      # loopback
    ipaddress.ip_network("::ffff:0:0/96"), # IPv4-mapped (handled by the v4 logic via .ipv4_mapped)
    ipaddress.ip_network("fe80::/10"),    # link-local
    ipaddress.ip_network("fc00::/7"),     # unique local (ULA)
    ipaddress.ip_network("ff00::/8"),     # multicast
    ipaddress.ip_network("2001:db8::/32"), # documentation
]

# Conservative hostname regex: letters, digits, dots, hyphens. 1-253 chars total.
_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*"
    r"[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$"
)


class TargetValidationError(ValueError):
    """Raised when a target is rejected. Message is user-safe."""


def _check_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        _check_ip(ip.ipv4_mapped)
        return
    if isinstance(ip, ipaddress.IPv4Address):
        for net in _BLOCKED_V4:
            if ip in net:
                raise TargetValidationError(
                    f"target {ip} is in blocked network {net} (private/reserved)"
                )
        return
    for net in _BLOCKED_V6:
        if ip in net:
            raise TargetValidationError(
                f"target {ip} is in blocked network {net} (private/reserved)"
            )


def _resolve(hostname: str) -> Iterable[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise TargetValidationError(f"DNS lookup failed for {hostname}: {exc}") from exc
    seen: set[str] = set()
    for _, _, _, _, sockaddr in infos:
        addr = sockaddr[0]
        if addr in seen:
            continue
        seen.add(addr)
        try:
            yield ipaddress.ip_address(addr)
        except ValueError:
            continue


@dataclass
class ResolvedTarget:
    """Result of validate_target_resolved: normalized string plus the IPs we
    actually checked. Useful for audit logs and for pinning the address an
    agent should connect to (defense against DNS rebinding between server
    validation and the eventual connect — though the agent re-validates and
    re-resolves, so this is informational on the server side)."""

    normalized: str
    resolved_ips: list[str] = field(default_factory=list)


def validate_target(target: str) -> str:
    """Backwards-compatible thin wrapper around validate_target_resolved.

    Returns just the normalized target string. Existing call sites use this
    for the value persisted on the Task row.
    """
    return validate_target_resolved(target).normalized


def validate_target_resolved(target: str) -> ResolvedTarget:
    """Normalize, validate, and return the resolved IPs (if any).

    Raises TargetValidationError if the target is not allowed. For an IP
    literal, resolved_ips contains that single address. For a hostname,
    it contains every A/AAAA record we checked against the blocklist.
    """
    if not target or len(target) > 2048:
        raise TargetValidationError("target is empty or too long")

    t = target.strip().lower()

    # URL form: validate the hostname component and return the URL as-is so
    # http_check can use it directly. Path/query are not security-relevant
    # for our blocklist — the blocklist applies to the address we'll connect to.
    if t.startswith("http://") or t.startswith("https://"):
        u = urlparse(t)
        if not u.hostname:
            raise TargetValidationError("URL missing hostname")
        inner = validate_target_resolved(u.hostname)
        return ResolvedTarget(normalized=t, resolved_ips=inner.resolved_ips)

    # Hostname/IP path uses the conservative length limit.
    if len(t) > 253:
        raise TargetValidationError("target is empty or too long")

    # Try IP literal first.
    try:
        ip = ipaddress.ip_address(t)
    except ValueError:
        ip = None

    if ip is not None:
        _check_ip(ip)
        return ResolvedTarget(normalized=str(ip), resolved_ips=[str(ip)])

    # Hostname path.
    if not _HOSTNAME_RE.match(t):
        raise TargetValidationError(f"target {t!r} is not a valid hostname or IP")

    addresses = list(_resolve(t))
    if not addresses:
        raise TargetValidationError(f"hostname {t} resolves to no addresses")
    for addr in addresses:
        _check_ip(addr)

    return ResolvedTarget(normalized=t, resolved_ips=[str(a) for a in addresses])
