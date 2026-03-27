import { MessageType } from '../lib/types';
import type { ScrapeResult, ExportFormat, Message } from '../lib/types';
import { downloadData } from '../lib/export';
import { getResults, saveResult } from '../lib/storage';

// === State ===
let currentStep = 1;
let selectedSource: 'current' | 'links' | 'file' = 'current';
let selectedNav: 'auto' | 'none' | 'click' | 'scroll' = 'auto';
let currentResult: ScrapeResult | null = null;
let fields: { name: string; type: string }[] = [];
let currentPage = 1;
const PAGE_SIZE = 20;

// === DOM refs ===
const $ = (id: string) => document.getElementById(id)!;
const $stepFill = $('step-fill') as HTMLDivElement;
const $stepLabel = $('step-label');
const $step1 = $('step1');
const $step2 = $('step2');
const $step3 = $('step3');
const $resultView = $('result-view');
const $btnBack = $('btn-back') as HTMLButtonElement;
const $btnNext = $('btn-next-step') as HTMLButtonElement;
const $progressSection = $('progress-section');
const $progressFill = $('progress-fill') as HTMLDivElement;
const $progressStatus = $('progress-status');
const $progressDetail = $('progress-detail');
const $sourceBar = $('source-bar');
const $sourceName = $('source-name');
const $templateEditor = $('template-editor');
const $fieldList = $('field-list');

// === Step navigation ===
function goToStep(step: number): void {
  currentStep = step;
  [$step1, $step2, $step3, $resultView].forEach((el) => el.classList.add('hidden'));

  if (step <= 3) {
    $stepFill.style.width = `${(step / 3) * 100}%`;
    $stepLabel.textContent = `${step}/3`;
    $('step-indicator').classList.remove('hidden');
    $btnNext.classList.remove('hidden');
    $('bottom-nav').classList.remove('hidden');
  }

  switch (step) {
    case 1:
      $step1.classList.remove('hidden');
      $btnBack.classList.add('hidden');
      $btnNext.textContent = '다음 →';
      break;
    case 2:
      $step2.classList.remove('hidden');
      $btnBack.classList.remove('hidden');
      $btnNext.textContent = '다음 →';
      break;
    case 3:
      $step3.classList.remove('hidden');
      $btnBack.classList.remove('hidden');
      $btnNext.textContent = '▶ 지금 실행';
      break;
    case 4: // 결과
      $resultView.classList.remove('hidden');
      $('step-indicator').classList.add('hidden');
      $btnNext.classList.add('hidden');
      $btnBack.classList.remove('hidden');
      break;
  }
}

