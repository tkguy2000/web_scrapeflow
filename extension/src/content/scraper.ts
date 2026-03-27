import { MessageType } from '../lib/types';
import type { PageInfo, ScrapeResult, ScrapeRow, Message, DetectedPatternInfo } from '../lib/types';
import { detectRepeatedPatterns, detectPatternsSerializable, extractWithCloneSelectors } from './pattern-detector';

// === 감지 ===

// 테이블 감지
function detectTables(): HTMLTableElement[] {
  return Array.from(document.querySelectorAll('table')).filter((table) => {
    const rows = table.querySelectorAll('tr');
    // 레이아웃 테이블 제외: 최소 2행 + 2열
    if (rows.length < 2) return false;
    const firstRow = rows[0];
    const cells = firstRow.querySelectorAll('td, th');
    return cells.length >= 2;
  });
}

// 리스트 감지 (ul/ol)
function detectLists(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('ul, ol')).filter((list) => {
    const items = list.querySelectorAll(':scope > li');
    if (items.length < 3) return false;
    // 네비게이션 리스트 제외
    const parent = list.closest('nav, header, footer');
    return !parent;
  });
}

// 카드 반복 구조 감지 — 동일 클래스를 가진 반복 자식 요소
function detectCardGroups(): { container: HTMLElement; cards: HTMLElement[] }[] {
  const results: { container: HTMLElement; cards: HTMLElement[] }[] = [];
  const candidates = document.querySelectorAll<HTMLElement>(
    '[class*="grid"], [class*="list"], [class*="card"], [class*="item"], [class*="product"], [class*="result"]'
  );

  for (const container of candidates) {
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length < 3) continue;

    // 동일 태그+클래스 패턴인지 확인
    const firstTag = children[0].tagName;
    const firstClass = children[0].className;
    const matching = children.filter(
      (c) => c.tagName === firstTag && c.className === firstClass
    );

    if (matching.length >= 3 && matching.length / children.length > 0.7) {
      results.push({ container, cards: matching });
    }
  }

  return results;
}

// dl/dt/dd 감지
function detectDefinitionLists(): HTMLDListElement[] {
  return Array.from(document.querySelectorAll('dl')).filter((dl) => {
    return dl.querySelectorAll('dt').length >= 2;
  });
}

// === 추출 ===

// 셀 내부에서 텍스트 + 링크 + 이미지 추출
function extractCellContent(cell: Element): string {
  // 이미지가 있으면 src 추출
  const img = cell.querySelector('img');
  if (img && !cell.textContent?.trim()) {
    return img.getAttribute('src') ?? img.getAttribute('data-src') ?? '';
  }

  // 링크가 있으면 텍스트 (href는 별도 컬럼으로)
  const text = (cell.textContent ?? '').trim();
  return text;
}

// 셀 내부 링크 URL 추출
function extractCellLink(cell: Element): string | null {
  const link = cell.querySelector('a[href]');
  if (!link) return null;
  try {
    return new URL(link.getAttribute('href') ?? '', window.location.href).href;
  } catch {
    return link.getAttribute('href');
  }
}

// 테이블 데이터 추출
function extractTableData(table: HTMLTableElement): { columns: string[]; rows: ScrapeRow[] } {
  // 헤더 찾기: thead > tr > th 또는 첫 행의 th
  const thead = table.querySelector('thead');
  let headerCells: Element[];
  if (thead) {
    headerCells = Array.from(thead.querySelectorAll('th, td'));
  } else {
    const firstRow = table.querySelector('tr');
    const ths = firstRow?.querySelectorAll('th');
    headerCells = ths && ths.length > 0 ? Array.from(ths) : [];
  }

  const columns: string[] = headerCells.map(
    (cell, i) => (cell.textContent ?? '').trim() || `Column ${i + 1}`
  );

  // 링크 컬럼 추가 여부 결정
  const hasLinks: boolean[] = [];

  // 데이터 행 추출
  const tbody = table.querySelector('tbody') ?? table;
  const allRows = Array.from(tbody.querySelectorAll('tr'));
  const dataRows = thead
    ? allRows
    : allRows.filter((_, i) => i > 0 || headerCells.length === 0);

  // 헤더 행(th만 있는) 스킵
  const rows: ScrapeRow[] = [];
  for (const tr of dataRows) {
    const cells = tr.querySelectorAll('td, th');
    if (cells.length === 0) continue;
    // th만 있는 행은 스킵
    if (tr.querySelectorAll('th').length === cells.length && rows.length === 0) continue;

    const row: ScrapeRow = {};
    cells.forEach((cell, i) => {
      const colName = columns[i] ?? `Column ${i + 1}`;
      if (!columns[i]) columns[i] = colName;
      row[colName] = extractCellContent(cell);

      // 링크 감지
      const link = extractCellLink(cell);
      if (link) {
        if (!hasLinks[i]) hasLinks[i] = true;
        row[`${colName}_link`] = link;
      }
    });
    rows.push(row);
  }

  // 링크 컬럼 추가
  hasLinks.forEach((has, i) => {
    if (has && columns[i]) {
      const linkCol = `${columns[i]}_link`;
      if (!columns.includes(linkCol)) columns.push(linkCol);
    }
  });

  return { columns, rows };
}

