// Dependency-free inline SVG chart helpers.
//
// HT-1 fix: previously every chart rendered at a fixed 320-logical-width viewBox with
// width="100%", so SVG's default preserveAspectRatio ("xMidYMid meet") scaled to the card's
// height and centered the chart as a small floating box on any card wider than ~320px. Charts
// now render at WIDTH=700 logical units so they fill full-width cards on both mobile and
// desktop without stretching text.
//
// HT-2: series items may carry an optional `date` (e.g. {date: "2026-07-11", value: 52}).
// When present, line charts draw first/last x-axis date labels, y-axis min/mid/max gridlines,
// and a labeled dot at the most recent value. Charts still work with value-only series
// (dates simply omitted) for any caller that hasn't been updated yet.
const WIDTH = 700;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 20;

function shortDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtValue(v) {
  if (v == null || Number.isNaN(v)) return "";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Not enough points to draw a meaningful line — used by callers per HT-5 sparse-data handling. */
export function hasEnoughPoints(series, min = 3) {
  return series.filter((p) => typeof p.value === "number").length >= min;
}

export function lineChart(series, { height = 140, color = "#22d3ee", min, max } = {}) {
  const values = series.map((p) => p.value).filter((v) => typeof v === "number");
  if (!values.length) return `<svg viewBox="0 0 ${WIDTH} ${height}"></svg>`;
  const yMin = min ?? Math.min(...values);
  const yMax = max ?? Math.max(...values);
  const range = yMax - yMin || Math.max(Math.abs(yMax), 1) * 0.1 || 1;
  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const n = series.length;
  const x = (i) => PAD_LEFT + (i / Math.max(n - 1, 1)) * plotW;
  const y = (v) => PAD_TOP + plotH - ((v - yMin) / range) * plotH;

  const gridlines = [yMin, (yMin + yMax) / 2, yMax]
    .map(
      (v) => `<line x1="${PAD_LEFT}" y1="${y(v)}" x2="${WIDTH - PAD_RIGHT}" y2="${y(v)}" stroke="#2c3a52" stroke-width="1" />
        <text x="${PAD_LEFT - 6}" y="${y(v) + 3}" font-size="11" fill="#97a6bd" text-anchor="end">${fmtValue(v)}</text>`
    )
    .join("");

  const pts = series.map((p, i) => (typeof p.value === "number" ? { i, v: p.value } : null)).filter(Boolean);
  const points = pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");

  const first = series.find((p) => p.date);
  const last = [...series].reverse().find((p) => p.date);
  const xLabels =
    first && last && first !== last
      ? `<text x="${PAD_LEFT}" y="${height - 4}" font-size="10" fill="#97a6bd" text-anchor="start">${esc(shortDate(first.date))}</text>
         <text x="${WIDTH - PAD_RIGHT}" y="${height - 4}" font-size="10" fill="#97a6bd" text-anchor="end">${esc(shortDate(last.date))}</text>`
      : "";

  const lastPt = pts[pts.length - 1];
  const marker = lastPt
    ? `<circle cx="${x(lastPt.i)}" cy="${y(lastPt.v)}" r="4" fill="${color}" />
       <text x="${Math.min(x(lastPt.i) + 6, WIDTH - PAD_RIGHT - 26)}" y="${y(lastPt.v) - 8}" font-size="12" font-weight="700" fill="${color}">${fmtValue(lastPt.v)}</text>`
    : "";

  return `<svg viewBox="0 0 ${WIDTH} ${height}" width="100%" height="${height}">
    ${gridlines}
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
    ${marker}
    ${xLabels}
  </svg>`;
}

/** Line chart with horizontal reference bands (e.g. VO2 max percentile ranges). */
export function lineChartWithBands(series, bands, { height = 180, color = "#22d3ee" } = {}) {
  const values = series.map((p) => p.value).filter((v) => typeof v === "number");
  const bandValues = bands.flatMap((b) => [b.low, b.high]).filter((v) => typeof v === "number");
  const all = [...values, ...bandValues];
  if (!all.length) return `<svg viewBox="0 0 ${WIDTH} ${height}"></svg>`;
  const yMin = Math.min(...all);
  const yMax = Math.max(...all);
  const range = yMax - yMin || 1;
  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const n = series.length;
  const x = (i) => PAD_LEFT + (i / Math.max(n - 1, 1)) * plotW;
  const y = (v) => PAD_TOP + plotH - ((v - yMin) / range) * plotH;

  const bandRects = bands
    .map(
      (b) => `<rect x="${PAD_LEFT}" y="${y(b.high)}" width="${plotW}" height="${Math.max(y(b.low) - y(b.high), 1)}" fill="${b.color}" opacity="0.15" />
      <text x="${WIDTH - PAD_RIGHT}" y="${y(b.high) + 10}" font-size="10" fill="${b.color}" text-anchor="end">${esc(b.label)}</text>`
    )
    .join("");

  const pts = series.map((p, i) => (typeof p.value === "number" ? { i, v: p.value } : null)).filter(Boolean);
  const points = pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");

  const first = series.find((p) => p.date);
  const last = [...series].reverse().find((p) => p.date);
  const xLabels =
    first && last && first !== last
      ? `<text x="${PAD_LEFT}" y="${height - 4}" font-size="10" fill="#97a6bd" text-anchor="start">${esc(shortDate(first.date))}</text>
         <text x="${WIDTH - PAD_RIGHT}" y="${height - 4}" font-size="10" fill="#97a6bd" text-anchor="end">${esc(shortDate(last.date))}</text>`
      : "";

  const lastPt = pts[pts.length - 1];
  const marker = lastPt
    ? `<circle cx="${x(lastPt.i)}" cy="${y(lastPt.v)}" r="4" fill="${color}" stroke="#0f172a" stroke-width="1.5" />`
    : "";

  return `<svg viewBox="0 0 ${WIDTH} ${height}" width="100%" height="${height}">
    ${bandRects}
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
    ${marker}
    ${xLabels}
  </svg>`;
}

export function barChart(series, { height = 100, color = "#22d3ee", target } = {}) {
  const values = series.map((p) => p.value || 0);
  const max = Math.max(...values, target || 0, 1);
  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const n = series.length;
  const barWidth = plotW / n - 4;
  const x = (i) => PAD_LEFT + i * (plotW / n);
  const y = (v) => PAD_TOP + plotH - (v / max) * plotH;

  const yLabel = `<text x="${PAD_LEFT - 6}" y="${PAD_TOP + 4}" font-size="11" fill="#97a6bd" text-anchor="end">${fmtValue(max)}</text>
    <line x1="${PAD_LEFT}" y1="${PAD_TOP}" x2="${WIDTH - PAD_RIGHT}" y2="${PAD_TOP}" stroke="#2c3a52" stroke-width="1" />`;

  const bars = series
    .map((p, i) => `<rect x="${x(i)}" y="${y(p.value || 0)}" width="${Math.max(barWidth, 2)}" height="${Math.max(PAD_TOP + plotH - y(p.value || 0), 0)}" fill="${color}" rx="2" />`)
    .join("");

  const targetLine = target
    ? `<line x1="${PAD_LEFT}" y1="${y(target)}" x2="${WIDTH - PAD_RIGHT}" y2="${y(target)}" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="4,3" />
       <text x="${WIDTH - PAD_RIGHT}" y="${y(target) - 4}" font-size="10" fill="#fbbf24" text-anchor="end">${fmtValue(target)} target</text>`
    : "";

  const first = series.find((p) => p.date);
  const last = [...series].reverse().find((p) => p.date);
  const xLabels =
    first && last && first !== last
      ? `<text x="${PAD_LEFT}" y="${height - 4}" font-size="10" fill="#97a6bd" text-anchor="start">${esc(shortDate(first.date))}</text>
         <text x="${WIDTH - PAD_RIGHT}" y="${height - 4}" font-size="10" fill="#97a6bd" text-anchor="end">${esc(shortDate(last.date))}</text>`
      : "";

  return `<svg viewBox="0 0 ${WIDTH} ${height}" width="100%" height="${height}">${yLabel}${bars}${targetLine}${xLabels}</svg>`;
}
