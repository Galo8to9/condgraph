export interface Stats {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdev: number; // sample stdev (n-1); 0 when n < 2
}

export function summarize(values: number[]): Stats {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, median: 0, min: 0, max: 0, stdev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const stdev =
    n < 2
      ? 0
      : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  return { n, mean, median, min: sorted[0], max: sorted[n - 1], stdev };
}
