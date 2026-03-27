import type { ScrapeResult, ExportFormat } from './types';

// 내보내기 전략 인터페이스
interface ExportStrategy {
  export(data: ScrapeResult): string;
  mimeType: string;
  extension: string;
}

// JSON 내보내기
const jsonStrategy: ExportStrategy = {
  mimeType: 'application/json',
  extension: 'json',
  export(data: ScrapeResult): string {
    return JSON.stringify(data.rows, null, 2);
  },
};

// CSV 내보내기
const csvStrategy: ExportStrategy = {
  mimeType: 'text/csv',
  extension: 'csv',
  export(data: ScrapeResult): string {
    const escapeCsv = (val: unknown): string => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = data.columns.map(escapeCsv).join(',');
    const rows = data.rows.map((row) =>
      data.columns.map((col) => escapeCsv(row[col])).join(',')
    );
    return [header, ...rows].join('\n');
  },
};

// HTML 테이블 내보내기
const htmlStrategy: ExportStrategy = {
  mimeType: 'text/html',
  extension: 'html',
  export(data: ScrapeResult): string {
    const escapeHtml = (val: unknown): string => {
      const str = String(val ?? '');
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    const header = data.columns
      .map((col) => `<th>${escapeHtml(col)}</th>`)
      .join('');
    const rows = data.rows
      .map(
        (row) =>
          '<tr>' +
          data.columns
            .map((col) => `<td>${escapeHtml(row[col])}</td>`)
            .join('') +
          '</tr>'
      )
      .join('\n    ');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(data.title)} - ScrapeFlow</title>
  <style>
    table { border-collapse: collapse; width: 100%; font-family: system-ui; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.title)}</h1>
  <p>URL: ${escapeHtml(data.url)} | ${data.rows.length}행</p>
  <table>
    <thead><tr>${header}</tr></thead>
    <tbody>
    ${rows}
    </tbody>
  </table>
</body>
</html>`;
  },
};

const strategies: Record<Exclude<ExportFormat, 'clipboard'>, ExportStrategy> = {
  json: jsonStrategy,
  csv: csvStrategy,
  html: htmlStrategy,
};

// 파일 다운로드
export function downloadData(data: ScrapeResult, format: ExportFormat): void {
  if (format === 'clipboard') {
    const text = jsonStrategy.export(data);
    navigator.clipboard.writeText(text);
    return;
  }

  const strategy = strategies[format];
  const content = strategy.export(data);
  const blob = new Blob([content], { type: strategy.mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `scrapeflow-${Date.now()}.${strategy.extension}`;
  a.click();
  URL.revokeObjectURL(url);
}

// 테스트용 export
export { jsonStrategy, csvStrategy, htmlStrategy };
export type { ExportStrategy };