// 리스트 데이터 추출
function extractListData(list: HTMLElement): { columns: string[]; rows: ScrapeRow[] } {
  const items = list.querySelectorAll(':scope > li');
  const columns = ['Item'];
  const rows: ScrapeRow[] = [];

  // 리스트 아이템 내부 구조 분석 — 서브 요소가 있으면 컬럼화
  const firstItem = items[0];
  const subElements = firstItem?.querySelectorAll('a, span, strong, em, time, img');

  if (subElements && subElements.length >= 2) {
    // 구조화된 리스트 — 서브 요소별로 컬럼 생성
    const subTags = Array.from(subElements).map((el) => el.tagName.toLowerCase());
    const uniqueTags = [...new Set(subTags)];
    const structuredColumns = uniqueTags.map(
      (tag, i) => `${tag.charAt(0).toUpperCase() + tag.slice(1)} ${i + 1}`
    );

    items.forEach((item) => {
      const row: ScrapeRow = {};
      uniqueTags.forEach((tag, i) => {
        const el = item.querySelector(tag);
        row[structuredColumns[i]] = el ? extractCellContent(el) : '';
      });
      rows.push(row);
    });

    return { columns: structuredColumns, rows };
  }

  // 단순 리스트
  items.forEach((item) => {
    const text = (item.textContent ?? '').trim();
    if (text) {
      const row: ScrapeRow = { Item: text };
      const link = extractCellLink(item);
      if (link) row['Link'] = link;
      rows.push(row);
    }
  });

  if (rows.some((r) => r['Link'])) columns.push('Link');
  return { columns, rows };
}

// 카드 반복 구조 추출
function extractCardData(cards: HTMLElement[]): { columns: string[]; rows: ScrapeRow[] } {
  if (cards.length === 0) return { columns: [], rows: [] };

  // 첫 카드를 분석해서 컬럼 구조 추론
  const sampleCard = cards[0];
  const columnMap: { selector: string; name: string }[] = [];

  // 제목 (h1-h6, [class*="title"], [class*="name"])
  const titleEl = sampleCard.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"]');
  if (titleEl) columnMap.push({ selector: 'h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"]', name: 'Title' });

  // 가격 ([class*="price"])
  const priceEl = sampleCard.querySelector('[class*="price"]');
  if (priceEl) columnMap.push({ selector: '[class*="price"]', name: 'Price' });

  // 설명 ([class*="desc"], p)
  const descEl = sampleCard.querySelector('[class*="desc"], [class*="description"], p');
  if (descEl) columnMap.push({ selector: '[class*="desc"], [class*="description"], p', name: 'Description' });

  // 이미지
  const imgEl = sampleCard.querySelector('img');
  if (imgEl) columnMap.push({ selector: 'img', name: 'Image' });

  // 링크
  const linkEl = sampleCard.querySelector('a[href]');
  if (linkEl) columnMap.push({ selector: 'a[href]', name: 'Link' });

  // 컬럼이 발견되지 않으면 전체 텍스트
  if (columnMap.length === 0) {
    const columns = ['Content'];
    const rows = cards.map((card) => ({ Content: (card.textContent ?? '').trim() }));
    return { columns, rows };
  }

  const columns = columnMap.map((c) => c.name);
  const rows: ScrapeRow[] = [];

  for (const card of cards) {
    const row: ScrapeRow = {};
    for (const col of columnMap) {
      const el = card.querySelector(col.selector);
      if (!el) {
        row[col.name] = '';
        continue;
      }
      if (col.name === 'Image') {
        row[col.name] = (el as HTMLImageElement).src || (el as HTMLImageElement).getAttribute('data-src') || '';
      } else if (col.name === 'Link') {
        try {
          row[col.name] = new URL((el as HTMLAnchorElement).href, window.location.href).href;
        } catch {
          row[col.name] = (el as HTMLAnchorElement).href ?? '';
        }
      } else {
        row[col.name] = (el.textContent ?? '').trim();
      }
    }
    rows.push(row);
  }

  return { columns, rows };
}

