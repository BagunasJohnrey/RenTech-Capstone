/**
 * Converts Gemini's report text into an array of sections for rendering.
 * Handles both markdown headings (# / ##) and the plain-text section headers
 * the report prompt now emits ("Executive Summary", etc.). All residual
 * markdown (**, *, #, backticks, bullet dashes) is stripped so the report
 * reads like a clean, formatted document rather than raw markdown.
 */
const SECTION_TITLES = [
  'Executive Summary',
  'Key Performance Indicators',
  'Revenue Analysis',
  'Inventory & Utilization',
  'Operational Health',
  'Demand Forecast',
  'Recommendations',
];

export function parseReportSections(rawText) {
  const lines = (rawText || '').split('\n');
  const sections = [];
  let current = { title: '', bodyLines: [] };

  const stripMarkdown = (s) =>
    s
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/^\s*[-*]\s+/, '')
      .trim();

  const isHeading = (line) => {
    const t = line.trim();
    if (/^#{1,6}\s+/.test(t)) return true;
    return SECTION_TITLES.some((title) =>
      t.toLowerCase().startsWith(title.toLowerCase())
    );
  };

  for (const line of lines) {
    if (isHeading(line) && (current.title || current.bodyLines.some((l) => l.trim()))) {
      sections.push({ ...current });
      current = { title: '', bodyLines: [] };
    }
    if (isHeading(line)) {
      current.title = stripMarkdown(line);
    } else if (line.trim()) {
      current.bodyLines.push(stripMarkdown(line));
    }
  }

  if (current.title || current.bodyLines.length) {
    sections.push(current);
  }
  return sections;
}
