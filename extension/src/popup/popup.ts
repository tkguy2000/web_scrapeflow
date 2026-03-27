import { MessageType } from '../lib/types';
import type { PageInfo, ScrapeResult, ExportFormat, Message } from '../lib/types';
import { downloadData } from '../lib/export';
import { getApiKey } from '../lib/ai';

const $pageTitle = document.getElementById('page-title')!;
const $pageUrl = document.getElementById('page-url')!;
const $pageStats = document.getElementById('page-stats')!;
const $btnScrape = document.getElementById('btn-scrape') as HTMLButtonElement;
const $btnCapture = document.getElementById('btn-capture') as HTMLButtonElement;
const $btnOpenPanel = document.getElementById('btn-open-panel')!;
const $emptyState = document.getElementById('empty-state')!;
const $resultPreview = document.getElementById('result-preview')!;
const $resultCount = document.getElementById('result-count')!;
const $aiSection = document.getElementById('ai-section')!;
const $aiPrompt = document.getElementById('ai-prompt') as HTMLInputElement;
const $btnAiScrape = document.getElementById('btn-ai-scrape') as HTMLButtonElement;
const $aiHint = document.getElementById('ai-hint')!;

let lastResult: ScrapeResult | null = null;

// 버튼 콘텐츠 복원 헬퍼
function resetButton(btn: HTMLButtonElement, icon: string, label: string): void {
  btn.textContent = '';
  const span = document.createElement('span');
  span.className = 'btn-icon';
  span.textContent = icon;
  btn.appendChild(span);
  btn.appendChild(document.createTextNode(` ${label}`));
}

// 안전한 통계 요소 생성
function createStatElement(label: string, count: number): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'stat';
  span.textContent = `${label} `;
  const countSpan = document.createElement('span');
  countSpan.className = 'stat-count';
  countSpan.textContent = String(count);
  span.appendChild(countSpan);
  span.appendChild(document.createTextNode('개'));
  return span;
}

// 결과 표시
function showResult(result: ScrapeResult): void {
  lastResult = result;
  $resultPreview.classList.remove('hidden');
  $resultCount.textContent = `${result.rows.length}행 × ${result.columns.length}열 추출됨`;
  $emptyState.classList.add('hidden');
}

// 현재 탭 정보 가져오기
async function loadPageInfo(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;

  $pageTitle.textContent = tab.title ?? '알 수 없는 페이지';
  $pageUrl.textContent = tab.url;

  // API 키 확인 — 있으면 AI 섹션 표시
  const apiKey = await getApiKey();
  if (apiKey) {
    $aiSection.classList.remove('hidden');
  }

  // Content Script에 페이지 분석 요청
  try {
    const response = await chrome.tabs.sendMessage<Message, PageInfo>(tab.id, {
      type: MessageType.GET_PAGE_INFO,
    });
    if (response) {
      updatePageStats(response);
    }
  } catch {
    $pageStats.textContent = '페이지 분석 대기 중...';
    $btnScrape.disabled = true;
    // API 키가 있으면 AI로도 추출 가능하므로 AI 버튼은 활성 유지
  }
}

// 페이지 통계 표시
function updatePageStats(info: PageInfo): void {
  $pageStats.textContent = '';
  let hasData = false;

  if (info.tableCount > 0) {
    $pageStats.appendChild(createStatElement('테이블', info.tableCount));
    hasData = true;
  }
  if (info.listCount > 0) {
    $pageStats.appendChild(createStatElement('리스트', info.listCount));
    hasData = true;
  }

  if (hasData) {
    $btnScrape.disabled = false;
    $emptyState.classList.add('hidden');
  } else {
    $pageStats.textContent = '구조화된 데이터 없음';
    $btnScrape.disabled = true;
    // AI가 있으면 빈 상태를 보여주되 AI 안내 추가
    $emptyState.classList.remove('hidden');
    const apiKeyExists = $aiSection.classList.contains('hidden') === false;
    if (apiKeyExists) {
      const emptyDesc = $emptyState.querySelector('.empty-desc');
      if (emptyDesc) emptyDesc.textContent = 'AI를 사용해서 원하는 데이터를 직접 추출해보세요';
    }
  }
}

