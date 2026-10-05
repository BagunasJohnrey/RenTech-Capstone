// Standard simple moving average: entries with an incomplete window (fewer
// than `period` samples) are null, so callers can render charts with proper
// gaps instead of misleading prefix-averages.
export function sma(data: number[], period: number = 3): (number | null)[] {
  if (!Number.isInteger(period) || period <= 0) return data.map(() => null);
  const result: (number | null)[] = [];
  let runningSum = 0;
  for (let i = 0; i < data.length; i++) {
    runningSum += data[i];
    if (i >= period) runningSum -= data[i - period];
    if (i < period - 1) {
      result.push(null);
    } else {
      result.push(Math.round((runningSum / period) * 100) / 100);
    }
  }
  return result;
}

export type SpikeFlag = { index: number; reason: string };

// Spike-capped SMA: one-off bulk bookings must not inflate the trend, but the
// underlying counts are never altered — bars keep showing true numbers and
// only the *average* uses capped values. Flags carry user-facing reasons
// ("bulk booking"), never statistical jargon.
//   - 8+ points: IQR upper fence (Q3 + 1.5·IQR), floored at 2× the median so a
//     legitimately busy season is never punished for being busy.
//   - Fewer than 8: mean ± 2σ upper bound (IQR is noise on tiny samples).
export function smaCapped(
  data: number[],
  period: number = 3
): { values: (number | null)[]; flags: SpikeFlag[] } {
  if (!Array.isArray(data) || data.length === 0) return { values: [], flags: [] };
  if (!Number.isInteger(period) || period <= 0) {
    return { values: data.map(() => null), flags: [] };
  }

  let cap = Infinity;
  if (data.length >= 8) {
    const sorted = [...data].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const q1 = q(0.25);
    const q3 = q(0.75);
    const median = q(0.5);
    cap = Math.max(q3 + 1.5 * (q3 - q1), 2 * median);
  } else {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((a, b) => a + (b - mean) * (b - mean), 0) / data.length;
    cap = mean + 2 * Math.sqrt(variance);
  }

  const flags: SpikeFlag[] = [];
  const capped = data.map((v, i) => {
    if (v > cap) {
      flags.push({ index: i, reason: 'bulk booking — capped at ' + Math.round(cap) });
      return cap;
    }
    return v;
  });

  const values = sma(capped, period).map((v) => (v === null ? null : Math.round(v * 100) / 100));
  return { values, flags };
}

// Mean Absolute Percentage Error over one-step-ahead residuals, skipping
// zero-actual periods (no division by zero). Returns a percentage (0–100+),
// or null when nothing is comparable.
export function mape(actual: number[], predicted: (number | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const p = predicted[i];
    if (!a || p === null || p === undefined) continue;
    sum += Math.abs((a - p) / a);
    n++;
  }
  if (n === 0) return null;
  return Math.round((sum / n) * 100);
}
