/**
 * Best-effort client-side target validation. The server (and agent) are the
 * source of truth — this is purely a UX hint to catch typos before submission.
 * The same rules are mirrored from server/app/validators/targets.py:
 *   - reject private/loopback/link-local/multicast/metadata IPs
 *   - reject malformed octets
 *   - hostnames must look like RFC1123 labels
 */

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const IPV4_PRIVATE_PREFIXES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^224\./, // 224.0.0.0/4 multicast
  /^0\./, // 0.0.0.0/8
  /^255\.255\.255\.255$/,
];

const METADATA_IPS = new Set([
  "169.254.169.254",
  "fd00:ec2::254",
]);

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

function isIPv4(s: string): boolean {
  if (!IPV4_RE.test(s)) return false;
  return s.split(".").every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === p.replace(/^0+(?=\d)/, "");
  });
}

function isIPv6Like(s: string): boolean {
  // Cheap shape check — accept anything that looks like hex+colons with 2+ colons.
  return IPV6_RE.test(s) && (s.match(/:/g)?.length ?? 0) >= 2;
}

export function validateHostOrIP(raw: string): ValidationResult {
  const target = raw.trim();
  if (!target) return { ok: false, reason: "Target is empty" };
  if (target.length > 255) return { ok: false, reason: "Target too long" };

  if (isIPv4(target)) {
    if (METADATA_IPS.has(target)) {
      return { ok: false, reason: "Cloud metadata IPs are not allowed" };
    }
    for (const re of IPV4_PRIVATE_PREFIXES) {
      if (re.test(target)) {
        return { ok: false, reason: "Private / reserved IP is not allowed" };
      }
    }
    return { ok: true };
  }
  if (isIPv6Like(target)) {
    const lower = target.toLowerCase();
    if (lower === "::1" || lower === "::") return { ok: false, reason: "Reserved IPv6 not allowed" };
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
      return { ok: false, reason: "Private / link-local IPv6 not allowed" };
    }
    if (lower.startsWith("ff")) return { ok: false, reason: "Multicast IPv6 not allowed" };
    if (METADATA_IPS.has(lower)) return { ok: false, reason: "Cloud metadata IP not allowed" };
    return { ok: true };
  }
  if (HOSTNAME_RE.test(target)) return { ok: true };
  return { ok: false, reason: "Not a valid hostname or public IP" };
}

export function validateURL(raw: string): ValidationResult {
  const s = raw.trim();
  if (!s) return { ok: false, reason: "URL is empty" };
  let u: URL;
  try {
    u = new URL(s.includes("://") ? s : `https://${s}`);
  } catch {
    return { ok: false, reason: "Malformed URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Only http/https URLs are supported" };
  }
  return validateHostOrIP(u.hostname);
}

export function validateDomain(raw: string): ValidationResult {
  const s = raw.trim();
  if (!s) return { ok: false, reason: "Domain is empty" };
  if (s.length > 253) return { ok: false, reason: "Domain too long" };
  // Allow trailing dot and underscores (for things like _dmarc.example.com).
  const cleaned = s.replace(/\.$/, "");
  if (
    !/^([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z]{2,}$/i.test(cleaned) &&
    !isIPv4(cleaned)
  ) {
    return { ok: false, reason: "Not a valid domain" };
  }
  return { ok: true };
}

/** Per-task-type validator. Returns ok on empty input (errors at submit). */
export function validateTargetFor(taskType: string, raw: string): ValidationResult {
  if (!raw.trim()) return { ok: true };
  switch (taskType) {
    case "dns":
      return validateDomain(raw);
    case "http_check":
      return validateURL(raw);
    case "tls_check":
      // SNI = hostname (no scheme).
      return validateHostOrIP(raw.replace(/^https?:\/\//, "").split("/")[0]);
    default:
      return validateHostOrIP(raw);
  }
}
