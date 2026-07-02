// Approximate VO2 max reference ranges (ml/kg/min) by age bracket and sex, adapted from
// commonly published ACSM / Cooper Institute normative tables. These are illustrative
// reference bands, not a clinical assessment.
const MEN = [
  { maxAge: 25, below: 42, average: 46, good: 52 },
  { maxAge: 35, below: 40, average: 44, good: 50 },
  { maxAge: 45, below: 38, average: 42, good: 47 },
  { maxAge: 55, below: 35, average: 39, good: 44 },
  { maxAge: 65, below: 31, average: 35, good: 40 },
  { maxAge: Infinity, below: 28, average: 32, good: 37 },
];

const WOMEN = [
  { maxAge: 25, below: 33, average: 37, good: 41 },
  { maxAge: 35, below: 31, average: 35, good: 39 },
  { maxAge: 45, below: 29, average: 33, good: 37 },
  { maxAge: 55, below: 26, average: 30, good: 34 },
  { maxAge: 65, below: 23, average: 27, good: 32 },
  { maxAge: Infinity, below: 20, average: 24, good: 29 },
];

function bracketFor(age, sex) {
  const table = (sex || "").toLowerCase().startsWith("f") ? WOMEN : MEN;
  return table.find((b) => age <= b.maxAge) || table[table.length - 1];
}

/** Returns display bands for charting: below average / average / good / excellent. */
export function getVO2MaxBands(age, sex, ceiling) {
  if (!age) return [];
  const b = bracketFor(age, sex);
  const top = Math.max(ceiling || 0, b.good + 10);
  return [
    { label: "Below average", low: 0, high: b.below, color: "#f87171" },
    { label: "Average", low: b.below, high: b.average, color: "#fbbf24" },
    { label: "Good", low: b.average, high: b.good, color: "#34d399" },
    { label: "Excellent", low: b.good, high: top, color: "#22d3ee" },
  ];
}

export function classifyVO2Max(vo2max, age, sex) {
  if (!vo2max || !age) return null;
  const b = bracketFor(age, sex);
  if (vo2max < b.below) return "Below average";
  if (vo2max < b.average) return "Average";
  if (vo2max < b.good) return "Good";
  return "Excellent";
}
