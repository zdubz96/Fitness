// Dependency-free inline SVG line chart helpers.
export function lineChart(series, { width = 320, height = 140, color = "#22d3ee", min, max, padding = 8 } = {}) {
  const values = series.map((p) => p.value).filter((v) => typeof v === "number");
  if (!values.length) return `<svg viewBox="0 0 ${width} ${height}"></svg>`;
  const yMin = min ?? Math.min(...values);
  const yMax = max ?? Math.max(...values);
  const range = yMax - yMin || 1;
  const n = series.length;
  const x = (i) => padding + (i / Math.max(n - 1, 1)) * (width - padding * 2);
  const y = (v) => height - padding - ((v - yMin) / range) * (height - padding * 2);

  const points = series
    .map((p, i) => (typeof p.value === "number" ? `${x(i)},${y(p.value)}` : null))
    .filter(Boolean)
    .join(" ");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

/** Line chart with horizontal reference bands (e.g. VO2 max percentile ranges). */
export function lineChartWithBands(series, bands, { width = 320, height = 180, color = "#22d3ee", padding = 8 } = {}) {
  const values = series.map((p) => p.value).filter((v) => typeof v === "number");
  const bandValues = bands.flatMap((b) => [b.low, b.high]).filter((v) => typeof v === "number");
  const all = [...values, ...bandValues];
  if (!all.length) return `<svg viewBox="0 0 ${width} ${height}"></svg>`;
  const yMin = Math.min(...all);
  const yMax = Math.max(...all);
  const range = yMax - yMin || 1;
  const n = series.length;
  const x = (i) => padding + (i / Math.max(n - 1, 1)) * (width - padding * 2);
  const y = (v) => height - padding - ((v - yMin) / range) * (height - padding * 2);

  const bandRects = bands
    .map(
      (b) => `<rect x="${padding}" y="${y(b.high)}" width="${width - padding * 2}" height="${Math.max(y(b.low) - y(b.high), 1)}" fill="${b.color}" opacity="0.15" />
      <text x="${width - padding}" y="${y(b.high) + 10}" font-size="9" fill="${b.color}" text-anchor="end">${b.label}</text>`
    )
    .join("");

  const points = series
    .map((p, i) => (typeof p.value === "number" ? `${x(i)},${y(p.value)}` : null))
    .filter(Boolean)
    .join(" ");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    ${bandRects}
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

export function barChart(series, { width = 320, height = 100, color = "#22d3ee", padding = 6, target } = {}) {
  const values = series.map((p) => p.value || 0);
  const max = Math.max(...values, target || 0, 1);
  const n = series.length;
  const barWidth = (width - padding * 2) / n - 4;
  const x = (i) => padding + i * ((width - padding * 2) / n);
  const y = (v) => height - padding - (v / max) * (height - padding * 2);
  const bars = series
    .map((p, i) => `<rect x="${x(i)}" y="${y(p.value || 0)}" width="${Math.max(barWidth, 2)}" height="${height - padding - y(p.value || 0)}" fill="${color}" rx="2" />`)
    .join("");
  const targetLine = target
    ? `<line x1="${padding}" y1="${y(target)}" x2="${width - padding}" y2="${y(target)}" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="4,3" />`
    : "";
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">${bars}${targetLine}</svg>`;
}
