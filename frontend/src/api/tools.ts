import { api } from "./client";

export type LookupResult = {
  target: string;
  resolved_ip: string | null;
  is_ipv4: boolean;
  rdns: string | null;
  asn: string | null;
  asname: string | null;
  org: string | null;
  isp: string | null;
  country: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  error: string | null;
};

export function lookupTarget(target: string) {
  return api<LookupResult>(
    "GET",
    `/api/tools/lookup?target=${encodeURIComponent(target)}`,
  );
}

export type ASPathResult = {
  target: string;
  resolved_ip: string | null;
  origin_asn: number | null;
  prefix: string | null;
  paths: number[][];
  consensus_path: number[];
  error: string | null;
};

export function getASPath(target: string) {
  return api<ASPathResult>(
    "GET",
    `/api/tools/aspath?target=${encodeURIComponent(target)}`,
  );
}
