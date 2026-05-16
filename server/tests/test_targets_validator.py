"""Unit tests for the server-side target validator.

Mirrors the cases in agent/internal/validator/targets_test.go — keep both in
sync when you change the blocklist. The companion test
``test_validators_sync_with_agent`` enforces this at the CIDR-list level.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.validators.targets import (
    TargetValidationError,
    _BLOCKED_V4,
    _BLOCKED_V6,
    _check_ip,
    validate_target,
)
import ipaddress


# IPs we must reject. Trim list aligned with the Go side.
BLOCKED_V4 = [
    "127.0.0.1",          # loopback
    "10.5.5.5",           # rfc1918 10/8
    "172.20.1.1",         # rfc1918 172.16/12 mid
    "192.168.1.1",        # rfc1918 192.168/16
    "169.254.10.20",      # link-local
    "169.254.169.254",    # AWS metadata
    "100.64.0.1",         # CGNAT
    "224.0.0.1",          # multicast
    "250.0.0.1",          # reserved 240/4
    "255.255.255.255",    # broadcast
    "192.0.2.5",          # TEST-NET-1
    "198.51.100.5",       # TEST-NET-2
    "203.0.113.5",        # TEST-NET-3
    "198.18.0.1",         # benchmarking
    "0.0.0.1",            # this-network 0/8
]

BLOCKED_V6 = [
    "::1",                # loopback
    "::",                 # unspecified
    "fe80::1",            # link-local
    "fc00::1",            # ULA
    "fd00::1",            # ULA
    "ff02::1",            # multicast
    "2001:db8::1",        # documentation
]

ALLOWED_V4 = [
    "1.1.1.1",            # cloudflare
    "8.8.8.8",             # google
    "11.0.0.1",            # near rfc1918
    "172.15.0.1",          # outside rfc1918
    "172.32.0.1",          # outside rfc1918
    "100.63.255.255",      # outside CGNAT
]

ALLOWED_V6 = [
    "2606:4700:4700::1111",  # cloudflare v6
    "2001:4860:4860::8888",  # google v6
]


@pytest.mark.parametrize("ip_str", BLOCKED_V4 + BLOCKED_V6)
def test_check_ip_rejects_blocked(ip_str: str) -> None:
    ip = ipaddress.ip_address(ip_str)
    with pytest.raises(TargetValidationError):
        _check_ip(ip)


@pytest.mark.parametrize("ip_str", ALLOWED_V4 + ALLOWED_V6)
def test_check_ip_allows_public(ip_str: str) -> None:
    ip = ipaddress.ip_address(ip_str)
    # Must not raise.
    _check_ip(ip)


def test_validate_target_rejects_metadata_ip() -> None:
    with pytest.raises(TargetValidationError, match="blocked"):
        validate_target("169.254.169.254")


def test_validate_target_accepts_public_ip() -> None:
    assert validate_target("1.1.1.1") == "1.1.1.1"


def test_validate_target_lowercases() -> None:
    # IPv6 round-trips through ip_address(), which keeps the colon-hex form.
    assert validate_target("2606:4700:4700::1111") == "2606:4700:4700::1111"


def test_validate_target_url_form() -> None:
    # URL path is preserved verbatim; only the host portion is checked.
    assert validate_target("https://cloudflare.com/foo") == "https://cloudflare.com/foo"


def test_validate_target_url_with_private_host_rejected() -> None:
    with pytest.raises(TargetValidationError):
        validate_target("https://192.168.1.1/admin")


def test_validate_target_rejects_empty() -> None:
    with pytest.raises(TargetValidationError):
        validate_target("")


def test_validate_target_rejects_too_long() -> None:
    with pytest.raises(TargetValidationError):
        validate_target("a" * 3000)


# ---------------------------------------------------------------------------
# Drift guard: parse the Go validator's CIDR list and compare to ours.
# If this fails, you've changed one side but not the other.
# ---------------------------------------------------------------------------

_GO_FILE = Path(__file__).resolve().parents[2] / "agent" / "internal" / "validator" / "targets.go"


def _parse_go_cidrs(content: str, var_name: str) -> list[str]:
    """Pull out string literals between mustParseNets([]string{ ... }) for the
    named var. Source code is short and stable enough that a regex over
    multi-line strings is fine here."""
    pattern = re.compile(
        rf"var\s+{var_name}\s*=\s*mustParseNets\(\[\]string\{{(.*?)\}}\)",
        re.DOTALL,
    )
    m = pattern.search(content)
    if not m:
        raise AssertionError(f"could not find {var_name} block in Go validator")
    body = m.group(1)
    return re.findall(r'"([^"]+)"', body)


@pytest.mark.skipif(
    not _GO_FILE.exists(),
    reason="Go validator source not available in this checkout",
)
def test_blocked_networks_match_agent_source() -> None:
    """Every CIDR in the Python blocklist must also be in the Go blocklist (and
    vice versa). Catches the "I forgot to update the other side" bug class."""
    src = _GO_FILE.read_text(encoding="utf-8")
    go_v4 = set(_parse_go_cidrs(src, "blockedV4"))
    go_v6 = set(_parse_go_cidrs(src, "blockedV6"))

    py_v4 = {str(n) for n in _BLOCKED_V4}
    py_v6 = {str(n) for n in _BLOCKED_V6}

    # The Python side has one extra entry (`::ffff:0:0/96`) because Python's
    # ipaddress module exposes IPv4-mapped IPv6 as a separate object and we
    # route those back through the v4 path explicitly. The Go side doesn't
    # need it: net.IP.To4() collapses IPv4-mapped addresses to plain IPv4
    # before any range check happens. Python stringifies the network with
    # dotted-quad for the last 32 bits, so we filter by the canonical form
    # rather than the source-code spelling.
    py_v6_norm = py_v6 - {str(ipaddress.ip_network("::ffff:0:0/96"))}

    missing_in_go = py_v4 - go_v4
    missing_in_py = go_v4 - py_v4
    assert not missing_in_go, f"v4 nets in Python but missing in Go: {missing_in_go}"
    assert not missing_in_py, f"v4 nets in Go but missing in Python: {missing_in_py}"

    missing_in_go_v6 = py_v6_norm - go_v6
    missing_in_py_v6 = go_v6 - py_v6_norm
    assert not missing_in_go_v6, f"v6 nets in Python but missing in Go: {missing_in_go_v6}"
    assert not missing_in_py_v6, f"v6 nets in Go but missing in Python: {missing_in_py_v6}"
