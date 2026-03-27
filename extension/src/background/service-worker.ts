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
  await chrome.debugger.attach({ tabId }, '1.3');

  try {
    // 1. 먼저 페이지 끝까지 스크롤하여 lazy-load 이미지를 모두 로드
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return new Promise<void>((resolve) => {
          const totalHeight = document.body.scrollHeight;
          const viewportHeight = window.innerHeight;
          const positions: number[] = [];
          for (let y = 0; y < totalHeight; y += viewportHeight) {
            positions.push(y);
          }
          let index = 0;
          function scrollNext() {
            if (index < positions.length) {
              window.scrollTo(0, positions[index]);
              index++;
              setTimeout(scrollNext, 200);
            } else {
              window.scrollTo(0, 0);
              setTimeout(resolve, 300);
            }
          }
          scrollNext();
        });
      },
    });

    // 2. 페이지 전체 크기 가져오기
    const layoutResult = await chrome.debugger.sendCommand(
      { tabId },
      'Page.getLayoutMetrics'
    ) as {
      contentSize: { width: number; height: number };
      cssContentSize: { width: number; height: number };
    };

    // cssContentSize가 있으면 사용 (더 정확함)
    const contentSize = layoutResult.cssContentSize ?? layoutResult.contentSize;
    const width = Math.ceil(contentSize.width);
    const height = Math.ceil(Math.min(contentSize.height, 16384)); // 안전한 최대값

    console.log(`[ScrapeFlow] 풀 페이지 캡처: ${width}x${height}`);

    // 3. 뷰포트를 전체 페이지 크기로 확장
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 렌더링 안정화 대기
    await new Promise(r => setTimeout(r, 500));

    // 4. 전체 페이지 캡처
    const screenshotResult = await chrome.debugger.sendCommand(
      { tabId },
      'Page.captureScreenshot',
      {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      }
    ) as { data: string };

    // 5. 뷰포트 복원
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride');

    // 6. 다운로드
    const dataUrl = `data:image/png;base64,${screenshotResult.data}`;
    await chrome.downloads.download({
      url: dataUrl,
      filename: `scrapeflow-fullpage-${Date.now()}.png`,
      saveAs: true,
    });
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

// 스크롤 스티칭 폴백 — CDP 사용 불가 시 실제 스크롤하며 캡처 후 합성
async function captureWithScrollStitching(tabId: number): Promise<void> {
  // Content Script로 페이지 정보 수집 + 스크롤 준비
  const [pageInfo] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // fixed/sticky 요소 숨기기 (중복 방지)
      const fixedEls: { el: HTMLElement; original: string }[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const style = getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          const htmlEl = el as HTMLElement;
          fixedEls.push({ el: htmlEl, original: htmlEl.style.visibility });
        }
      });

      return {
        totalHeight: Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        ),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        fixedCount: fixedEls.length,
      };
    },
  });

  const info = pageInfo?.result as {
    totalHeight: number;
    viewportHeight: number;
    viewportWidth: number;
    fixedCount: number;
  };

  if (!info) throw new Error('페이지 정보를 가져올 수 없습니다');

  const { totalHeight, viewportHeight } = info;
  const numCaptures = Math.ceil(totalHeight / viewportHeight);
  const captures: string[] = [];

  console.log(`[ScrapeFlow] 스티칭 캡처: ${totalHeight}px, ${numCaptures}개 구간`);

  // 첫 캡처는 fixed 요소 포함
  for (let i = 0; i < numCaptures; i++) {
    const scrollY = i * viewportHeight;

    // 스크롤 이동
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (y: number, isFirst: boolean) => {
        window.scrollTo(0, y);

        // 첫 캡처 이후 fixed/sticky 요소 숨기기
        if (!isFirst) {
          document.querySelectorAll('*').forEach((el) => {
            const style = getComputedStyle(el);
            if (style.position === 'fixed' || style.position === 'sticky') {
              (el as HTMLElement).style.visibility = 'hidden';
            }
          });
        }
      },
      args: [scrollY, i === 0],
    });

    // 렌더링 대기 (lazy-load 포함)
    await new Promise(r => setTimeout(r, 300));

    // 현재 화면 캡처
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, {
      format: 'png',
      quality: 100,
    });
    captures.push(dataUrl);
  }

  // fixed/sticky 요소 복원
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.querySelectorAll('*').forEach((el) => {
        const style = getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          (el as HTMLElement).style.visibility = '';
        }
      });
      window.scrollTo(0, 0);
    },
  });

  // Content Script의 Canvas로 스티칭 합성
  const [stitchResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (captureDataUrls: string[], totalH: number, vpHeight: number, vpWidth: number) => {
      return new Promise<string | null>((resolveAll) => {
        const dpr = window.devicePixelRatio;
        const canvas = document.createElement('canvas');
        canvas.width = vpWidth * dpr;
        canvas.height = totalH * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolveAll(null); return; }

        let loaded = 0;
        const images: HTMLImageElement[] = [];

        // 모든 이미지를 먼저 로드
        captureDataUrls.forEach((dataUrl, idx) => {
          const img = new Image();
          img.onload = () => {
            images[idx] = img;
            loaded++;
            if (loaded === captureDataUrls.length) {
              // 전부 로드 후 Canvas에 그리기
              for (let i = 0; i < images.length; i++) {
                const drawY = i * vpHeight * dpr;
                const remainH = (totalH * dpr) - drawY;
                const drawH = Math.min(images[i].height, remainH);
                const srcY = images[i].height - drawH;

                if (i === images.length - 1 && images.length > 1) {
                  ctx.drawImage(images[i], 0, srcY, images[i].width, drawH, 0, drawY, images[i].width, drawH);
                } else {
                  ctx.drawImage(images[i], 0, drawY);
                }
              }
              resolveAll(canvas.toDataURL('image/png'));
            }
          };
          img.onerror = () => { resolveAll(null); };
          img.src = dataUrl;
        });
      });
    },
    args: [captures, totalHeight, viewportHeight, info.viewportWidth],
  });

  const stitchedDataUrl = stitchResult?.result as string | null;
  if (!stitchedDataUrl) throw new Error('스티칭 실패');

  await chrome.downloads.download({
    url: stitchedDataUrl,
    filename: `scrapeflow-fullpage-${Date.now()}.png`,
    saveAs: true,
  });
}

// Side Panel 설정
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
