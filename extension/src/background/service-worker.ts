import { MessageType } from '../lib/types';
import type { Message, ScrapeResult, DetectedPatternInfo } from '../lib/types';
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

    // 사이트 클론: 패턴 감지 + AI 추론
    case MessageType.CLONE_DETECT_PATTERNS:
      return handleCloneDetect(message.payload as { tabId: number });

    // 사이트 클론: DOM 기반 데이터 추출
    case MessageType.CLONE_EXTRACT_DATA:
      return handleCloneExtract(message.payload as {
        tabId: number;
        containerSelector: string;
        itemSelector: string;
        columns: { name: string; selector: string; type: string; attribute?: string }[];
      });

    default:
      return { error: `알 수 없는 메시지 타입: ${message.type}` };
  }
}

// 사이트 클론: 순수 DOM 기반 패턴 감지 + 자동 컬럼 추론 (AI 불필요)
async function handleCloneDetect(opts: { tabId: number }): Promise<{
  patterns: DetectedPatternInfo[];
  error?: string;
}> {
  const { tabId } = opts;

  // Content Script의 detectPatternsWithColumns 호출
  let patterns: DetectedPatternInfo[] = [];
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: MessageType.CLONE_DETECT_PATTERNS,
    });
    patterns = (response as { patterns: DetectedPatternInfo[] })?.patterns ?? [];
  } catch {
    // Content Script 미주입 시 executeScript로 직접 추출까지 수행
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 인라인 패턴 감지 + 컬럼 추론
        function computeSig(el: Element): string {
          return el.tagName + ':' + Array.from(el.children).map(c => c.tagName).sort().join(',');
        }

        function inferType(el: Element): { name: string; type: string; attribute?: string } {
          const tag = el.tagName.toLowerCase();
          if (tag === 'img') return { name: 'Image', type: 'image', attribute: 'src' };
          if (tag === 'a') return { name: 'Link', type: 'link', attribute: 'href' };
          if (/^h[1-6]$/.test(tag)) return { name: 'Title', type: 'text' };
          if (tag === 'time') return { name: 'Date', type: 'text', attribute: 'datetime' };
          if (tag === 'p') return { name: (el.textContent ?? '').length > 50 ? 'Description' : 'Text', type: 'text' };
          const cls = el.className?.toLowerCase() ?? '';
          if (cls.includes('title') || cls.includes('name')) return { name: 'Title', type: 'text' };
          if (cls.includes('desc')) return { name: 'Description', type: 'text' };
          if (cls.includes('price')) return { name: 'Price', type: 'number' };
          if (cls.includes('date')) return { name: 'Date', type: 'text' };
          if (cls.includes('author')) return { name: 'Author', type: 'text' };
          return { name: 'Text', type: 'text' };
        }

        const allElements = document.body.querySelectorAll<HTMLElement>('*');
        const found: Array<{
          containerSelector: string; itemCount: number; signature: string;
          score: number; sampleHtml: string;
          columns: Array<{ name: string; selector: string; type: string; attribute?: string }>;
        }> = [];

        for (const container of allElements) {
          const children = Array.from(container.children) as HTMLElement[];
          if (children.length < 3) continue;
          if (container.closest('nav, header, footer')) continue;

          const sigs = new Map<string, HTMLElement[]>();
          for (const child of children) {
            if (child.children.length < 1) continue;
            const sig = computeSig(child);
            if (!sigs.has(sig)) sigs.set(sig, []);
            sigs.get(sig)!.push(child);
          }

          for (const [sig, items] of sigs) {
            if (items.length < 3 || items.length / children.length < 0.7) continue;

            // 첫 아이템에서 컬럼 추론
            const firstItem = items[0];
            const columns: Array<{ name: string; selector: string; type: string; attribute?: string }> = [];
            const usedNames = new Set<string>();

            const walk = (el: Element) => {
              for (const child of Array.from(el.children)) {
                const info = inferType(child);
                let finalName = info.name;
                let c = 1;
                while (usedNames.has(finalName)) { c++; finalName = `${info.name} ${c}`; }
                usedNames.add(finalName);

                let sel = child.tagName.toLowerCase();
                const cls = Array.from(child.classList).filter(c2 => c2.length > 2).slice(0, 2);
                if (cls.length > 0) sel += '.' + cls.join('.');
                columns.push({ name: finalName, selector: sel, type: info.type, attribute: info.attribute });

                // 1단계 깊이까지만
                if (el === firstItem) {
                  for (const gc of Array.from(child.children)) {
                    const gcInfo = inferType(gc);
                    let gcName = gcInfo.name;
                    let gc2 = 1;
                    while (usedNames.has(gcName)) { gc2++; gcName = `${gcInfo.name} ${gc2}`; }
                    usedNames.add(gcName);
                    let gcSel = gc.tagName.toLowerCase();
                    const gcCls = Array.from(gc.classList).filter(c3 => c3.length > 2).slice(0, 2);
                    if (gcCls.length > 0) gcSel += '.' + gcCls.join('.');
                    columns.push({ name: gcName, selector: `${sel} > ${gcSel}`, type: gcInfo.type, attribute: gcInfo.attribute });
                  }
                }
              }
            };
            walk(firstItem);

            let contSel = container.tagName.toLowerCase();
            if (container.id) contSel = '#' + container.id;
            else if (container.className) {
              const cls = container.className.split(/\s+/).filter(c2 => c2.length > 2).slice(0, 2);
              if (cls.length > 0) contSel += '.' + cls.join('.');
            }

            found.push({
              containerSelector: contSel,
              itemCount: items.length,
              signature: sig,
              score: items.length * 2 + columns.length,
              sampleHtml: '',
              columns,
            });
            break;
          }
        }

        found.sort((a, b) => b.score - a.score);
        return { patterns: found.slice(0, 5) };
      },
    });
    patterns = (result?.result as { patterns: DetectedPatternInfo[] })?.patterns ?? [];
  }

  if (patterns.length === 0) {
    return { patterns: [], error: '반복 패턴을 찾을 수 없습니다' };
  }

  return { patterns };
}

