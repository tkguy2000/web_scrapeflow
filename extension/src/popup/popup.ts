import { MessageType } from '../lib/types';
import type { PageInfo, ScrapeResult, ExportFormat, Message } from '../lib/types';
import { downloadData } from '../lib/export';

// === 다국어 텍스트 ===
type I18nValue = string | ((...args: string[]) => string);
const i18n: Record<string, Record<string, I18nValue>> = {
  ko: {
    pageLoading: '페이지 로딩 중...',
    unknownPage: '알 수 없는 페이지',
    analyzing: '페이지 분석 대기 중...',
    aiExtract: '데이터 추출',
    aiAnalyzing: '📊 분석 중...',
    fullCapture: '풀 페이지 캡처',
    capturing: '캡처 중...',
    siteClone: 'Site Clone',
    noData: '이 페이지에서 추출할 데이터가 없습니다',
    noDataDesc: '테이블이나 리스트가 있는 페이지에서 사용해보세요',
    rowExtracted: (r: string, c: string) => `${r}행 × ${c}열 추출됨`,
    viewDetail: '상세 보기 →',
    copy: '복사',
    settings: '설정',
    apiKeyLabel: 'Claude API Key',
    save: '저장',
    apiKeySet: 'API 키가 설정되어 있습니다',
    enterApiKey: 'API 키를 입력해주세요',
    saved: '저장되었습니다',
    table: '테이블',
    list: '리스트',
    noStructured: '구조화된 데이터 없음',
    unit: '개',
    analyzingPage: '페이지를 분석하고 있습니다...',
    aiInferring: '데이터 구조를 분석하고 있습니다...',
    notFound: '추출할 데이터를 찾지 못했습니다',
    extractFailed: '추출에 실패했습니다',
    capturingPage: '전체 페이지를 캡처하고 있습니다...',
    captureComplete: '캡처 완료! 다운로드를 확인하세요.',
    captureFailed: '캡처 실패',
  },
  en: {
    pageLoading: 'Loading page...',
    unknownPage: 'Unknown page',
    analyzing: 'Waiting for page analysis...',
    aiExtract: 'Extract Data',
    aiAnalyzing: '📊 Analyzing...',
    fullCapture: 'Full Page Capture',
    capturing: 'Capturing...',
    siteClone: 'Site Clone',
    noData: 'No extractable data found on this page',
    noDataDesc: 'Try on a page with tables or lists',
    rowExtracted: (r: string, c: string) => `${r} rows × ${c} cols extracted`,
    viewDetail: 'View Details →',
    copy: 'Copy',
    settings: 'Settings',
    apiKeyLabel: 'Claude API Key',
    save: 'Save',
    apiKeySet: 'API key is configured',
    enterApiKey: 'Please enter an API key',
    saved: 'Saved',
    table: 'Tables',
    list: 'Lists',
    noStructured: 'No structured data',
    unit: '',
    analyzingPage: 'Analyzing page...',
    aiInferring: 'Analyzing data structure...',
    notFound: 'No extractable data found',
    extractFailed: 'Extraction failed',
    capturingPage: 'Capturing full page...',
    captureComplete: 'Capture complete! Check your downloads.',
    captureFailed: 'Capture failed',
  },
};

// 현재 언어 (기본: ko)
let currentLang = 'ko';

function t(key: string, ...args: string[]): string {
  const val = i18n[currentLang]?.[key] ?? i18n['ko'][key] ?? key;
  if (typeof val === 'function') return val(...args);
  return val;
}

// === 테마 관리 ===
type ThemeMode = 'dark' | 'light' | 'system';
let currentTheme: ThemeMode = 'dark';

function applyTheme(mode: ThemeMode): void {
  currentTheme = mode;
  const root = document.documentElement;

  // 실제 적용할 테마 결정
  let resolved: 'dark' | 'light';
  if (mode === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    resolved = mode;
  }

  // 항상 명시적으로 data-theme 설정
  root.setAttribute('data-theme', resolved);

  // 토글 버튼 활성화 상태 업데이트
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    const btnTheme = (btn as HTMLElement).dataset['theme'];
    btn.classList.toggle('active', btnTheme === mode);
  });

  chrome.storage.local.set({ sf_theme: mode });
}

