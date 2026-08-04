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
