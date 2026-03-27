import { MessageType } from '../lib/types';
import type { ScrapeResult, ExportFormat, Message, DetectedPatternInfo, AICloneResult } from '../lib/types';
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

// Clone 모드 state
let isCloneMode = false;
let cloneStep = 1;
let clonePatterns: DetectedPatternInfo[] = [];
let cloneAiResult: AICloneResult | null = null;
let cloneResult: ScrapeResult | null = null;
let clonePage = 1;

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
    if (format === 'xlsx' as string) {
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
  if (isCloneMode) {
    if (cloneStep > 1) goToCloneStep(cloneStep - 1);
  } else {
    if (currentStep > 1) goToStep(currentStep - 1);
  }
});

$btnNext.addEventListener('click', async () => {
  if (isCloneMode) {
    if (cloneStep === 2) {
      await runCloneExtract();
    } else if (cloneStep < 3) {
      goToCloneStep(cloneStep + 1);
    }
  } else {
    if (currentStep === 3) {
      await runScraping();
    } else {
      goToStep(currentStep + 1);
    }
  }
});

// === Source selection ===
setupOptionCards('step1', (v) => {
  selectedSource = v as typeof selectedSource;
});

setupOptionCards('step2', (v) => {
  selectedNav = v as typeof selectedNav;
});

// === Clone 모드 함수 ===

function goToCloneStep(step: number): void {
  cloneStep = step;

  // 모든 스텝 숨김
  [$step1, $step2, $step3, $resultView].forEach((el) => el.classList.add('hidden'));
  $('clone-step1').classList.add('hidden');
  $('clone-step2').classList.add('hidden');
  $('clone-step3').classList.add('hidden');

  // 스텝 인디케이터 업데이트
  $stepFill.style.width = `${(step / 3) * 100}%`;
  $stepLabel.textContent = `${step}/3`;
  $('step-indicator').classList.remove('hidden');

  switch (step) {
    case 1:
      $('clone-step1').classList.remove('hidden');
      $btnBack.classList.add('hidden');
      $btnNext.classList.add('hidden');
      break;
    case 2:
      $('clone-step2').classList.remove('hidden');
      $btnBack.classList.remove('hidden');
      $btnNext.classList.remove('hidden');
      $btnNext.textContent = '▶ 데이터 추출';
      break;
    case 3:
      $('clone-step3').classList.remove('hidden');
      $btnBack.classList.remove('hidden');
      $btnNext.classList.add('hidden');
      $('step-indicator').classList.add('hidden');
      break;
  }
}

// 구조 감지 실행
async function runCloneDetect(): Promise<void> {
  const btn = $('btn-clone-detect') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = '✨ 분석 중...';
  $('clone-error').classList.add('hidden');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CLONE_DETECT_PATTERNS,
      payload: { tabId: tab.id },
    }) as { patterns: DetectedPatternInfo[]; aiResult?: AICloneResult; error?: string };

    if (response.error && (!response.patterns || response.patterns.length === 0)) {
      $('clone-error').textContent = response.error;
      $('clone-error').classList.remove('hidden');
      return;
    }

    clonePatterns = response.patterns ?? [];
    cloneAiResult = response.aiResult ?? null;

    // 패턴 카드 렌더링
    const $patterns = $('clone-patterns');
    $patterns.textContent = '';
    $patterns.classList.remove('hidden');

    for (let i = 0; i < clonePatterns.length; i++) {
      const p = clonePatterns[i];
      const card = document.createElement('div');
      card.className = 'clone-pattern-card' + (i === 0 ? ' selected' : '');

      const title = document.createElement('div');
      title.className = 'clone-pattern-title';
      title.textContent = `패턴 ${i + 1}: ${p.itemCount}개 항목 감지`;

      const meta = document.createElement('div');
      meta.className = 'clone-pattern-meta';
      meta.textContent = `구조: ${p.signature} | 점수: ${p.score.toFixed(1)}`;

      card.appendChild(title);
      card.appendChild(meta);

      card.addEventListener('click', () => {
        $patterns.querySelectorAll('.clone-pattern-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });

      $patterns.appendChild(card);
    }

    // AI 결과가 있으면 필드 표시
    if (cloneAiResult) {
      const aiInfo = document.createElement('div');
      aiInfo.className = 'clone-pattern-card selected';
      aiInfo.style.borderColor = '#22c55e';

      const aiTitle = document.createElement('div');
      aiTitle.className = 'clone-pattern-title';
      aiTitle.textContent = `✨ AI 분석: ${cloneAiResult.columns.length}개 필드 감지`;

      const aiMeta = document.createElement('div');
      aiMeta.className = 'clone-pattern-meta';
      aiMeta.textContent = `페이지 타입: ${cloneAiResult.pageType} | 필드: ${cloneAiResult.columns.map((c) => c.name).join(', ')}`;

      aiInfo.appendChild(aiTitle);
      aiInfo.appendChild(aiMeta);
      $patterns.insertBefore(aiInfo, $patterns.firstChild);

      // 자동으로 Step 2로 이동
      setTimeout(() => goToCloneStep(2), 500);
      renderCloneFields();
    }
  } catch (err) {
    $('clone-error').textContent = `감지 실패: ${String(err)}`;
    $('clone-error').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    // 안전하게 버튼 복원 (textContent + DOM 조작)
    btn.textContent = '';
    const span = document.createElement('span');
    span.textContent = '✨';
    btn.appendChild(span);
    btn.appendChild(document.createTextNode(' 구조 감지 시작'));
  }
}

// Clone 필드 렌더링
function renderCloneFields(): void {
  if (!cloneAiResult) return;

  const $fields = $('clone-fields');
  $fields.textContent = '';

  const ICONS: Record<string, string> = {
    text: 'Aa', link: '🔗', image: '🖼️', file: '📎', number: '#',
  };

  for (let i = 0; i < cloneAiResult.columns.length; i++) {
    const col = cloneAiResult.columns[i];
    const item = document.createElement('div');
    item.className = 'field-item';

    const icon = document.createElement('span');
    icon.className = 'field-type-icon';
    icon.textContent = ICONS[col.type] || 'Aa';

    const name = document.createElement('span');
    name.className = 'field-name';
    name.textContent = col.name;

    const typeLabel = document.createElement('span');
    typeLabel.style.cssText = 'font-size: 11px; color: var(--text-dim); margin-left: auto;';
    typeLabel.textContent = col.type + (col.attribute ? ` [${col.attribute}]` : '');

    const remove = document.createElement('button');
    remove.className = 'field-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      cloneAiResult!.columns.splice(i, 1);
      renderCloneFields();
    });

    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(typeLabel);
    item.appendChild(remove);
    $fields.appendChild(item);
  }
}

