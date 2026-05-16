"""Unit tests for task_params validator.

Pure-function tests — no DB, no Redis, no network. Cover:
  * defaults are applied when keys are missing
  * out-of-range values raise
  * lists are deduped/sorted
  * banner_grab sub-params only appear when the flag is on
  * unsupported task types raise
"""
from __future__ import annotations

import pytest

from app.validators.task_params import (
    TaskParamsError,
    validate_task_params,
)


# ----- defaults -----


def test_ping_defaults() -> None:
    out = validate_task_params("ping", {})
    assert out == {
        "count": 5,
        "timeout_sec": 5,
        "interval_ms": 1000,
        "size_bytes": 56,
        "ipv6": False,
    }


def test_traceroute_defaults() -> None:
    out = validate_task_params("traceroute", {})
    assert out["max_hops"] == 30
    assert out["queries_per_hop"] == 1


def test_mtr_tcp_defaults_include_port() -> None:
    out = validate_task_params("mtr_tcp", {})
    assert out["port"] == 443
    assert out["cycles"] == 10


# ----- range enforcement -----


@pytest.mark.parametrize(
    "key,value",
    [
        ("count", 0),
        ("count", 101),
        ("timeout_sec", 0),
        ("timeout_sec", 31),
        ("interval_ms", 100),  # below min 250
        ("interval_ms", 6000),  # above max
    ],
)
def test_ping_rejects_out_of_range(key: str, value: int) -> None:
    with pytest.raises(TaskParamsError, match=key):
        validate_task_params("ping", {key: value})


def test_hping3_floor_protects_amplifier_abuse() -> None:
    # interval_ms must be >= 10 — anything lower turns the agent into a flood
    # amplifier.
    with pytest.raises(TaskParamsError, match="interval_ms"):
        validate_task_params("hping3", {"interval_ms": 5})


def test_hping3_rejects_unknown_mode() -> None:
    with pytest.raises(TaskParamsError, match="mode"):
        validate_task_params("hping3", {"mode": "raw"})


# ----- port handling -----


def test_port_too_low_rejected() -> None:
    with pytest.raises(TaskParamsError, match="port"):
        validate_task_params("tcp_connect", {"port": 0})


def test_port_too_high_rejected() -> None:
    with pytest.raises(TaskParamsError, match="port"):
        validate_task_params("tcp_connect", {"port": 70000})


def test_port_default_when_missing() -> None:
    out = validate_task_params("tcp_connect", {})
    assert out["port"] == 443


# ----- tcp_scan list handling -----


def test_tcp_scan_requires_non_empty_ports() -> None:
    with pytest.raises(TaskParamsError, match="ports"):
        validate_task_params("tcp_scan", {"ports": []})


def test_tcp_scan_dedupes_and_sorts() -> None:
    out = validate_task_params("tcp_scan", {"ports": [443, 80, 80, 22]})
    assert out["ports"] == [22, 80, 443]


def test_tcp_scan_rejects_too_many_ports() -> None:
    with pytest.raises(TaskParamsError, match="too many"):
        validate_task_params("tcp_scan", {"ports": list(range(1, 1100))})


def test_tcp_scan_rejects_non_integer_port() -> None:
    with pytest.raises(TaskParamsError, match="not an integer"):
        validate_task_params("tcp_scan", {"ports": ["http"]})


def test_syn_scan_tighter_cap_than_tcp_scan() -> None:
    # 256 OK
    validate_task_params("syn_scan", {"ports": list(range(1, 257))})
    # 257 not OK — different cap from tcp_scan's 1024
    with pytest.raises(TaskParamsError, match="too many ports"):
        validate_task_params("syn_scan", {"ports": list(range(1, 258))})


# ----- banner_grab conditional sub-params -----


def test_tcp_connect_banner_off_omits_subparams() -> None:
    out = validate_task_params("tcp_connect", {})
    assert "banner_bytes" not in out
    assert "banner_timeout_ms" not in out


def test_tcp_connect_banner_on_includes_defaults() -> None:
    out = validate_task_params("tcp_connect", {"banner_grab": True})
    assert out["banner_bytes"] == 256
    assert out["banner_timeout_ms"] == 2000


def test_tcp_connect_banner_on_validates_subparams() -> None:
    with pytest.raises(TaskParamsError, match="banner_bytes"):
        validate_task_params(
            "tcp_connect", {"banner_grab": True, "banner_bytes": 99999}
        )


# ----- http_check headers -----


def test_http_check_headers_must_be_object() -> None:
    with pytest.raises(TaskParamsError, match="headers"):
        validate_task_params("http_check", {"headers": ["X-Header: value"]})


def test_http_check_rejects_long_header_value() -> None:
    with pytest.raises(TaskParamsError, match="too long"):
        validate_task_params(
            "http_check", {"headers": {"X-Test": "a" * 600}}
        )


def test_http_check_rejects_unknown_method() -> None:
    with pytest.raises(TaskParamsError, match="method"):
        validate_task_params("http_check", {"method": "TEAPOT"})


# ----- dns -----


def test_dns_rejects_unknown_record_type() -> None:
    with pytest.raises(TaskParamsError, match="record_type"):
        validate_task_params("dns", {"record_type": "XXX"})


@pytest.mark.parametrize("rt", ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "PTR"])
def test_dns_accepts_all_supported_records(rt: str) -> None:
    out = validate_task_params("dns", {"record_type": rt})
    assert out["record_type"] == rt


# ----- bool coercion -----


def test_ipv6_accepts_string_true() -> None:
    out = validate_task_params("ping", {"ipv6": "true"})
    assert out["ipv6"] is True


def test_ipv6_rejects_garbage() -> None:
    with pytest.raises(TaskParamsError, match="ipv6"):
        validate_task_params("ping", {"ipv6": "maybe"})


# ----- registry -----


def test_unsupported_task_type_rejected() -> None:
    with pytest.raises(TaskParamsError, match="unsupported"):
        validate_task_params("magic_packet_attack", {})


def test_empty_opts_uses_defaults() -> None:
    # None is normalised to empty dict inside the entry point.
    out = validate_task_params("ping", None)  # type: ignore[arg-type]
    assert out["count"] == 5
