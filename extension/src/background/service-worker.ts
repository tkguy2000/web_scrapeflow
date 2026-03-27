import { MessageType } from '../lib/types';
import type { Message, ScrapeResult } from '../lib/types';
import { saveResult } from '../lib/storage';

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

    case MessageType.CAPTURE_FULL_PAGE:
      return handleCapture(message.payload as { tabId: number; format: string; fullPage: boolean });

    case MessageType.OPEN_SIDE_PANEL:
      // Side Panel은 user gesture에서만 열 수 있으므로 popup에서 직접 처리
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