// Clone 데이터 추출 실행
async function runCloneExtract(): Promise<void> {
  if (!cloneAiResult) return;

  showProgress('데이터 추출 중...', 30);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const result = await chrome.runtime.sendMessage({
      type: MessageType.CLONE_EXTRACT_DATA,
      payload: {
        tabId: tab.id,
        containerSelector: cloneAiResult.containerSelector,
        itemSelector: cloneAiResult.itemSelector,
        columns: cloneAiResult.columns,
      },
    }) as ScrapeResult;

    updateProgress('추출 완료', 100);

    if (result?.rows?.length > 0) {
      cloneResult = result;
      setTimeout(() => {
        hideProgress();
        goToCloneStep(3);
        renderCloneResult();
      }, 300);
    } else {
      updateProgress('데이터를 찾지 못했습니다', 100);
      updateProgressDetail('셀렉터를 확인해주세요');
    }
  } catch (err) {
    updateProgress('추출 실패', 100);
    updateProgressDetail(String(err));
  }
}

// Clone 결과 렌더링
function renderCloneResult(): void {
  if (!cloneResult) return;

  $('clone-result-info').textContent = `${cloneResult.rows.length}행 × ${cloneResult.columns.length}열 추출 완료`;

  const $head = $('clone-result-head');
  const $body = $('clone-result-body');

  // 헤더
  $head.textContent = '';
  const headerRow = document.createElement('tr');
  for (const col of cloneResult.columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  }
  $head.appendChild(headerRow);

  // 페이지네이션
  const totalPages = Math.ceil(cloneResult.rows.length / PAGE_SIZE);
  const start = (clonePage - 1) * PAGE_SIZE;
  const pageRows = cloneResult.rows.slice(start, start + PAGE_SIZE);

  $body.textContent = '';
  for (const row of pageRows) {
    const tr = document.createElement('tr');
    for (const col of cloneResult.columns) {
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
        td.textContent = value.length > 60 ? value.slice(0, 60) + '...' : value;
      }
      tr.appendChild(td);
    }
    $body.appendChild(tr);
  }

  // 페이지네이션 UI
  if (totalPages > 1) {
    $('clone-pagination').classList.remove('hidden');
    $('clone-page-info').textContent = `${clonePage} / ${totalPages}`;
    ($('clone-btn-prev') as HTMLButtonElement).disabled = clonePage <= 1;
    ($('clone-btn-next') as HTMLButtonElement).disabled = clonePage >= totalPages;
  }
}

// Clone 내보내기 버튼
document.querySelectorAll('.clone-export-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!cloneResult) return;
    const format = (btn as HTMLElement).dataset['cloneFormat'] as ExportFormat;
    downloadData(cloneResult, format);
  });
});

// Clone 페이지네이션
$('clone-btn-prev')?.addEventListener('click', () => {
  if (clonePage > 1) { clonePage--; renderCloneResult(); }
});

$('clone-btn-next')?.addEventListener('click', () => {
  if (cloneResult && clonePage < Math.ceil(cloneResult.rows.length / PAGE_SIZE)) {
    clonePage++; renderCloneResult();
  }
});

// 구조 감지 버튼
$('btn-clone-detect').addEventListener('click', runCloneDetect);

// === Init ===
async function init(): Promise<void> {
  // Clone 모드 감지
  const storage = await chrome.storage.local.get('sf_mode');
  isCloneMode = storage['sf_mode'] === 'clone';

  // 모드 초기화 후 플래그 제거
  if (isCloneMode) {
    await chrome.storage.local.remove('sf_mode');
  }

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
  }

  if (isCloneMode) {
    // Clone 모드: clone wizard 표시
    $('bottom-nav').classList.remove('hidden');
    goToCloneStep(1);
  } else {
    goToStep(1);
  }
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