// === Option selection ===
function setupOptionCards(container: string, callback: (value: string) => void): void {
  const parent = $(container);
  parent.querySelectorAll('.option-card').forEach((card) => {
    card.addEventListener('click', () => {
      parent.querySelectorAll('.option-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      const value = (card as HTMLElement).dataset['source'] || (card as HTMLElement).dataset['nav'] || '';
      callback(value);
    });
  });
}

// === Field management ===
const FIELD_TYPE_ICONS: Record<string, string> = {
  text: 'Aa', link: '🔗', image: '🖼️', number: '#',
};

function renderFields(): void {
  $fieldList.textContent = '';
  fields.forEach((field, i) => {
    const item = document.createElement('div');
    item.className = 'field-item';

    const icon = document.createElement('span');
    icon.className = 'field-type-icon';
    icon.textContent = FIELD_TYPE_ICONS[field.type] || 'Aa';

    const name = document.createElement('span');
    name.className = 'field-name';
    name.textContent = field.name;

    const remove = document.createElement('button');
    remove.className = 'field-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `${field.name} 필드 삭제`);
    remove.addEventListener('click', () => {
      fields.splice(i, 1);
      renderFields();
    });

    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(remove);
    $fieldList.appendChild(item);
  });

  if (fields.length > 0) {
    $('btn-add-field').classList.remove('hidden');
    $('btn-subpage').classList.remove('hidden');
  }
}

function addField(name: string, type = 'text'): void {
  fields.push({ name, type });
  renderFields();
}

// === AI Field suggestion ===
$('btn-ai-fields').addEventListener('click', async () => {
  const btn = $('btn-ai-fields') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = '✨ AI 분석 중...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const response = await chrome.tabs.sendMessage<Message, unknown>(tab.id, {
      type: MessageType.GET_PAGE_INFO,
    });

    // AI로 필드 추천 — Background SW에 요청
    const result = await chrome.runtime.sendMessage({
      type: MessageType.SCRAPE_START,
      payload: { tabId: tab.id, aiPrompt: 'auto-detect all fields' },
    });

    if (result?.columns) {
      fields = result.columns.map((col: string) => ({
        name: col,
        type: col.toLowerCase().includes('url') || col.toLowerCase().includes('link') ? 'link'
          : col.toLowerCase().includes('image') || col.toLowerCase().includes('img') ? 'image'
          : 'text',
      }));
      renderFields();
      $templateEditor.classList.remove('hidden');
    }
  } catch (err) {
    console.error('AI field suggestion failed:', err);
    // 폴백: 기본 필드 제안
    fields = [
      { name: 'Title', type: 'text' },
      { name: 'URL', type: 'link' },
      { name: 'Description', type: 'text' },
    ];
    renderFields();
    $templateEditor.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ AI 추천 필드';
  }
});

// 직접 입력
$('btn-manual-fields').addEventListener('click', () => {
  $templateEditor.classList.remove('hidden');
  if (fields.length === 0) {
    addField('Field 1');
  }
});

// 필드 추가
$('btn-add-field').addEventListener('click', () => {
  const name = `Field ${fields.length + 1}`;
  addField(name);
});

// 새 템플릿
$('btn-new-template').addEventListener('click', () => {
  $templateEditor.classList.remove('hidden');
  fields = [];
  renderFields();
});

// === Scraping execution ===
async function runScraping(): Promise<void> {
  showProgress('작업 진행 중...', 0);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    updateProgress('1 페이지 스크래핑 완료', 30);
    updateProgressDetail(`데이터 추출 중\n↔ ${tab.url}`);

    // Content Script에 스크래핑 요청
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.SCRAPE_START,
    });

    if (result?.rows?.length > 0) {
      currentResult = result;
      await saveResult(result);
      updateProgress('스크래핑 완료', 100);

      setTimeout(() => {
        hideProgress();
        goToStep(4);
        renderResultTable();
      }, 500);
    } else {
      updateProgress('데이터를 찾지 못했습니다', 100);
      updateProgressDetail('다른 설정으로 다시 시도해보세요');
    }
  } catch (err) {
    updateProgress('스크래핑 실패', 100);
    updateProgressDetail(String(err));
  }
}

// === Progress ===
function showProgress(status: string, percent: number): void {
  $progressSection.classList.remove('hidden');
  $progressFill.style.width = `${percent}%`;
  $progressStatus.textContent = status;
}

function updateProgress(status: string, percent: number): void {
  $progressFill.style.width = `${percent}%`;
  $progressStatus.textContent = status;
}

function updateProgressDetail(detail: string): void {
  $progressDetail.textContent = detail;
}

function hideProgress(): void {
  $progressSection.classList.add('hidden');
}

