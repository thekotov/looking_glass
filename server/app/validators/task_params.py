"""Per-task-type parameter validation.

Each validator takes the raw options dict from the user, validates it,
and returns a normalized dict suitable for storage and execution.

When adding a task type:
1. Add a function below with signature (opts: dict) -> dict.
2. Register it in VALIDATORS.
3. The agent must validate the same params before execution.
"""
from __future__ import annotations

from typing import Any, Callable

from app.models.task import TaskType


class TaskParamsError(ValueError):
    """User-safe message about why params are invalid."""


def _int(opts: dict[str, Any], key: str, *, default: int, min_v: int, max_v: int) -> int:
    raw = opts.get(key, default)
    try:
        v = int(raw)
    except (TypeError, ValueError) as exc:
        raise TaskParamsError(f"{key} must be an integer") from exc
    if v < min_v or v > max_v:
        raise TaskParamsError(f"{key} must be between {min_v} and {max_v}")
    return v


def _bool(opts: dict[str, Any], key: str, *, default: bool) -> bool:
    raw = opts.get(key, default)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        if raw.lower() in {"true", "1", "yes"}:
            return True
        if raw.lower() in {"false", "0", "no"}:
            return False
    raise TaskParamsError(f"{key} must be a boolean")


def _str(opts: dict[str, Any], key: str, *, default: str, choices: list[str] | None = None,
         max_len: int = 256) -> str:
    raw = opts.get(key, default)
    if not isinstance(raw, str):
        raise TaskParamsError(f"{key} must be a string")
    if len(raw) > max_len:
        raise TaskParamsError(f"{key} too long (max {max_len})")
    if choices is not None and raw not in choices:
        raise TaskParamsError(f"{key} must be one of {choices}")
    return raw


def _port(opts: dict[str, Any], key: str = "port", *, default: int | None = None,
          required: bool = True) -> int:
    if key not in opts and not required:
        return default  # type: ignore[return-value]
    return _int(opts, key, default=default or 0, min_v=1, max_v=65535)


# ---------- per-type validators ----------


def validate_ping(opts: dict[str, Any]) -> dict[str, Any]:
    return {
        "count": _int(opts, "count", default=5, min_v=1, max_v=100),
        "timeout_sec": _int(opts, "timeout_sec", default=5, min_v=1, max_v=30),
        "interval_ms": _int(opts, "interval_ms", default=1000, min_v=250, max_v=5000),
        "size_bytes": _int(opts, "size_bytes", default=56, min_v=8, max_v=65500),
        "ipv6": _bool(opts, "ipv6", default=False),
    }


def validate_traceroute(opts: dict[str, Any]) -> dict[str, Any]:
    return {
        "max_hops": _int(opts, "max_hops", default=30, min_v=1, max_v=64),
        "timeout_sec": _int(opts, "timeout_sec", default=3, min_v=1, max_v=10),
        "queries_per_hop": _int(opts, "queries_per_hop", default=1, min_v=1, max_v=3),
        "ipv6": _bool(opts, "ipv6", default=False),
    }


def validate_mtr(opts: dict[str, Any]) -> dict[str, Any]:
    return {
        "cycles": _int(opts, "cycles", default=10, min_v=1, max_v=100),
        "max_hops": _int(opts, "max_hops", default=30, min_v=1, max_v=64),
        "ipv6": _bool(opts, "ipv6", default=False),
    }


def validate_mtr_tcp(opts: dict[str, Any]) -> dict[str, Any]:
    return {
        "cycles": _int(opts, "cycles", default=10, min_v=1, max_v=100),
        "max_hops": _int(opts, "max_hops", default=30, min_v=1, max_v=64),
        "port": _port(opts, default=443),
        "ipv6": _bool(opts, "ipv6", default=False),
    }


def validate_tcp_connect(opts: dict[str, Any]) -> dict[str, Any]:
    out = {
        "port": _port(opts, default=443),
        "timeout_sec": _int(opts, "timeout_sec", default=5, min_v=1, max_v=30),
        "ipv6": _bool(opts, "ipv6", default=False),
        "banner_grab": _bool(opts, "banner_grab", default=False),
    }
    # Only validate banner sub-params when the feature is on, so the form can
    # omit them entirely.
    if out["banner_grab"]:
        out["banner_bytes"] = _int(opts, "banner_bytes", default=256, min_v=1, max_v=4096)
        out["banner_timeout_ms"] = _int(
            opts, "banner_timeout_ms", default=2000, min_v=100, max_v=10000
        )
    return out


_MAX_SCAN_PORTS = 1024  # hard cap to bound runtime and noise