// 데이터 추출 시작
$btnScrape.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  $btnScrape.disabled = true;
  $btnScrape.textContent = '추출 중...';

  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.SCRAPE_START,
    });

    if (result?.rows?.length > 0) {
      showResult(result);
      await chrome.runtime.sendMessage({
        type: MessageType.SCRAPE_RESULT,
        payload: result,
      });
    } else {
      $emptyState.classList.remove('hidden');
    }
  } catch (err) {
    console.error('스크래핑 실패:', err);
    $emptyState.classList.remove('hidden');
    const emptyTitle = $emptyState.querySelector('.empty-title');
    if (emptyTitle) emptyTitle.textContent = '스크래핑에 실패했습니다';
  } finally {
    $btnScrape.disabled = false;
    resetButton($btnScrape, '📊', '데이터 추출');
  }
});

// AI 추출
$btnAiScrape.addEventListener('click', async () => {
  const prompt = $aiPrompt.value.trim();
  if (!prompt) {
    $aiHint.textContent = '추출할 데이터를 설명해주세요';
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  $btnAiScrape.disabled = true;
  $btnAiScrape.textContent = '분석 중...';
  $aiHint.textContent = 'AI가 페이지를 분석하고 있습니다...';

  try {
    // Background SW에 AI 스크래핑 요청
    const result = await chrome.runtime.sendMessage({
      type: MessageType.SCRAPE_START,
      payload: { tabId: tab.id, aiPrompt: prompt },
    });

    if (result?.rows?.length > 0) {
      showResult(result);
      $aiHint.textContent = `AI가 ${result.columns.length}개 컬럼을 추론했습니다`;
      await chrome.runtime.sendMessage({
        type: MessageType.SCRAPE_RESULT,
        payload: result,
      });
    } else {
      $aiHint.textContent = 'AI가 데이터를 찾지 못했습니다. 다른 설명을 시도해보세요.';
    }
  } catch (err) {
    console.error('AI 스크래핑 실패:', err);
    $aiHint.textContent = String(err).includes('API_KEY_NOT_SET')
      ? '설정에서 Claude API 키를 입력해주세요'
      : 'AI 추출에 실패했습니다';
  } finally {
    $btnAiScrape.disabled = false;
    $btnAiScrape.textContent = 'AI 추출';
  }
});

// AI 입력 엔터키
$aiPrompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $btnAiScrape.click();
});

// 풀 페이지 캡처
$btnCapture.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  $btnCapture.disabled = true;
  $btnCapture.textContent = '캡처 중...';

  try {
    await chrome.runtime.sendMessage({
      type: MessageType.CAPTURE_FULL_PAGE,
      payload: { tabId: tab.id, format: 'png', fullPage: true },
    });
  } catch (err) {
    console.error('캡처 실패:', err);
  } finally {
    $btnCapture.disabled = false;
    resetButton($btnCapture, '📸', '풀 페이지 캡처');
  }
});

// 빠른 내보내기 버튼들
document.querySelectorAll('.btn-export-sm').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!lastResult) return;
    const format = (btn as HTMLElement).dataset['format'] as ExportFormat;
    downloadData(lastResult, format);
  });
});

// Side Panel 열기
$btnOpenPanel.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});

// 설정 패널 토글
const $btnSettings = document.getElementById('btn-settings')!;
const $settingsPanel = document.getElementById('settings-panel')!;
const $apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const $btnSaveKey = document.getElementById('btn-save-key') as HTMLButtonElement;
const $keyStatus = document.getElementById('key-status')!;

$btnSettings.addEventListener('click', async () => {
  $settingsPanel.classList.toggle('hidden');
  if (!$settingsPanel.classList.contains('hidden')) {
    const key = await getApiKey();
    if (key) {
      $apiKeyInput.value = key;
      $keyStatus.textContent = 'API 키가 설정되어 있습니다';
    }
  }
});

$btnSaveKey.addEventListener('click', async () => {
  const key = $apiKeyInput.value.trim();
  if (!key) {
    $keyStatus.textContent = 'API 키를 입력해주세요';
    return;
  }

  const { setApiKey } = await import('../lib/ai');
  await setApiKey(key);
  $keyStatus.textContent = '저장되었습니다';
  $aiSection.classList.remove('hidden');
  setTimeout(() => $settingsPanel.classList.add('hidden'), 1000);
});

// 초기화
loadPageInfo();
