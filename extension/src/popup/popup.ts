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
  span.appendChild(document.createTextNode('개'));
  return span;
}

// 결과 표시
function showResult(result: ScrapeResult): void {
  lastResult = result;
  $resultPreview.classList.remove('hidden');
  $resultCount.textContent = `${result.rows.length}행 × ${result.columns.length}열 추출됨`;
  $emptyState.classList.add('hidden');
  $aiHint.textContent = '';
}

// 현재 탭 정보
async function loadPageInfo(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;

  $pageTitle.textContent = tab.title ?? '알 수 없는 페이지';
  $pageUrl.textContent = tab.url;

  try {
    const response = await chrome.tabs.sendMessage<Message, PageInfo>(tab.id, {
      type: MessageType.GET_PAGE_INFO,
    });
    if (response) updatePageStats(response);
  } catch {
    $pageStats.textContent = '페이지 분석 대기 중...';
  }
}

function updatePageStats(info: PageInfo): void {
  $pageStats.textContent = '';
  if (info.tableCount > 0) $pageStats.appendChild(createStatElement('테이블', info.tableCount));
  if (info.listCount > 0) $pageStats.appendChild(createStatElement('리스트', info.listCount));
  if (!info.hasStructuredData) $pageStats.textContent = '구조화된 데이터 없음';
}

// AI 추출 (원클릭 자동)
$btnScrape.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  $btnScrape.disabled = true;
  $btnScrape.textContent = '✨ AI 분석 중...';
  $aiHint.textContent = '페이지를 분석하고 있습니다...';

  try {
    // 1단계: 먼저 일반 스크래핑 시도 (빠름)
    let result: ScrapeResult | null = null;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.SCRAPE_START,
      });
    } catch { /* Content Script 미주입 */ }

    // 2단계: 일반 스크래핑 결과가 부족하면 AI 시도
    const hasGoodData = result?.rows && result.rows.length >= 3;

    if (!hasGoodData) {
      const apiKey = await getApiKey();
      if (apiKey) {
        $aiHint.textContent = 'AI가 데이터 구조를 추론하고 있습니다...';
        try {
          const aiResult = await chrome.runtime.sendMessage({
            type: MessageType.SCRAPE_START,
            payload: { tabId: tab.id, aiPrompt: 'Extract all structured data from this page. Identify the main repeating content items and extract all available fields.' },
          });
          if (aiResult?.rows?.length > 0) {
            result = aiResult;
          }
        } catch (aiErr) {
          console.warn('AI 추출 실패, 기본 결과 사용:', aiErr);
        }
      }
    }

    // 결과 표시
    if (result?.rows?.length > 0) {
      showResult(result);
      await chrome.runtime.sendMessage({
        type: MessageType.SCRAPE_RESULT,
        payload: result,
      });
    } else {
      $emptyState.classList.remove('hidden');
      $aiHint.textContent = '추출할 데이터를 찾지 못했습니다';
    }
  } catch (err) {
    console.error('추출 실패:', err);
    $aiHint.textContent = '추출에 실패했습니다';
  } finally {
    $btnScrape.disabled = false;
    resetButton($btnScrape, '✨', 'AI 추출');
  }
});

// 풀 페이지 캡처
$btnCapture.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  $btnCapture.disabled = true;
  $btnCapture.textContent = '캡처 중...';
  $aiHint.textContent = '전체 페이지를 캡처하고 있습니다...';

  try {
    await chrome.runtime.sendMessage({
      type: MessageType.CAPTURE_FULL_PAGE,
      payload: { tabId: tab.id, format: 'png', fullPage: true },
    });
    $aiHint.textContent = '캡처 완료! 다운로드를 확인하세요.';
  } catch (err) {
    console.error('캡처 실패:', err);
    $aiHint.textContent = '캡처에 실패했습니다';
  } finally {
    $btnCapture.disabled = false;
    resetButton($btnCapture, '📸', '풀 페이지 캡처');
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
    const key = await getApiKey();
    if (key) {
      $apiKeyInput.value = key;
      $keyStatus.textContent = 'API 키가 설정되어 있습니다';
    }
  }
});

$btnSaveKey.addEventListener('click', async () => {
  const key = $apiKeyInput.value.trim();
  if (!key) { $keyStatus.textContent = 'API 키를 입력해주세요'; return; }
  const { setApiKey } = await import('../lib/ai');
  await setApiKey(key);
  $keyStatus.textContent = '저장되었습니다';
  setTimeout(() => $settingsPanel.classList.add('hidden'), 1000);
});

loadPageInfo();