def validate_tcp_scan(opts: dict[str, Any]) -> dict[str, Any]:
    raw_ports = opts.get("ports")
    if not isinstance(raw_ports, list) or not raw_ports:
        raise TaskParamsError("ports must be a non-empty list of integers")
    ports: list[int] = []
    for p in raw_ports:
        try:
            pi = int(p)
        except (TypeError, ValueError) as exc:
            raise TaskParamsError(f"port {p!r} is not an integer") from exc
        if pi < 1 or pi > 65535:
            raise TaskParamsError(f"port {pi} out of range")
        ports.append(pi)
    if len(ports) > _MAX_SCAN_PORTS:
        raise TaskParamsError(f"too many ports (max {_MAX_SCAN_PORTS})")
    return {
        "ports": sorted(set(ports)),
        "timeout_sec": _int(opts, "timeout_sec", default=3, min_v=1, max_v=30),
        "concurrency": _int(opts, "concurrency", default=32, min_v=1, max_v=256),
        "ipv6": _bool(opts, "ipv6", default=False),
    }


_HPING3_MODES = ["tcp_syn", "tcp_ack", "tcp_fin", "udp", "icmp"]


def validate_hping3(opts: dict[str, Any]) -> dict[str, Any]:
    return {
        "mode": _str(opts, "mode", default="tcp_syn", choices=_HPING3_MODES, max_len=16),
        "port": _port(opts, default=80),
        "count": _int(opts, "count", default=5, min_v=1, max_v=100),
        # Rate limit: minimum interval between packets (hping3 -i u<microseconds>).
        # Hard floor of 10ms protects the agent from being used as an amplifier.
        "interval_ms": _int(opts, "interval_ms", default=200, min_v=10, max_v=5000),
        "timeout_sec": _int(opts, "timeout_sec", default=10, min_v=1, max_v=60),
    }


_DNS_RECORD_TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "PTR"]


def validate_dns(opts: dict[str, Any]) -> dict[str, Any]:
    return {
        "record_type": _str(
            opts, "record_type", default="A", choices=_DNS_RECORD_TYPES, max_len=8
        ),
        "resolver": _str(opts, "resolver", default="", max_len=128),  # empty = system
        "timeout_sec": _int(opts, "timeout_sec", default=5, min_v=1, max_v=30),
    }


_HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]


def validate_http_check(opts: dict[str, Any]) -> dict[str, Any]:
    method = _str(opts, "method", default="GET", choices=_HTTP_METHODS, max_len=8)
    follow = _bool(opts, "follow_redirects", default=False)
    headers = opts.get("headers", {})
    if not isinstance(headers, dict):
        raise TaskParamsError("headers must be a JSON object")
    norm_headers: dict[str, str] = {}
    for k, v in headers.items():
        if not isinstance(k, str) or not isinstance(v, str):
            raise TaskParamsError("header keys and values must be strings")
        if len(k) > 128 or len(v) > 512:
            raise TaskParamsError("header too long")
        norm_headers[k] = v
    return {
        "method": method,
        "follow_redirects": follow,
        "headers": norm_headers,
        "timeout_sec": _int(opts, "timeout_sec", default=10, min_v=1, max_v=60),
    }


def validate_tls_check(opts: dict[str, Any]) -> dict[str, Any]:
    return {
        "port": _port(opts, default=443),
        "sni": _str(opts, "sni", default="", max_len=255),  # empty → use target
        "timeout_sec": _int(opts, "timeout_sec", default=10, min_v=1, max_v=60),
    }


def validate_syn_scan(opts: dict[str, Any]) -> dict[str, Any]:
    raw_ports = opts.get("ports")
    if not isinstance(raw_ports, list) or not raw_ports:
        raise TaskParamsError("ports must be a non-empty list of integers")
    ports: list[int] = []
    for p in raw_ports:
        try:
            pi = int(p)
        except (TypeError, ValueError) as exc:
            raise TaskParamsError(f"port {p!r} is not an integer") from exc
        if pi < 1 or pi > 65535:
            raise TaskParamsError(f"port {pi} out of range")
        ports.append(pi)
    # Tighter cap than tcp_scan — SYN is noisier on the wire and harder for
    # IDS to ignore.
    if len(ports) > 256:
        raise TaskParamsError("syn_scan: too many ports (max 256)")
    return {
        "ports": sorted(set(ports)),
        "timeout_sec": _int(opts, "timeout_sec", default=5, min_v=1, max_v=15),
        "ipv6": _bool(opts, "ipv6", default=False),
    }


VALIDATORS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    TaskType.PING.value: validate_ping,
    TaskType.TRACEROUTE.value: validate_traceroute,
    TaskType.MTR.value: validate_mtr,
    TaskType.MTR_TCP.value: validate_mtr_tcp,
    TaskType.TCP_CONNECT.value: validate_tcp_connect,
    TaskType.TCP_SCAN.value: validate_tcp_scan,
    TaskType.SYN_SCAN.value: validate_syn_scan,
    TaskType.HPING3.value: validate_hping3,
    TaskType.DNS.value: validate_dns,
    TaskType.HTTP_CHECK.value: validate_http_check,
    TaskType.TLS_CHECK.value: validate_tls_check,
}


def validate_task_params(task_type: str, opts: dict[str, Any]) -> dict[str, Any]:
    fn = VALIDATORS.get(task_type)
    if fn is None:
        raise TaskParamsError(f"unsupported task type: {task_type}")
    return fn(opts or {})
