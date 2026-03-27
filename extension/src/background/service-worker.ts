import { MessageType } from '../lib/types';
import type { Message, ScrapeResult } from '../lib/types';
import { saveResult } from '../lib/storage';
import { inferDataStructure } from '../lib/ai';

// 메시지 라우팅
chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse: (response?: unknown) => void) => {
    handleMessage(message).then(sendResponse).catch((err) => {
      console.error('[ScrapeFlow SW] Error:', err);
      sendResponse({ error: String(err) });
    });
    return true; // 비동기 응답
  }
);

async function handleMessage(message: Message): Promise<unknown> {
  switch (message.type) {
    case MessageType.SCRAPE_RESULT:
      return handleScrapeResult(message.payload as ScrapeResult);

    case MessageType.SCRAPE_START:
      return handleAiScrape(message.payload as { tabId: number; aiPrompt: string });

    case MessageType.CAPTURE_FULL_PAGE:
      return handleCapture(message.payload as { tabId: number; format: string; fullPage: boolean });

    case MessageType.OPEN_SIDE_PANEL:
      return { ok: true };

    default:
      return { error: `알 수 없는 메시지 타입: ${message.type}` };
  }
}

// 스크래핑 결과 저장
async function handleScrapeResult(result: ScrapeResult): Promise<{ ok: boolean }> {
  await saveResult(result);
  return { ok: true };
}

// AI 스크래핑 — Claude API로 데이터 구조 추론 후 Content Script에서 추출
async function handleAiScrape(opts: {
  tabId: number;
  aiPrompt: string;
}): Promise<ScrapeResult> {
  const { tabId, aiPrompt } = opts;

  // 페이지 HTML 가져오기
  const [htmlResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.documentElement.outerHTML,
  });
  const pageHtml = htmlResult?.result as string ?? '';

  // 페이지 URL 가져오기
  const tab = await chrome.tabs.get(tabId);
  const pageUrl = tab.url ?? '';

  // AI로 데이터 구조 추론
  const aiResult = await inferDataStructure(aiPrompt, pageHtml, pageUrl);

  // Content Script에서 AI 결과로 데이터 추출
  const [extractResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (containerSel: string, itemSel: string, columns: Array<{ name: string; selector: string; type: string }>) => {
      const container = document.querySelector(containerSel);
      if (!container) return { columns: columns.map(c => c.name), rows: [] };

      const items = container.querySelectorAll(itemSel);
      const colNames = columns.map(c => c.name);
      const rows: Record<string, string>[] = [];

      items.forEach(item => {
        const row: Record<string, string> = {};
        for (const col of columns) {
          const el = item.querySelector(col.selector);
          if (!el) { row[col.name] = ''; continue; }
          if (col.type === 'link') row[col.name] = (el as HTMLAnchorElement).href ?? '';
          else if (col.type === 'image') row[col.name] = (el as HTMLImageElement).src ?? '';
          else row[col.name] = (el.textContent ?? '').trim();
        }
        rows.push(row);
      });

      return { columns: colNames, rows };
    },
    args: [aiResult.containerSelector, aiResult.itemSelector, aiResult.columns],
  });

  const extracted = extractResult?.result as { columns: string[]; rows: Record<string, string>[] } | undefined;

  const result: ScrapeResult = {
    columns: extracted?.columns ?? [],
    rows: extracted?.rows ?? [],
    url: pageUrl,
    title: tab.title ?? '',
    timestamp: Date.now(),
  };

  if (result.rows.length > 0) {
    await saveResult(result);
  }

  return result;
}

// 풀 페이지 캡처 (CDP 우선, 스크롤 스티칭 폴백)
async function handleCapture(opts: {
  tabId: number;
  format: string;
  fullPage: boolean;
}): Promise<{ ok: boolean }> {
  const { tabId } = opts;

  try {
    // CDP 방식 시도
    await captureWithCDP(tabId);
    return { ok: true };
  } catch (cdpErr) {
    console.warn('[ScrapeFlow] CDP 캡처 실패, 스크롤 스티칭 폴백:', cdpErr);
    try {
      await captureWithScrollStitching(tabId);
      return { ok: true };
    } catch (fallbackErr) {
      console.error('[ScrapeFlow] 폴백 캡처도 실패:', fallbackErr);
      throw fallbackErr;
    }
  }
}

// CDP 풀 페이지 캡처
async function captureWithCDP(tabId: number): Promise<void> {
  // 디버거 연결
  await chrome.debugger.attach({ tabId }, '1.3');

  try {
    // 페이지 전체 크기 가져오기
    const layoutResult = await chrome.debugger.sendCommand(
      { tabId },
      'Page.getLayoutMetrics'
    ) as {
      contentSize: { width: number; height: number };
    };

    const { width, height } = layoutResult.contentSize;
    // Chrome Canvas 최대 크기 제한
    const cappedHeight = Math.min(height, 32767);

    // 뷰포트를 전체 페이지 크기로 설정
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
      width: Math.ceil(width),
      height: Math.ceil(cappedHeight),
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 스크린샷 캡처
    const screenshotResult = await chrome.debugger.sendCommand(
      { tabId },
      'Page.captureScreenshot',
      {
        format: 'png',
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width,
          height: cappedHeight,
          scale: 1,
        },
      }
    ) as { data: string };

    // 뷰포트 복원
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride');

    // Base64 → Blob → 다운로드
    const dataUrl = `data:image/png;base64,${screenshotResult.data}`;
    await chrome.downloads.download({
      url: dataUrl,
      filename: `scrapeflow-capture-${Date.now()}.png`,
      saveAs: true,
    });
  } finally {
    // 디버거 항상 해제
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

// 스크롤 스티칭 폴백 캡처
async function captureWithScrollStitching(tabId: number): Promise<void> {
  // 간단한 visible tab 캡처 (폴백)
  const dataUrl = await chrome.tabs.captureVisibleTab(undefined, {
    format: 'png',
    quality: 100,
  });

  await chrome.downloads.download({
    url: dataUrl,
    filename: `scrapeflow-capture-${Date.now()}.png`,
    saveAs: true,
  });
}

// Side Panel 설정
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
