import { MessageType } from '../lib/types';
import type { PageInfo, Message } from '../lib/types';

const $pageTitle = document.getElementById('page-title')!;
const $pageUrl = document.getElementById('page-url')!;
const $pageStats = document.getElementById('page-stats')!;
const $btnScrape = document.getElementById('btn-scrape') as HTMLButtonElement;
const $btnCapture = document.getElementById('btn-capture') as HTMLButtonElement;
const $btnOpenPanel = document.getElementById('btn-open-panel')!;
const $emptyState = document.getElementById('empty-state')!;
const $resultPreview = document.getElementById('result-preview')!;
const $resultCount = document.getElementById('result-count')!;

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

// 현재 탭 정보 가져오기
async function loadPageInfo(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;

  $pageTitle.textContent = tab.title ?? '알 수 없는 페이지';
  $pageUrl.textContent = tab.url;

  // Content Script에 페이지 분석 요청
  try {
    const response = await chrome.tabs.sendMessage<Message, PageInfo>(tab.id, {
      type: MessageType.GET_PAGE_INFO,
    });

    if (response) {
      updatePageStats(response);
    }
  } catch {
    // Content Script가 아직 주입되지 않은 경우
    $pageStats.textContent = '페이지 분석 대기 중...';
    $btnScrape.disabled = true;
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
    $emptyState.classList.remove('hidden');
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
      $resultPreview.classList.remove('hidden');
      $resultCount.textContent = `${result.rows.length}행 추출됨`;
      $emptyState.classList.add('hidden');

      // 결과를 storage에 저장
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
    $btnScrape.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'btn-icon';
    icon.textContent = '📊';
    $btnScrape.appendChild(icon);
    $btnScrape.appendChild(document.createTextNode(' 데이터 추출'));
  }
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
    $btnCapture.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'btn-icon';
    icon.textContent = '📸';
    $btnCapture.appendChild(icon);
    $btnCapture.appendChild(document.createTextNode(' 풀 페이지 캡처'));
  }
});

// Side Panel 열기
$btnOpenPanel.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) return;

  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});

// 초기화
loadPageInfo();
