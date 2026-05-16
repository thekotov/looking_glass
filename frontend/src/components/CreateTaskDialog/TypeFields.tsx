import { useT } from "../../i18n";
import {
  CheckField,
  NumField,
  PortListField,
  SelectField,
  TextField,
} from "./fields";

export type TaskType =
  | "ping"
  | "traceroute"
  | "mtr"
  | "mtr_tcp"
  | "tcp_connect"
  | "tcp_scan"
  | "syn_scan"
  | "hping3"
  | "dns"
  | "http_check"
  | "tls_check";

type Props = {
  type: TaskType;
  opts: Record<string, unknown>;
  setOpts: (o: Record<string, unknown>) => void;
};

/**
 * Per-task-type option fields. The shape of `opts` is whatever the agent's
 * task-runner expects — we trust the server's task_params validator to reject
 * anything malformed.
 */
export default function TypeFields({ type, opts, setOpts }: Props) {
  const { t } = useT();
  const set = (k: string, v: unknown) => setOpts({ ...opts, [k]: v });
  const num = (k: string, def: number) => Number((opts[k] as number) ?? def);
  const str = (k: string, def: string) => String((opts[k] as string) ?? def);
  const bool = (k: string, def: boolean) => (opts[k] as boolean | undefined) ?? def;

  switch (type) {
    case "ping":
      return (
        <>
          <NumField label="count" k="count" def={5} min={1} max={100} tip={t("create.tooltipCount")} {...{ set, num }} />
          <NumField label="timeout (sec)" k="timeout_sec" def={5} min={1} max={30} tip={t("create.tooltipTimeout")} {...{ set, num }} />
          <NumField label="interval (ms)" k="interval_ms" def={1000} min={250} max={5000} tip={t("create.tooltipInterval")} {...{ set, num }} />
          <CheckField label="IPv6" k="ipv6" def={false} {...{ set, bool }} />
        </>
      );
    case "traceroute":
      return (
        <>
          <NumField label="max hops" k="max_hops" def={30} min={1} max={64} tip={t("create.tooltipMaxHops")} {...{ set, num }} />
          <NumField label="timeout (sec)" k="timeout_sec" def={3} min={1} max={10} tip={t("create.tooltipTimeout")} {...{ set, num }} />
          <NumField label="queries per hop" k="queries_per_hop" def={1} min={1} max={3} {...{ set, num }} />
          <CheckField label="IPv6" k="ipv6" def={false} {...{ set, bool }} />
        </>
      );
    case "mtr":
      return (
        <>
          <NumField label="cycles" k="cycles" def={10} min={1} max={100} tip={t("create.tooltipCycles")} {...{ set, num }} />
          <NumField label="max hops" k="max_hops" def={30} min={1} max={64} tip={t("create.tooltipMaxHops")} {...{ set, num }} />
          <CheckField label="IPv6" k="ipv6" def={false} {...{ set, bool }} />
        </>
      );
    case "mtr_tcp":
      return (
        <>
          <NumField label="cycles" k="cycles" def={10} min={1} max={100} tip={t("create.tooltipCycles")} {...{ set, num }} />
          <NumField label="max hops" k="max_hops" def={30} min={1} max={64} tip={t("create.tooltipMaxHops")} {...{ set, num }} />
          <NumField label="port" k="port" def={443} min={1} max={65535} tip={t("create.tooltipPort")} {...{ set, num }} />
          <CheckField label="IPv6" k="ipv6" def={false} {...{ set, bool }} />
        </>
      );
    case "tcp_connect": {
      const bannerOn = bool("banner_grab", false);
      return (
        <>
          <NumField label="port" k="port" def={443} min={1} max={65535} tip={t("create.tooltipPort")} {...{ set, num }} />
          <NumField label="timeout (sec)" k="timeout_sec" def={5} min={1} max={30} tip={t("create.tooltipTimeout")} {...{ set, num }} />
          <CheckField label="IPv6" k="ipv6" def={false} {...{ set, bool }} />
          <CheckField label="banner grab" k="banner_grab" def={false} {...{ set, bool }} />
          {bannerOn && (
            <>
              <NumField label="banner bytes" k="banner_bytes" def={256} min={1} max={4096} {...{ set, num }} />
              <NumField label="banner timeout (ms)" k="banner_timeout_ms" def={2000} min={100} max={10000} {...{ set, num }} />
            </>
          )}
        </>
      );
    }
    case "tcp_scan":
      return (
        <>
          <PortListField k="ports" def={[80, 443, 22, 8080, 8443]} {...{ set, opts }} />
          <NumField label="timeout (sec)" k="timeout_sec" def={3} min={1} max={30} tip={t("create.tooltipTimeout")} {...{ set, num }} />
          <NumField label="concurrency" k="concurrency" def={32} min={1} max={256} {...{ set, num }} />
          <CheckField label="IPv6" k="ipv6" def={false} {...{ set, bool }} />
        </>
      );
    case "syn_scan":
      return (
        <>
          <PortListField k="ports" def={[22, 80, 443]} {...{ set, opts }} />
          <NumField label="timeout (sec)" k="timeout_sec" def={5} min={1} max={15} tip={t("create.tooltipTimeout")} {...{ set, num }} />
          <p className="text-[10px] text-slate-500">
            SYN scan needs CAP_NET_RAW on a Linux agent. Max 256 ports.
          </p>
        </>
      );
    case "hping3":
      return (
        <>
          <SelectField
            label="mode"
            k="mode"
            def="tcp_syn"
            choices={["tcp_syn", "tcp_ack", "tcp_fin", "udp", "icmp"]}
            {...{ set, str }}
          />
          <NumField label="port" k="port" def={80} min={1} max={65535} tip={t("create.tooltipPort")} {...{ set, num }} />
          <NumField label="count (max 100)" k="count" def={5} min={1} max={100} tip={t("create.tooltipCount")} {...{ set, num }} />
          <NumField label="interval (ms, ≥10)" k="interval_ms" def={200} min={10} max={5000} tip={t("create.tooltipInterval")} {...{ set, num }} />
        </>
      );
    case "dns":
      return (
        <>
          <SelectField
            label="record type"
            k="record_type"
            def="A"
            choices={["A", "AAAA", "MX", "TXT", "NS", "CNAME", "PTR"]}
            {...{ set, str }}
          />
          <TextField label="custom resolver (empty = system)" k="resolver" def="" {...{ set, str }} />
          <NumField label="timeout (sec)" k="timeout_sec" def={5} min={1} max={30} tip={t("create.tooltipTimeout")} {...{ set, num }} />
        </>
      );
    case "http_check":
      return (
        <>
          <SelectField
            label="method"
            k="method"
            def="GET"
            choices={["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]}
            {...{ set, str }}
          />
          <CheckField label="follow redirects" k="follow_redirects" def={false} {...{ set, bool }} />
          <NumField label="timeout (sec)" k="timeout_sec" def={10} min={1} max={60} tip={t("create.tooltipTimeout")} {...{ set, num }} />
        </>
      );
    case "tls_check":
      return (
        <>
          <NumField label="port" k="port" def={443} min={1} max={65535} tip={t("create.tooltipPort")} {...{ set, num }} />
          <TextField label="SNI (empty = target)" k="sni" def="" {...{ set, str }} />
          <NumField label="timeout (sec)" k="timeout_sec" def={10} min={1} max={60} tip={t("create.tooltipTimeout")} {...{ set, num }} />
        </>
      );
  }
}
