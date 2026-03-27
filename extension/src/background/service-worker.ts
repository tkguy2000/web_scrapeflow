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

// 풀 페이지 캡처
async function handleCapture(opts: {
  tabId: number;
  format: string;
  fullPage: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const { tabId } = opts;

  try {
    await captureFullPageByStitching(tabId);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ScrapeFlow] 캡처 에러:', msg, err);
    return { ok: false, error: msg };
  }
}

// 풀 페이지 캡처 — 스크롤하면서 한 장씩 찍고 OffscreenCanvas로 합침
async function captureFullPageByStitching(tabId: number): Promise<void> {
  console.log('[ScrapeFlow] Step 0: 탭 정보 가져오기');
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;
  console.log('[ScrapeFlow] windowId:', windowId, 'url:', tab.url);

  // 1. 페이지 전체 크기 측정
  const [sizeResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      scrollHeight: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight
      ),
      viewportHeight: window.innerHeight,
      currentScroll: window.scrollY,
      devicePixelRatio: window.devicePixelRatio,
    }),
  });

  const size = sizeResult?.result as {
    scrollHeight: number;
    viewportHeight: number;
    currentScroll: number;
    devicePixelRatio: number;
  } | undefined;

  console.log('[ScrapeFlow] Step 1 결과:', size);
  if (!size) throw new Error('페이지 크기를 가져올 수 없습니다');

  const { scrollHeight, viewportHeight, devicePixelRatio: dpr } = size;
  const numCaptures = Math.ceil(scrollHeight / viewportHeight);

  console.log(`[ScrapeFlow] 풀캡처: 높이${scrollHeight}px, ${numCaptures}장`);

  // 2. 맨 위로
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { window.scrollTo(0, 0); },
  });
  await sleep(300);

  // 3. 스크롤하며 캡처
  const captures: string[] = [];

  for (let i = 0; i < numCaptures; i++) {
    const scrollY = i * viewportHeight;

    // 스크롤 + fixed 요소 숨김
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (targetY: number, shouldHide: boolean) => {
        window.scrollTo(0, targetY);
        if (shouldHide) {
          document.querySelectorAll('*').forEach((el) => {
            const pos = getComputedStyle(el).position;
            if (pos === 'fixed' || pos === 'sticky') {
              const h = el as HTMLElement;
              h.dataset['sfV'] = h.style.visibility;
              h.style.visibility = 'hidden';
            }
          });
        }
      },
      args: [scrollY, i > 0],
    });

    await sleep(400);

    // captureVisibleTab — windowId를 명시적으로 전달
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    captures.push(dataUrl);
    console.log(`[ScrapeFlow] 캡처 ${i + 1}/${numCaptures}`);
  }

  // 4. 복원
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (origY: number) => {
      document.querySelectorAll('[data-sf-v]').forEach((el) => {
        const h = el as HTMLElement;
        h.style.visibility = h.dataset['sfV'] || '';
        delete h.dataset['sfV'];
      });
      window.scrollTo(0, origY);
    },
    args: [size.currentScroll],
  });

  // 5. 한 장이면 바로 다운로드
  if (captures.length === 1) {
    await chrome.downloads.download({
      url: captures[0],
      filename: `scrapeflow-fullpage-${Date.now()}.png`,
      saveAs: true,
    });
    return;
  }

  // 6. Service Worker에서 OffscreenCanvas로 합성
  console.log(`[ScrapeFlow] ${captures.length}장 합성 시작`);

  // data URL → Blob → ImageBitmap
  const bitmaps: ImageBitmap[] = [];
  for (const url of captures) {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);
    bitmaps.push(bmp);
  }

  const imgW = bitmaps[0].width;
  const imgH = bitmaps[0].height;
  const totalH = Math.ceil(scrollHeight * dpr);

  const canvas = new OffscreenCanvas(imgW, totalH);
  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < bitmaps.length; i++) {
    const y = Math.round(i * viewportHeight * dpr);

    if (i === bitmaps.length - 1 && bitmaps.length > 1) {
      // 마지막: 남은 높이만 아래쪽에서 잘라 그림
      const remain = totalH - y;
      if (remain > 0 && remain < imgH) {
        ctx.drawImage(bitmaps[i], 0, imgH - remain, imgW, remain, 0, y, imgW, remain);
      } else {
        ctx.drawImage(bitmaps[i], 0, y);
      }
    } else {
      ctx.drawImage(bitmaps[i], 0, y);
    }
  }
  bitmaps.forEach((b) => b.close());

  // 7. Blob → base64 → 다운로드
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const ab = await blob.arrayBuffer();
  const u8 = new Uint8Array(ab);

  // String.fromCharCode spread 대신 안전한 청크 루프
  const parts: string[] = [];
  for (let i = 0; i < u8.length; i += 1024) {
    const end = Math.min(i + 1024, u8.length);
    let s = '';
    for (let j = i; j < end; j++) {
      s += String.fromCharCode(u8[j]);
    }
    parts.push(s);
  }
  const base64 = btoa(parts.join(''));
  const finalUrl = `data:image/png;base64,${base64}`;

  console.log(`[ScrapeFlow] 합성 완료: ${imgW}x${totalH}px, ${(ab.byteLength / 1048576).toFixed(1)}MB`);

  await chrome.downloads.download({
    url: finalUrl,
    filename: `scrapeflow-fullpage-${Date.now()}.png`,
    saveAs: true,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Side Panel 설정
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
