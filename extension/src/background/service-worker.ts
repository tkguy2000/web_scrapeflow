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
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, {
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
      const els = document.querySelectorAll('[data-sf-hidden]');
      els.forEach((el) => {
        (el as HTMLElement).style.visibility = (el as HTMLElement).dataset['sfHidden'] || '';
        delete (el as HTMLElement).dataset['sfHidden'];
      });
      window.scrollTo(0, originalScroll);
    },
    args: [size.currentScroll],
  });

  // 5. Canvas로 합성 — Content Script에서 실행
  if (captures.length === 1) {
    // 한 장이면 합성 불필요
    await chrome.downloads.download({
      url: captures[0],
      filename: `scrapeflow-fullpage-${Date.now()}.png`,
      saveAs: true,
    });
    return;
  }

  const [stitchResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (
      dataUrls: string[],
      pageHeight: number,
      vpHeight: number,
      dpr: number
    ) => {
      return new Promise<string | null>((done) => {
        const canvasW = 0; // 첫 이미지에서 결정
        const canvasH = Math.ceil(pageHeight * dpr);
        let loaded = 0;
        const imgs: HTMLImageElement[] = [];

        dataUrls.forEach((url, idx) => {
          const img = new Image();
          img.onload = () => {
            imgs[idx] = img;
            loaded++;
            if (loaded < dataUrls.length) return;

            // 전부 로드됨 — Canvas 생성
            const w = imgs[0].width;
            const h = canvasH;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { done(null); return; }

            for (let i = 0; i < imgs.length; i++) {
              const drawY = Math.round(i * vpHeight * dpr);

              if (i === imgs.length - 1 && imgs.length > 1) {
                // 마지막 조각: 남은 높이만큼만 아래쪽에서 잘라서 그림
                const remaining = h - drawY;
                if (remaining > 0 && remaining < imgs[i].height) {
                  const srcY = imgs[i].height - remaining;
                  ctx.drawImage(imgs[i], 0, srcY, w, remaining, 0, drawY, w, remaining);
                } else {
                  ctx.drawImage(imgs[i], 0, drawY);
                }
              } else {
                ctx.drawImage(imgs[i], 0, drawY);
              }
            }

            done(canvas.toDataURL('image/png'));
          };
          img.onerror = () => done(null);
          img.src = url;
        });
      });
    },
    args: [captures, scrollHeight, viewportHeight, devicePixelRatio],
  });

  const finalDataUrl = stitchResult?.result as string | null;
  if (!finalDataUrl) throw new Error('이미지 합성에 실패했습니다');

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
