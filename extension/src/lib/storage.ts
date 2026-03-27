import type { ScrapeResult } from './types';

const STORAGE_KEY = 'scrapeflow_results';
const MAX_RESULTS = 50;

// 결과 저장
export async function saveResult(result: ScrapeResult): Promise<void> {
  const existing = await getResults();
  existing.unshift(result);
  // 최대 개수 제한
  const trimmed = existing.slice(0, MAX_RESULTS);
  await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
}

// 결과 목록 조회
export async function getResults(): Promise<ScrapeResult[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] ?? [];
}

// 결과 삭제
export async function clearResults(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