function applyLang(lang: string): void {
  currentLang = lang;
  document.documentElement.lang = lang === 'ko' ? 'ko' : 'en';

  // 정적 텍스트 업데이트
  const $langBtn = document.getElementById('lang-toggle')!;
  $langBtn.textContent = lang === 'ko' ? '한/EN' : 'EN/한';

  // UI 텍스트 갱신
  $pageTitle.textContent = $pageTitle.textContent === t('pageLoading') || $pageTitle.dataset['original'] === undefined
    ? t('pageLoading') : $pageTitle.textContent;
  document.querySelector('.empty-title')!.textContent = t('noData');
  document.querySelector('.empty-desc')!.textContent = t('noDataDesc');
  document.getElementById('btn-open-panel')!.textContent = t('viewDetail');
  document.querySelector('[data-format="clipboard"]')!.textContent = t('copy');
  document.getElementById('btn-settings')!.textContent = t('settings');
  document.querySelector('.settings-title')!.textContent = t('settings');
  document.querySelector('.settings-label')!.textContent = t('apiKeyLabel');
  document.getElementById('btn-save-key')!.textContent = t('save');

  // 버튼 텍스트
  resetButton($btnScrape, '📊', t('aiExtract'));
  resetButton($btnCapture, '📸', t('fullCapture'));
  // Site Clone 버튼 복원
  const $clone = document.getElementById('btn-clone')!;
  $clone.textContent = '';
  const cloneIcon = document.createElement('span');
  cloneIcon.className = 'btn-icon';
  cloneIcon.textContent = '🏗️';
  $clone.appendChild(cloneIcon);
  $clone.appendChild(document.createTextNode(` ${t('siteClone')}`));

  chrome.storage.local.set({ sf_lang: lang });
}

const $pageTitle = document.getElementById('page-title')!;
const $pageUrl = document.getElementById('page-url')!;
const $pageStats = document.getElementById('page-stats')!;
const $btnScrape = document.getElementById('btn-scrape') as HTMLButtonElement;
const $btnCapture = document.getElementById('btn-capture') as HTMLButtonElement;
const $btnClone = document.getElementById('btn-clone') as HTMLButtonElement;
const $btnOpenPanel = document.getElementById('btn-open-panel')!;
const $emptyState = document.getElementById('empty-state')!;
const $resultPreview = document.getElementById('result-preview')!;
const $resultCount = document.getElementById('result-count')!;
const $aiHint = document.getElementById('ai-hint')!;

let lastResult: ScrapeResult | null = null;

// 버튼 콘텐츠 복원
function resetButton(btn: HTMLButtonElement, icon: string, label: string): void {
  btn.textContent = '';
  const span = document.createElement('span');
  span.className = 'btn-icon';
  span.textContent = icon;
  btn.appendChild(span);
  btn.appendChild(document.createTextNode(` ${label}`));
}

// 통계 요소 생성
function createStatElement(label: string, count: number): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'stat';
  span.textContent = `${label} `;
  const countSpan = document.createElement('span');
  countSpan.className = 'stat-count';
  countSpan.textContent = String(count);
  span.appendChild(countSpan);
  span.appendChild(document.createTextNode(t('unit') ? t('unit') : ''));
  return span;
}

// 결과 표시
function showResult(result: ScrapeResult): void {
  lastResult = result;
  $resultPreview.classList.remove('hidden');
  $resultCount.textContent = t('rowExtracted', String(result.rows.length), String(result.columns.length));
  $emptyState.classList.add('hidden');
  $aiHint.textContent = '';
}

// 현재 탭 정보
async function loadPageInfo(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;

  $pageTitle.textContent = tab.title ?? t('unknownPage');
  $pageUrl.textContent = tab.url;

  try {
    const response = await chrome.tabs.sendMessage<Message, PageInfo>(tab.id, {
      type: MessageType.GET_PAGE_INFO,
    });
    if (response) updatePageStats(response);
  } catch {
    $pageStats.textContent = t('analyzing');
  }
}

function updatePageStats(info: PageInfo): void {
  $pageStats.textContent = '';
  if (info.tableCount > 0) $pageStats.appendChild(createStatElement(t('table'), info.tableCount));
  if (info.listCount > 0) $pageStats.appendChild(createStatElement(t('list'), info.listCount));
  if (!info.hasStructuredData) $pageStats.textContent = t('noStructured');
}

