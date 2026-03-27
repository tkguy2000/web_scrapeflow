import type { ScrapeResult, ExportFormat } from '../lib/types';
import { downloadData } from '../lib/export';
import { getResults, clearResults } from '../lib/storage';

const $emptyState = document.getElementById('empty-state')!;
const $resultContainer = document.getElementById('result-container')!;
const $resultSummary = document.getElementById('result-summary')!;
const $tableHead = document.getElementById('table-head')!;
const $tableBody = document.getElementById('table-body')!;
const $btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const $btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const $exportFormat = document.getElementById('export-format') as HTMLSelectElement;
const $historyBar = document.getElementById('history-bar')!;
const $historySelect = document.getElementById('history-select') as HTMLSelectElement;
const $toast = document.getElementById('toast')!;
const $toastMessage = document.getElementById('toast-message')!;

let currentResult: ScrapeResult | null = null;
let allResults: ScrapeResult[] = [];

// 토스트 표시
function showToast(message: string): void {
  $toastMessage.textContent = message;
  $toast.classList.remove('hidden');
  setTimeout(() => $toast.classList.add('hidden'), 2500);
}

// 히스토리 드롭다운 업데이트
function updateHistory(results: ScrapeResult[]): void {
  allResults = results;
  if (results.length <= 1) {
    $historyBar.classList.add('hidden');
    return;
  }

  $historyBar.classList.remove('hidden');
  $historySelect.textContent = '';

  results.forEach((r, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    const date = new Date(r.timestamp);
    const timeStr = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    option.textContent = `${timeStr} — ${r.title.slice(0, 30)} (${r.rows.length}행)`;
    $historySelect.appendChild(option);
  });
}

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

  // 행 번호 컬럼
  const thNum = document.createElement('th');
  thNum.textContent = '#';
  thNum.style.width = '40px';
  thNum.style.textAlign = 'center';
  headerRow.appendChild(thNum);

  for (const col of result.columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  }
  $tableHead.appendChild(headerRow);

  // 바디 렌더링
  $tableBody.textContent = '';
  result.rows.forEach((row, idx) => {
    const tr = document.createElement('tr');

    // 행 번호
    const tdNum = document.createElement('td');
    tdNum.textContent = String(idx + 1);
    tdNum.style.textAlign = 'center';
    tdNum.style.color = '#adb5bd';
    tdNum.style.fontSize = '11px';
    tr.appendChild(tdNum);

    for (const col of result.columns) {
      const td = document.createElement('td');
      const value = String(row[col] ?? '');
      td.textContent = value;
      td.title = value;

      // URL 감지 — 링크로 표시
      if (value.startsWith('http://') || value.startsWith('https://')) {
        td.textContent = '';
        const link = document.createElement('a');
        link.href = value;
        link.textContent = value.length > 50 ? value.slice(0, 50) + '...' : value;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.color = '#6c5ce7';
        link.style.textDecoration = 'none';
        td.appendChild(link);
      }

      tr.appendChild(td);
    }
    $tableBody.appendChild(tr);
  });
}

// 내보내기
$btnExport.addEventListener('click', () => {
  if (!currentResult) return;
  const format = $exportFormat.value as ExportFormat;

  if (format === 'clipboard') {
    downloadData(currentResult, format);
    showToast('클립보드에 복사되었습니다');
  } else {
    downloadData(currentResult, format);
    showToast(`${format.toUpperCase()} 파일이 다운로드됩니다`);
  }
});

// 히스토리 선택
$historySelect.addEventListener('change', () => {
  const idx = parseInt($historySelect.value, 10);
  if (allResults[idx]) {
    renderResult(allResults[idx]);
  }
});

// 결과 지우기
$btnClear.addEventListener('click', async () => {
  await clearResults();
  currentResult = null;
  allResults = [];
  $resultContainer.classList.add('hidden');
  $emptyState.classList.remove('hidden');
  $btnExport.disabled = true;
  showToast('결과가 삭제되었습니다');
});

// 초기 데이터 로드
async function init(): Promise<void> {
  const results = await getResults();
  if (results.length > 0) {
    updateHistory(results);
    renderResult(results[0]);
  }
}

// storage 변경 감지
chrome.storage.onChanged.addListener((changes) => {
  if (changes['scrapeflow_results']?.newValue) {
    const results = changes['scrapeflow_results'].newValue as ScrapeResult[];
    updateHistory(results);
    if (results.length > 0) {
      renderResult(results[0]);
    }
  }
});

init();
