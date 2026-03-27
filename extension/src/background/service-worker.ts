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
}): Promise<{ ok: boolean }> {
  const { tabId } = opts;

  // 스크롤 스티칭 방식 사용 — 가장 안정적
  // CDP는 debugger 팝업이 뜨고 일부 페이지에서 동작하지 않음
  await captureFullPageByStitching(tabId);
  return { ok: true };
}

// 풀 페이지 캡처 — 스크롤하면서 한 장씩 찍고 Canvas로 합침
async function captureFullPageByStitching(tabId: number): Promise<void> {
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
      viewportWidth: document.documentElement.clientWidth,
      currentScroll: window.scrollY,
      devicePixelRatio: window.devicePixelRatio,
    }),
  });

  const size = sizeResult?.result as {
    scrollHeight: number;
    viewportHeight: number;
    viewportWidth: number;
    currentScroll: number;
    devicePixelRatio: number;
  };

  if (!size) throw new Error('페이지 크기를 가져올 수 없습니다');

  const { scrollHeight, viewportHeight, devicePixelRatio } = size;
  const numCaptures = Math.ceil(scrollHeight / viewportHeight);

  console.log(`[ScrapeFlow] 풀 페이지 캡처 시작: ${scrollHeight}px 높이, ${numCaptures}장 캡처 필요`);

  // 2. 스크롤 전 페이지 맨 위로 이동
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { window.scrollTo(0, 0); },
  });
  await wait(300);

  // 3. 각 구간별로 스크롤 → 캡처
  const captures: string[] = [];

  for (let i = 0; i < numCaptures; i++) {
    const scrollY = i * viewportHeight;

    // 스크롤 이동
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (targetY: number, hideFixed: boolean) => {
        window.scrollTo(0, targetY);

        // 두 번째 캡처부터 fixed/sticky 헤더 등을 숨겨서 중복 방지
        if (hideFixed) {
          const els = document.querySelectorAll('header, nav, [class*="header"], [class*="nav"], [class*="toolbar"], [class*="sticky"], [class*="fixed"]');
          els.forEach((el) => {
            const s = getComputedStyle(el);
            if (s.position === 'fixed' || s.position === 'sticky') {
              (el as HTMLElement).dataset['sfHidden'] = (el as HTMLElement).style.visibility;
              (el as HTMLElement).style.visibility = 'hidden';
            }
          });
        }
      },
      args: [scrollY, i > 0],
    });

    // 렌더링 + lazy-load 대기
    await wait(400);

    // 현재 보이는 화면 캡처
    const dataUrl = await chrome.tabs.captureVisibleTab({
      format: 'png',
      quality: 100,
    });
    captures.push(dataUrl);

    console.log(`[ScrapeFlow] 캡처 ${i + 1}/${numCaptures} 완료 (scrollY=${scrollY})`);
  }

  // 4. fixed/sticky 요소 복원 + 원래 스크롤 위치로
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (originalScroll: number) => {
      document.querySelectorAll('[data-sf-hidden]').forEach((el) => {
        (el as HTMLElement).style.visibility = (el as HTMLElement).dataset['sfHidden'] || '';
        delete (el as HTMLElement).dataset['sfHidden'];
      });
      window.scrollTo(0, originalScroll);
    },
    args: [size.currentScroll],
  });

  // 5. Service Worker에서 직접 OffscreenCanvas로 합성
  //    (executeScript의 Promise return은 MV3에서 {} 로 직렬화되므로 사용 불가)
  if (captures.length === 1) {
    await chrome.downloads.download({
      url: captures[0],
      filename: `scrapeflow-fullpage-${Date.now()}.png`,
      saveAs: true,
    });
    return;
  }

  console.log(`[ScrapeFlow] ${captures.length}장 합성 시작 (OffscreenCanvas)`);

  // data URL → ImageBitmap 변환
  const bitmaps: ImageBitmap[] = [];
  for (const dataUrl of captures) {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    bitmaps.push(bitmap);
  }

  // 첫 이미지 크기 기준으로 Canvas 생성
  const imgWidth = bitmaps[0].width;
  const dpr = devicePixelRatio;
  const totalCanvasHeight = Math.ceil(scrollHeight * dpr);

  const canvas = new OffscreenCanvas(imgWidth, totalCanvasHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context 생성 실패');

  for (let i = 0; i < bitmaps.length; i++) {
    const drawY = Math.round(i * viewportHeight * dpr);

    if (i === bitmaps.length - 1 && bitmaps.length > 1) {
      // 마지막 조각: 남은 높이만큼만 아래쪽에서 잘라 그림
      const remaining = totalCanvasHeight - drawY;
      if (remaining > 0 && remaining < bitmaps[i].height) {
        const srcY = bitmaps[i].height - remaining;
        ctx.drawImage(bitmaps[i], 0, srcY, imgWidth, remaining, 0, drawY, imgWidth, remaining);
      } else {
        ctx.drawImage(bitmaps[i], 0, drawY);
      }
    } else {
      ctx.drawImage(bitmaps[i], 0, drawY);
    }
  }

  // ImageBitmap 정리
  bitmaps.forEach((b) => b.close());

  // Blob → base64 data URL → 다운로드
  // (Service Worker에서 URL.createObjectURL의 blob: URL은 downloads API에서 접근 불가)
  const resultBlob = await canvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await resultBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const finalDataUrl = `data:image/png;base64,${btoa(binary)}`;

  console.log(`[ScrapeFlow] 합성 완료: ${imgWidth}x${totalCanvasHeight}px, ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`);

  await chrome.downloads.download({
    url: finalDataUrl,
    filename: `scrapeflow-fullpage-${Date.now()}.png`,
    saveAs: true,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Side Panel 설정
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