// AI 추출 (원클릭 자동)
$btnScrape.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  $btnScrape.disabled = true;
  $btnScrape.textContent = t('aiAnalyzing');
  $aiHint.textContent = t('analyzingPage');

  try {
    // DOM 기반 스크래핑 (pattern-detector 포함)
    let result: ScrapeResult | null = null;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.SCRAPE_START,
      });
    } catch { /* Content Script 미주입 */ }

    // 결과 표시
    if (result && result.rows && result.rows.length > 0) {
      showResult(result);
      await chrome.runtime.sendMessage({
        type: MessageType.SCRAPE_RESULT,
        payload: result,
      });
    } else {
      $emptyState.classList.remove('hidden');
      $aiHint.textContent = t('notFound');
    }
  } catch (err) {
    console.error('추출 실패:', err);
    $aiHint.textContent = t('extractFailed');
  } finally {
    $btnScrape.disabled = false;
    resetButton($btnScrape, '📊', t('aiExtract'));
  }
});

// 풀 페이지 캡처
$btnCapture.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  $btnCapture.disabled = true;
  $btnCapture.textContent = t('capturing');
  $aiHint.textContent = t('capturingPage');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CAPTURE_FULL_PAGE,
      payload: { tabId: tab.id, format: 'png', fullPage: true },
    });
    if (response?.ok) {
      $aiHint.textContent = t('captureComplete');
    } else {
      $aiHint.textContent = `${t('captureFailed')}: ${response?.error || 'Unknown error'}`;
    }
  } catch (err) {
    console.error('Capture failed:', err);
    $aiHint.textContent = `${t('captureFailed')}: ${String(err)}`;
  } finally {
    $btnCapture.disabled = false;
    resetButton($btnCapture, '📸', t('fullCapture'));
  }
});

// 빠른 내보내기
document.querySelectorAll('.btn-export-sm').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!lastResult) return;
    const format = (btn as HTMLElement).dataset['format'] as ExportFormat;
    downloadData(lastResult, format);
  });
});

// Site Clone — sidepanel을 clone 모드로 열기
$btnClone.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) return;
  await chrome.storage.local.set({ sf_mode: 'clone' });
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});

// Side Panel 열기
$btnOpenPanel.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});

// 설정 패널
const $btnSettings = document.getElementById('btn-settings')!;
const $settingsPanel = document.getElementById('settings-panel')!;
const $apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const $btnSaveKey = document.getElementById('btn-save-key') as HTMLButtonElement;
const $keyStatus = document.getElementById('key-status')!;

$btnSettings.addEventListener('click', async () => {
  $settingsPanel.classList.toggle('hidden');
  if (!$settingsPanel.classList.contains('hidden')) {
    const { getApiKey } = await import('../lib/ai');
    const key = await getApiKey();
    if (key) {
      $apiKeyInput.value = key;
      $keyStatus.textContent = t('apiKeySet');
    }
  }
});

$btnSaveKey.addEventListener('click', async () => {
  const key = $apiKeyInput.value.trim();
  if (!key) { $keyStatus.textContent = t('enterApiKey'); return; }
  const { setApiKey } = await import('../lib/ai');
  await setApiKey(key);
  $keyStatus.textContent = t('saved');
  setTimeout(() => $settingsPanel.classList.add('hidden'), 1000);
});

// === 테마 토글 이벤트 ===
document.querySelectorAll('.theme-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = (btn as HTMLElement).dataset['theme'] as ThemeMode;
    applyTheme(mode);
  });
});

// 시스템 테마 변경 감지
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (currentTheme === 'system') applyTheme('system');
});

// === 언어 토글 이벤트 ===
document.getElementById('lang-toggle')!.addEventListener('click', () => {
  applyLang(currentLang === 'ko' ? 'en' : 'ko');
  // 페이지 정보 다시 로드 (통계 텍스트 갱신)
  loadPageInfo();
});

// === 초기화: 저장된 설정 복원 ===
(async () => {
  const stored = await chrome.storage.local.get(['sf_theme', 'sf_lang']);
  if (stored['sf_theme']) applyTheme(stored['sf_theme'] as ThemeMode);
  if (stored['sf_lang']) applyLang(stored['sf_lang'] as string);
  loadPageInfo();
})();
