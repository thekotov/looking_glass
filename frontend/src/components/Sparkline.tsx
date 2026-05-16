import { useMemo } from "react";

type LineProps = {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
};

/** SVG line sparkline. Values are auto-scaled to the y range. */
export function SparklineLine({
  values,
  width = 96,
  height = 24,
  stroke = "#34d399",
  fill = "rgba(52,211,153,0.15)",
  ariaLabel,
}: LineProps) {
  const { d, area } = useMemo(() => {
    if (values.length === 0) return { d: "", area: "" };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = values.length > 1 ? width / (values.length - 1) : 0;
    const pts = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return [x, y] as const;
    });
    const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${d} L${width},${height} L0,${height} Z`;
    return { d, area };
  }, [values, width, height]);

  if (values.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#334155" strokeDasharray="2 2" />
      </svg>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      className="overflow-visible"
    >
      <path d={area} fill={fill} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

type BarsProps = {
  values: number[];
  /** Optional colour-per-bar; falls back to `barColor` for all. */
  colorFor?: (i: number, v: number) => string;
  barColor?: string;
  width?: number;
  height?: number;
  ariaLabel?: string;
};

/** SVG bar sparkline. Each value gets one bar — good for hourly counts. */
export function SparklineBars({
  values,
  colorFor,
  barColor = "#475569",
  width = 96,
  height = 24,
  ariaLabel,
}: BarsProps) {
  const max = Math.max(1, ...values);
  const gap = 1;
  const barW = values.length > 0 ? Math.max(1, (width - gap * (values.length - 1)) / values.length) : 0;
  return (
    <svg width={width} height={height} role="img" aria-label={ariaLabel}>
      {values.map((v, i) => {
        const h = (v / max) * (height - 1);
        const x = i * (barW + gap);
        const y = height - h;
        return (
          <rect
            key={i}
            x={x.toFixed(2)}
            y={y.toFixed(2)}
            width={barW.toFixed(2)}
            height={Math.max(1, h).toFixed(2)}
            fill={colorFor ? colorFor(i, v) : barColor}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}