// dl/dt/dd 추출
function extractDefinitionData(dl: HTMLDListElement): { columns: string[]; rows: ScrapeRow[] } {
  const columns = ['Term', 'Description'];
  const rows: ScrapeRow[] = [];

  const dts = dl.querySelectorAll('dt');
  dts.forEach((dt) => {
    const dd = dt.nextElementSibling;
    if (dd?.tagName === 'DD') {
      rows.push({
        Term: (dt.textContent ?? '').trim(),
        Description: (dd.textContent ?? '').trim(),
      });
    }
  });

  return { columns, rows };
}

// === 메인 ===

function getPageInfo(): PageInfo {
  const tables = detectTables();
  const lists = detectLists();
  const cards = detectCardGroups();
  const dls = detectDefinitionLists();
  const patterns = detectRepeatedPatterns();

  const hasBasic = tables.length > 0 || lists.length > 0 || cards.length > 0 || dls.length > 0;

  return {
    url: window.location.href,
    title: document.title,
    tableCount: tables.length,
    listCount: lists.length + cards.length + dls.length + patterns.length,
    hasStructuredData: hasBasic || patterns.length > 0,
  };
}

function scrapeAll(): ScrapeResult {
  const tables = detectTables();
  const lists = detectLists();
  const cards = detectCardGroups();
  const dls = detectDefinitionLists();

  let bestResult: { columns: string[]; rows: ScrapeRow[] } = { columns: [], rows: [] };

  // 1. 테이블 우선
  for (const table of tables) {
    const result = extractTableData(table);
    if (result.rows.length > bestResult.rows.length) {
      bestResult = result;
    }
  }

  // 2. 카드 반복 구조
  if (bestResult.rows.length === 0) {
    for (const group of cards) {
      const result = extractCardData(group.cards);
      if (result.rows.length > bestResult.rows.length) {
        bestResult = result;
      }
    }
  }

  // 3. 리스트
  if (bestResult.rows.length === 0) {
    for (const list of lists) {
      const result = extractListData(list);
      if (result.rows.length > bestResult.rows.length) {
        bestResult = result;
      }
    }
  }

  // 4. dl/dt/dd
  if (bestResult.rows.length === 0) {
    for (const dl of dls) {
      const result = extractDefinitionData(dl);
      if (result.rows.length > bestResult.rows.length) {
        bestResult = result;
      }
    }
  }

  // 5. 범용 패턴 감지 (폴백) — 위 방법으로 못 찾으면 구조적 분석
  if (bestResult.rows.length === 0) {
    const patterns = detectRepeatedPatterns();
    if (patterns.length > 0) {
      const best = patterns[0];
      const result = extractCardData(best.items);
      if (result.rows.length > bestResult.rows.length) {
        bestResult = result;
      }
    }
  }

  return {
    columns: bestResult.columns,
    rows: bestResult.rows,
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
  };
}

// 메시지 리스너
chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse: (response: unknown) => void) => {
    switch (message.type) {
      case MessageType.GET_PAGE_INFO:
        sendResponse(getPageInfo());
        break;

      case MessageType.SCRAPE_START:
        try {
          const result = scrapeAll();
          sendResponse(result);
        } catch (err) {
          sendResponse({ error: String(err) });
        }
        break;

      // 사이트 클론: 반복 패턴 감지
      case MessageType.CLONE_DETECT_PATTERNS:
        try {
          const patterns = detectPatternsSerializable();
          sendResponse({ patterns });
        } catch (err) {
          sendResponse({ error: String(err) });
        }
        break;

      // 사이트 클론: AI 셀렉터로 데이터 추출
      case MessageType.CLONE_EXTRACT_DATA:
        try {
          const payload = message.payload as {
            containerSelector: string;
            itemSelector: string;
            columns: { name: string; selector: string; type: string; attribute?: string }[];
          };
          const extracted = extractWithCloneSelectors(
            payload.containerSelector,
            payload.itemSelector,
            payload.columns
          );
          sendResponse(extracted);
        } catch (err) {
          sendResponse({ error: String(err) });
        }
        break;

      default:
        break;
    }
    return true;
  }
);