// === Result table ===
function renderResultTable(): void {
  if (!currentResult) return;

  $('row-count').textContent = `행 수: ${currentResult.rows.length}`;
  $('result-source').textContent = currentResult.title;

  const $tableHead = $('table-head');
  const $tableBody = $('table-body');

  // 헤더
  $tableHead.textContent = '';
  const headerRow = document.createElement('tr');
  for (const col of currentResult.columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  }
  $tableHead.appendChild(headerRow);

  // 페이지네이션 계산
  const totalPages = Math.ceil(currentResult.rows.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageRows = currentResult.rows.slice(start, end);

  // 바디
  $tableBody.textContent = '';
  for (const row of pageRows) {
    const tr = document.createElement('tr');
    for (const col of currentResult.columns) {
      const td = document.createElement('td');
      const value = String(row[col] ?? '');
      td.title = value;

      if (value.startsWith('http://') || value.startsWith('https://')) {
        const link = document.createElement('a');
        link.href = value;
        link.textContent = value.length > 40 ? value.slice(0, 40) + '...' : value;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        td.appendChild(link);
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
    }
    $tableBody.appendChild(tr);
  }

  // 페이지네이션 UI
  if (totalPages > 1) {
    $('pagination').classList.remove('hidden');
    $('page-info').textContent = `${currentPage} / ${totalPages}`;
    ($('btn-prev') as HTMLButtonElement).disabled = currentPage <= 1;
    ($('btn-next') as HTMLButtonElement).disabled = currentPage >= totalPages;
  } else {
    $('pagination').classList.add('hidden');
  }
}

// === Download ===
$('btn-download').addEventListener('click', () => {
  $('download-menu').classList.toggle('hidden');
});

document.querySelectorAll('.dropdown-item').forEach((item) => {
  item.addEventListener('click', () => {
    if (!currentResult) return;
    const format = (item as HTMLElement).dataset['format'] as ExportFormat;
    if (format === 'xlsx') {
      // Excel은 CSV로 대체 (라이브러리 없이)
      downloadData(currentResult, 'csv');
    } else {
      downloadData(currentResult, format);
    }
    $('download-menu').classList.add('hidden');
  });
});

$('btn-copy').addEventListener('click', () => {
  if (!currentResult) return;
  downloadData(currentResult, 'clipboard');
});

// === Pagination ===
$('btn-prev').addEventListener('click', () => {
  if (currentPage > 1) { currentPage--; renderResultTable(); }
});

$('btn-next').addEventListener('click', () => {
  if (currentResult && currentPage < Math.ceil(currentResult.rows.length / PAGE_SIZE)) {
    currentPage++; renderResultTable();
  }
});

// === Navigation ===
$btnBack.addEventListener('click', () => {
  if (currentStep > 1) goToStep(currentStep - 1);
});

$btnNext.addEventListener('click', async () => {
  if (currentStep === 3) {
    await runScraping();
  } else {
    goToStep(currentStep + 1);
  }
});

// === Source selection ===
setupOptionCards('step1', (v) => {
  selectedSource = v as typeof selectedSource;
});

setupOptionCards('step2', (v) => {
  selectedNav = v as typeof selectedNav;
});

// === Init ===
async function init(): Promise<void> {
  // 현재 탭 정보 표시
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    $('current-page-info').textContent = `${tab.title?.slice(0, 40)}\n${tab.url?.slice(0, 50)}`;
    $sourceName.textContent = tab.title ?? '';
    $sourceBar.classList.remove('hidden');
  }

  // 기존 결과가 있으면 바로 결과 화면
  const results = await getResults();
  if (results.length > 0) {
    currentResult = results[0];
    // 위저드부터 시작 (결과로 바로 가지 않음)
  }

  goToStep(1);
}

// 외부 close 클릭 시 드롭다운 닫기
document.addEventListener('click', (e) => {
  const menu = $('download-menu');
  const btn = $('btn-download');
  if (!menu.contains(e.target as Node) && e.target !== btn) {
    menu.classList.add('hidden');
  }
});

// storage 변경 감지
chrome.storage.onChanged.addListener((changes) => {
  if (changes['scrapeflow_results']?.newValue) {
    const results = changes['scrapeflow_results'].newValue as ScrapeResult[];
    if (results.length > 0) {
      currentResult = results[0];
      if (currentStep === 4) renderResultTable();
    }
  }
});

init();
