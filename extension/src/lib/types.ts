// 메시지 타입 enum — SW 내부 라우팅에 사용
export enum MessageType {
  // 스크래핑
  SCRAPE_START = 'SCRAPE_START',
  SCRAPE_RESULT = 'SCRAPE_RESULT',
  SCRAPE_ERROR = 'SCRAPE_ERROR',

  // 캡처
  CAPTURE_FULL_PAGE = 'CAPTURE_FULL_PAGE',
  CAPTURE_RESULT = 'CAPTURE_RESULT',
  CAPTURE_ERROR = 'CAPTURE_ERROR',

  // 내보내기
  EXPORT_DATA = 'EXPORT_DATA',

  // 상태
  GET_PAGE_INFO = 'GET_PAGE_INFO',
  PAGE_INFO = 'PAGE_INFO',

  // Side Panel
  OPEN_SIDE_PANEL = 'OPEN_SIDE_PANEL',

  // 사이트 클론
  CLONE_DETECT_PATTERNS = 'CLONE_DETECT_PATTERNS',
  CLONE_EXTRACT_DATA = 'CLONE_EXTRACT_DATA',
  CLONE_EXTRACT_ASSETS = 'CLONE_EXTRACT_ASSETS',
  CLONE_RESULT = 'CLONE_RESULT',
  CLONE_PROGRESS = 'CLONE_PROGRESS',
}

// 스크래핑 결과 행
export interface ScrapeRow {
  [key: string]: string | number | boolean | null;
}

// 스크래핑 결과
export interface ScrapeResult {
  columns: string[];
  rows: ScrapeRow[];
  url: string;
  title: string;
  timestamp: number;
}

// 내보내기 형식
export type ExportFormat = 'json' | 'csv' | 'html' | 'clipboard';

// 페이지 정보
export interface PageInfo {
  url: string;
  title: string;
  tableCount: number;
  listCount: number;
  hasStructuredData: boolean;
}

// 에러 타입
export enum ScrapeFlowError {
  SCRAPE_FAILED = 'SCRAPE_FAILED',
  CAPTURE_FAILED = 'CAPTURE_FAILED',
  EXPORT_FAILED = 'EXPORT_FAILED',
  CDP_ATTACH_FAILED = 'CDP_ATTACH_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
}

// 메시지 베이스
export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

// 캡처 옵션
export interface CaptureOptions {
  format: 'png' | 'pdf';
  fullPage: boolean;
}

// === 사이트 클론 타입 ===

// 감지된 반복 패턴 (Content Script → SW 직렬화용)
export interface DetectedPatternInfo {
  containerSelector: string;
  itemCount: number;
  signature: string;
  score: number;
  sampleHtml: string; // 첫 2개 아이템 outerHTML
}

// 에셋 정보
export interface SiteAssets {
  stylesheets: { href: string | null; cssText: string }[];
  images: { src: string; alt?: string; width: number; height: number; isBackground: boolean }[];
  fonts: { family: string; weight: string; src?: string }[];
  colorPalette: string[];
  typographyScale: { element: string; fontSize: string; fontWeight: string; lineHeight: string; fontFamily: string }[];
}

// 클론 최종 결과
export interface CloneResult {
  data: ScrapeResult;
  assets: SiteAssets | null;
  pageType: string;
  sourceUrl: string;
  timestamp: number;
}
