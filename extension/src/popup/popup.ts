import { MessageType } from '../lib/types';
import type { PageInfo, Message } from '../lib/types';

// === 다국어 텍스트 ===
type I18nValue = string | ((...args: string[]) => string);
const i18n: Record<string, Record<string, I18nValue>> = {
  ko: {
    pageLoading: '페이지 로딩 중...',
    unknownPage: '알 수 없는 페이지',
    analyzing: '페이지 분석 대기 중...',
    extract: '데이터 추출',
    fullCapture: '풀 페이지 캡처',
    capturing: '캡처 중...',
    table: '테이블',
    list: '리스트',
    noStructured: '구조화된 데이터 없음',
    unit: '개',
    capturingPage: '전체 페이지를 캡처하고 있습니다...',
    captureComplete: '캡처 완료! 다운로드를 확인하세요.',
    captureFailed: '캡처 실패',
  },
  en: {
    pageLoading: 'Loading page...',
    unknownPage: 'Unknown page',
    analyzing: 'Waiting for page analysis...',
    extract: 'Extract Data',
    fullCapture: 'Full Page Capture',
    capturing: 'Capturing...',
    table: 'Tables',
    list: 'Lists',
    noStructured: 'No structured data',
    unit: '',
    capturingPage: 'Capturing full page...',
    captureComplete: 'Capture complete! Check your downloads.',
    captureFailed: 'Capture failed',
  },
};

// 현재 언어 (기본: en)
let currentLang = 'en';

function t(key: string, ...args: string[]): string {
  const val = i18n[currentLang]?.[key] ?? i18n['en'][key] ?? key;
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

  // 버튼 텍스트
  resetButton($btnExtract, '📊', t('extract'));
  resetButton($btnCapture, '📸', t('fullCapture'));

  chrome.storage.local.set({ sf_lang: lang });
}

const $pageTitle = document.getElementById('page-title')!;
const $pageUrl = document.getElementById('page-url')!;
const $pageStats = document.getElementById('page-stats')!;
const $btnExtract = document.getElementById('btn-extract') as HTMLButtonElement;
const $btnCapture = document.getElementById('btn-capture') as HTMLButtonElement;

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

// === 데이터 추출 — 사이드패널 열기 ===
$btnExtract.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});

// === 풀 페이지 캡처 ===
$btnCapture.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  $btnCapture.disabled = true;
  $btnCapture.textContent = t('capturing');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CAPTURE_FULL_PAGE,
      payload: { tabId: tab.id, format: 'png', fullPage: true },
    });
    if (!response?.ok) {
      console.error('Capture failed:', response?.error);
    }
  } catch (err) {
    console.error('Capture failed:', err);
  } finally {
    $btnCapture.disabled = false;
    resetButton($btnCapture, '📸', t('fullCapture'));
  }
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
  loadPageInfo();
});

// === 초기화: 저장된 설정 복원 ===
(async () => {
  const stored = await chrome.storage.local.get(['sf_theme', 'sf_lang']);
  if (stored['sf_theme']) applyTheme(stored['sf_theme'] as ThemeMode);
  if (stored['sf_lang']) applyLang(stored['sf_lang'] as string);
  loadPageInfo();
})();
