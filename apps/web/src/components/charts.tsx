// Server-rendered SVG charts following the data-viz rules: thin columns (<= 24px) with 4px rounded
// data-ends, 2px surface gaps, hairline solid grid, text in ink tokens (never the series color),
// a legend for >= 2 series, a hover/focus readout per month, and a table view for every chart.
// Time runs right to left, matching the RTL page.
import { compactMoney, money } from "@/lib/format";

export interface Series {
  name: string;
  color: string;
  values: bigint[];
  /** draw these points as outlines (e.g. a forecast or an incomplete month) */
  hollowFrom?: number;
}

const W = 680;
const PAD = { top: 12, bottom: 30, start: 8, end: 56 }; // `end` holds the y-axis labels (right side in RTL)

function niceStep(range: number): number {
  const raw = range / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
}

/** A path for a bar with 4px rounded corners on its data end only (square at the baseline). */
function barPath(x: number, w: number, y0: number, y1: number): string {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, h);
  if (h === 0) return "";
  if (up) {
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

export function ColumnChart({
  title,
  labels,
  fullLabels,
  series,
  height = 200,
  colorBySign,
}: {
  title: string;
  labels: string[];
  /** used in tooltips and the table (defaults to labels) */
  fullLabels?: string[];
  series: Series[];
  height?: number;
  /** single-series polarity: [positive, negative] colors (e.g. net cash flow) */
  colorBySign?: [string, string];
}) {
  const n = labels.length;
  const all = series.flatMap((s) => s.values.map(Number));
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const step = niceStep(max - min);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const plotH = height - PAD.top - PAD.bottom;
  const plotW = W - PAD.start - PAD.end;
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom)) * plotH;
  const groupW = plotW / n;
  const k = series.length;
  const barW = Math.max(2, Math.min(24, (groupW - 6) / k - 2));
  const groupContent = k * barW + (k - 1) * 2;
  // index 0 (oldest) sits at the right edge, next to the y-axis labels
  const groupX = (i: number) => PAD.start + plotW - (i + 1) * groupW;
  const ticks: number[] = [];
  for (let t = bottom; t <= top + 1e-9; t += step) ticks.push(t);
  const names = fullLabels ?? labels;
  const tip = (i: number) => [names[i], ...series.map((s) => `${s.name}: ${money(s.values[i]!, { whole: true })}`)].join("\n");

  return (
    <figure className="chart" style={{ margin: 0 }}>
      {k > 1 && (
        <figcaption className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
              {s.name}
            </span>
          ))}
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} style={{ inlineSize: "100%", blockSize: "auto", display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.start} x2={PAD.start + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-axis" : "chart-grid"} strokeWidth={1} />
            <text x={W - 4} y={y(t) + 4} textAnchor="end" fontSize={11} className="chart-label" style={{ fontVariantNumeric: "tabular-nums", direction: "ltr" }}>
              {compactMoney(t)}
            </text>
          </g>
        ))}
        {labels.map((label, i) => {
          const gx = groupX(i);
          const start = gx + (groupW - groupContent) / 2;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = Number(s.values[i]!);
                const color = colorBySign ? (v >= 0 ? colorBySign[0] : colorBySign[1]) : s.color;
                const hollow = s.hollowFrom !== undefined && i >= s.hollowFrom;
                // within a group, series also run right to left
                const x = start + groupContent - (si + 1) * barW - si * 2;
                return (
                  <path
                    key={s.name}
                    d={barPath(x, barW, y(0), y(v))}
                    style={{ fill: hollow ? "none" : color, stroke: hollow ? color : "none" }}
                    strokeWidth={hollow ? 1.5 : 0}
                    aria-hidden="true"
                  />
                );
              })}
              <text x={gx + groupW / 2} y={height - 10} textAnchor="middle" fontSize={11} className="chart-label">
                {label}
              </text>
              {/* the whole column is the hit target; it reads out every series */}
              <rect x={gx} y={PAD.top} width={groupW} height={plotH} fill="transparent" tabIndex={0} data-tip={tip(i)} aria-label={tip(i).replace(/\n/g, ", ")} className="hit" />
            </g>
          );
        })}
      </svg>
      <details className="table-view">
        <summary>הצגה כטבלה</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{title}</th>
                {series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {names.map((l, i) => (
                <tr key={i}>
                  <th scope="row" style={{ fontWeight: 400, color: "inherit" }}>{l}</th>
                  {series.map((s) => <td key={s.name} className="num">{money(s.values[i]!, { whole: true })}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export interface BarRow {
  key: string;
  label: string;
  href?: string;
  value: bigint;
  /** a reference mark on the bar (e.g. the 3-month average) */
  reference?: bigint | null;
  note?: string;
  muted?: boolean;
}

/** Horizontal bars (one series) with an optional reference tick per row. */
export function BarList({ rows, color, referenceName, valueName }: { rows: BarRow[]; color: string; referenceName?: string; valueName: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => [Number(r.value), Number(r.reference ?? 0n)]));
  const pct = (v: bigint) => `${Math.max(0, (Number(v) / max) * 100)}%`;
  const hasRef = rows.some((r) => r.reference != null);
  return (
    <div className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
      {hasRef && referenceName && (
        <div className="legend">
          <span><span className="swatch" style={{ background: color }} aria-hidden="true" />{valueName}</span>
          <span><span className="tick-key" aria-hidden="true" />{referenceName}</span>
        </div>
      )}
      <ul className="barlist">
        {rows.map((r) => {
          const tip = [r.label, `${valueName}: ${money(r.value, { whole: true })}`, ...(r.reference != null && referenceName ? [`${referenceName}: ${money(r.reference, { whole: true })}`] : []), ...(r.note ? [r.note] : [])].join("\n");
          const label = r.href ? <a href={r.href}>{r.label}</a> : r.label;
          return (
            <li key={r.key} data-tip={tip} tabIndex={0} aria-label={tip.replace(/\n/g, ", ")}>
              <div className="row spread small" style={{ "--gap": "8px" } as React.CSSProperties}>
                <span>{label}</span>
                <span className="num">{money(r.value, { whole: true })}{r.note ? <span className="muted"> · {r.note}</span> : null}</span>
              </div>
              <div className="bar-track" aria-hidden="true">
                <span className="bar-fill" style={{ inlineSize: pct(r.value), background: r.muted ? "var(--series-muted)" : color }} />
                {r.reference != null && <span className="bar-ref" style={{ insetInlineStart: pct(r.reference) }} />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// CSS variables (see globals.css), so every chart follows the light/dark theme
export const SERIES = { income: "var(--series-income)", expenses: "var(--series-expenses)", negative: "var(--series-negative)" };
