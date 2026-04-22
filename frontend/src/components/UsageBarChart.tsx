interface UsageBarChartDatum {
  day_start: string;
  counted: number;
}

interface Props {
  data: UsageBarChartDatum[];
  height?: number;
}

export function UsageBarChart({ data, height = 120 }: Props) {
  const max = Math.max(1, ...data.map((d) => d.counted));
  const barW = data.length > 0 ? 100 / data.length : 100;
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      role="img"
      aria-label="7-day usage"
      className="w-full"
    >
      {data.map((d, i) => {
        const h = (d.counted / max) * (height - 20);
        return (
          <g key={d.day_start}>
            <rect
              x={i * barW + 1}
              y={height - Math.max(h, 2) - 10}
              width={barW - 2}
              height={Math.max(h, 2)}
              className="fill-indigo-500"
            />
            <text
              x={i * barW + barW / 2}
              y={height - 2}
              textAnchor="middle"
              fontSize="6"
            >
              {new Date(d.day_start).toLocaleDateString(undefined, {
                weekday: "short",
              })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