// 사이트 클론: AI 셀렉터로 데이터 추출 — 다단계 폴백
async function handleCloneExtract(opts: {
  tabId: number;
  containerSelector: string;
  itemSelector: string;
  columns: { name: string; selector: string; type: string; attribute?: string }[];
}): Promise<ScrapeResult> {
  const { tabId, containerSelector, itemSelector, columns } = opts;

  // executeScript로 직접 추출 (가장 안정적)
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (contSel: string, itemSel: string, cols: Array<{ name: string; selector: string; type: string; attribute?: string }>) => {
      // 셀렉터에서 값 추출하는 헬퍼
      function extractValue(el: Element, col: { type: string; attribute?: string }): string {
        if (col.attribute) {
          let val = el.getAttribute(col.attribute) ?? '';
          if ((col.type === 'link' || col.type === 'image' || col.type === 'file') && val) {
            try { val = new URL(val, window.location.href).href; } catch { /* 원본 유지 */ }
          }
          return val;
        }
        if (col.type === 'link' || col.type === 'file') return (el as HTMLAnchorElement).href ?? '';
        if (col.type === 'image') return (el as HTMLImageElement).src || el.getAttribute('data-src') || '';
        return (el.textContent ?? '').trim();
      }

      // 아이템에서 컬럼별 데이터 추출
      function extractFromItems(items: NodeListOf<Element> | Element[]): Record<string, string>[] {
        const rows: Record<string, string>[] = [];
        const itemArr = Array.from(items);
        for (const item of itemArr) {
          const row: Record<string, string> = {};
          let hasData = false;
          for (const col of cols) {
            const el = item.querySelector(col.selector);
            if (!el) { row[col.name] = ''; continue; }
            row[col.name] = extractValue(el, col);
            if (row[col.name]) hasData = true;
          }
          if (hasData) rows.push(row);
        }
        return rows;
      }

      // === 전략 1: container + itemSelector 정확 매칭 ===
      let container = document.querySelector(contSel);
      if (container) {
        const items = container.querySelectorAll(itemSel);
        if (items.length > 0) {
          const rows = extractFromItems(items);
          if (rows.length > 0) {
            console.log('[ScrapeFlow Clone] 전략1 성공:', contSel, itemSel, rows.length + '행');
            return { columns: cols.map(c => c.name), rows, strategy: 'exact' };
          }
        }
      }

      // === 전략 2: itemSelector만으로 document 전체에서 검색 ===
      const globalItems = document.querySelectorAll(itemSel);
      if (globalItems.length > 0) {
        const rows = extractFromItems(globalItems);
        if (rows.length > 0) {
          console.log('[ScrapeFlow Clone] 전략2 성공: document > ' + itemSel, rows.length + '행');
          return { columns: cols.map(c => c.name), rows, strategy: 'global-item' };
        }
      }

      // === 전략 3: containerSelector 변형 시도 ===
      // AI가 너무 구체적인 셀렉터를 줄 경우 단순화
      const simplifiedContSel = contSel
        .replace(/:nth-of-type\(\d+\)/g, '')
        .replace(/:nth-child\(\d+\)/g, '')
        .split(' > ').slice(-2).join(' > ');
      if (simplifiedContSel !== contSel) {
        container = document.querySelector(simplifiedContSel);
        if (container) {
          const items = container.querySelectorAll(itemSel);
          if (items.length > 0) {
            const rows = extractFromItems(items);
            if (rows.length > 0) {
              console.log('[ScrapeFlow Clone] 전략3 성공:', simplifiedContSel, rows.length + '행');
              return { columns: cols.map(c => c.name), rows, strategy: 'simplified' };
            }
          }
        }
      }

      // === 전략 4: 첫 번째 컬럼 셀렉터로 아이템 역추적 ===
      // 컬럼 셀렉터가 매칭되는 요소의 부모를 아이템으로 간주
      const firstCol = cols[0];
      if (firstCol) {
        const colElements = document.querySelectorAll(firstCol.selector);
        if (colElements.length >= 2) {
          // 각 매칭 요소의 공통 부모 레벨을 찾기
          const parents = Array.from(colElements).map(el => el.parentElement).filter(Boolean) as Element[];
          // 부모가 같은 태그+클래스를 가지는지 확인
          if (parents.length >= 2) {
            const firstTag = parents[0].tagName;
            const matchingParents = parents.filter(p => p.tagName === firstTag);
            if (matchingParents.length >= 2) {
              const rows = extractFromItems(matchingParents);
              if (rows.length > 0) {
                console.log('[ScrapeFlow Clone] 전략4 성공: 컬럼 역추적,', rows.length + '행');
                return { columns: cols.map(c => c.name), rows, strategy: 'reverse-lookup' };
              }
            }
          }
        }
      }

      // === 전략 5: 가장 넓은 범위 — 모든 컬럼을 document에서 직접 추출 ===
      const directRows: Record<string, string>[] = [];
      const colArrays: Record<string, string[]> = {};
      let maxLen = 0;
      for (const col of cols) {
        const elements = document.querySelectorAll(col.selector);
        const values: string[] = [];
        elements.forEach(el => {
          values.push(extractValue(el, col));
        });
        colArrays[col.name] = values;
        if (values.length > maxLen) maxLen = values.length;
      }

      if (maxLen >= 2) {
        for (let i = 0; i < maxLen; i++) {
          const row: Record<string, string> = {};
          let hasData = false;
          for (const col of cols) {
            row[col.name] = colArrays[col.name]?.[i] ?? '';
            if (row[col.name]) hasData = true;
          }
          if (hasData) directRows.push(row);
        }
        if (directRows.length > 0) {
          console.log('[ScrapeFlow Clone] 전략5 성공: 직접 추출,', directRows.length + '행');
          return { columns: cols.map(c => c.name), rows: directRows, strategy: 'direct' };
        }
      }

      console.warn('[ScrapeFlow Clone] 모든 전략 실패. container:', contSel, 'item:', itemSel);
      return {
        columns: cols.map(c => c.name),
        rows: [] as Record<string, string>[],
        strategy: 'none',
        debug: {
          containerFound: !!document.querySelector(contSel),
          globalItemCount: document.querySelectorAll(itemSel).length,
          firstColCount: document.querySelectorAll(cols[0]?.selector ?? '').length,
        },
      };
    },
    args: [containerSelector, itemSelector, columns],
  });

  const extracted = result?.result as {
    columns: string[];
    rows: Record<string, string>[];
    strategy: string;
    debug?: { containerFound: boolean; globalItemCount: number; firstColCount: number };
  } | undefined;

  if (extracted?.debug) {
    console.log('[ScrapeFlow Clone] 디버그 정보:', extracted.debug);
  }

  const tab = await chrome.tabs.get(tabId);

  const scrapeResult: ScrapeResult = {
    columns: extracted?.columns ?? [],
    rows: extracted?.rows ?? [],
    url: tab.url ?? '',
    title: tab.title ?? '',
    timestamp: Date.now(),
  };

  if (scrapeResult.rows.length > 0) {
    await saveResult(scrapeResult);
  }

  return scrapeResult;
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
