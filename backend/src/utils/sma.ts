export function sma(data: number[], period: number = 3): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const windowSize = Math.min(i + 1, period);
    const start = i - windowSize + 1;
    const sum = data.slice(start, i + 1).reduce((a, b) => a + b, 0);
    result.push(Math.round((sum / windowSize) * 100) / 100);
  }
  return result;
}
