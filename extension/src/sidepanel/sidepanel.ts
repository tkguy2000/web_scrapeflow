import type { ScrapeResult, ExportFormat } from '../lib/types';
import { downloadData } from '../lib/export';
import { getResults } from '../lib/storage';

const $emptyState = document.getElementById('empty-state')!;
const $resultContainer = document.getElementById('result-container')!;
const $resultSummary = document.getElementById('result-summary')!;
const $tableHead = document.getElementById('table-head')!;
const $tableBody = document.getElementById('table-body')!;
const $btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const $exportFormat = document.getElementById('export-format') as HTMLSelectElement;

let currentResult: ScrapeResult | null = null;

// 결과 테이블 렌더링
function renderResult(result: ScrapeResult): void {
  currentResult = result;
  $emptyState.classList.add('hidden');
  $resultContainer.classList.remove('hidden');
  $btnExport.disabled = false;

  $resultSummary.textContent = `${result.rows.length}행 × ${result.columns.length}열 | ${result.title}`;

  // 헤더 렌더링
  $tableHead.textContent = '';
  const headerRow = document.createElement('tr');
  for (const col of result.columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  }
  $tableHead.appendChild(headerRow);

  // 바디 렌더링
  $tableBody.textContent = '';
  for (const row of result.rows) {
    const tr = document.createElement('tr');
    for (const col of result.columns) {
      const td = document.createElement('td');
      td.textContent = String(row[col] ?? '');
      td.title = String(row[col] ?? ''); // 툴팁으로 전체 내용 표시
      tr.appendChild(td);
    }
    $tableBody.appendChild(tr);
  }
}

// 내보내기
$btnExport.addEventListener('click', () => {
  if (!currentResult) return;
  const format = $exportFormat.value as ExportFormat;
  downloadData(currentResult, format);
});

// 초기 데이터 로드
async function init(): Promise<void> {
  const results = await getResults();
  if (results.length > 0) {
    renderResult(results[0]);
  }
}

// storage 변경 감지 — 새 결과 실시간 반영
chrome.storage.onChanged.addListener((changes) => {
  if (changes['scrapeflow_results']?.newValue) {
    const results = changes['scrapeflow_results'].newValue as ScrapeResult[];
    if (results.length > 0) {
      renderResult(results[0]);
    }
  }
});

init();
