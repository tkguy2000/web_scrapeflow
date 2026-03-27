import { MessageType } from '../lib/types';
import type { PageInfo, ScrapeResult, ScrapeRow, Message } from '../lib/types';

// 페이지 내 테이블 감지
function detectTables(): HTMLTableElement[] {
  return Array.from(document.querySelectorAll('table')).filter((table) => {
    const rows = table.querySelectorAll('tr');
    return rows.length >= 2; // 헤더 + 최소 1행
  });
}

// 페이지 내 리스트 감지 (반복 구조)
function detectLists(): HTMLElement[] {
  const lists: HTMLElement[] = [];

  // ul/ol 리스트
  document.querySelectorAll('ul, ol').forEach((list) => {
    const items = list.querySelectorAll(':scope > li');
    if (items.length >= 3) {
      lists.push(list as HTMLElement);
    }
  });

  return lists;
}

// 테이블 데이터 추출
function extractTableData(table: HTMLTableElement): { columns: string[]; rows: ScrapeRow[] } {
  const headerCells = table.querySelectorAll('thead th, thead td, tr:first-child th');
  const columns: string[] = [];

  if (headerCells.length > 0) {
    headerCells.forEach((cell) => {
      columns.push((cell.textContent ?? '').trim());
    });
  }

  const bodyRows = table.querySelectorAll('tbody tr, tr');
  const rows: ScrapeRow[] = [];
  const startIndex = headerCells.length > 0 ? 0 : 0;

  bodyRows.forEach((tr, idx) => {
    // 헤더 행 스킵
    if (idx === 0 && headerCells.length > 0 && tr.querySelector('th')) return;

    const cells = tr.querySelectorAll('td, th');
    if (cells.length === 0) return;

    const row: ScrapeRow = {};
    cells.forEach((cell, cellIdx) => {
      const colName = columns[cellIdx] ?? `Column ${cellIdx + 1}`;
      // 컬럼명이 없으면 자동 생성
      if (!columns[cellIdx]) columns[cellIdx] = colName;
      row[colName] = (cell.textContent ?? '').trim();
    });
    rows.push(row);
  });

  return { columns, rows };
}

// 리스트 데이터 추출
function extractListData(list: HTMLElement): { columns: string[]; rows: ScrapeRow[] } {
  const items = list.querySelectorAll(':scope > li');
  const columns = ['Item'];
  const rows: ScrapeRow[] = [];

  items.forEach((item) => {
    rows.push({ Item: (item.textContent ?? '').trim() });
  });

  return { columns, rows };
}

// 페이지 정보 수집
function getPageInfo(): PageInfo {
  const tables = detectTables();
  const lists = detectLists();

  return {
    url: window.location.href,
    title: document.title,
    tableCount: tables.length,
    listCount: lists.length,
    hasStructuredData: tables.length > 0 || lists.length > 0,
  };
}

// 전체 스크래핑 실행
function scrapeAll(): ScrapeResult {
  const tables = detectTables();
  const lists = detectLists();

  let allColumns: string[] = [];
  let allRows: ScrapeRow[] = [];

  // 테이블 우선 추출
  for (const table of tables) {
    const { columns, rows } = extractTableData(table);
    if (rows.length > 0) {
      allColumns = columns;
      allRows = rows;
      break; // 첫 번째 유의미한 테이블 사용
    }
  }

  // 테이블이 없으면 리스트 추출
  if (allRows.length === 0 && lists.length > 0) {
    const { columns, rows } = extractListData(lists[0]);
    allColumns = columns;
    allRows = rows;
  }

  return {
    columns: allColumns,
    rows: allRows,
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

      default:
        break;
    }
    return true; // 비동기 응답 허용
  }
);
