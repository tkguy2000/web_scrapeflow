// Claude API 연동 — 자연어로 데이터 구조 추론
// API 키는 Extension storage에 저장

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

export interface AIColumnSuggestion {
  name: string;
  selector: string;
  type: 'text' | 'link' | 'image' | 'number';
}

export interface AIScrapeResult {
  columns: AIColumnSuggestion[];
  containerSelector: string;
  itemSelector: string;
}

// API 키 저장/조회
export async function getApiKey(): Promise<string | null> {
  const data = await chrome.storage.sync.get('sf_api_key');
  return data['sf_api_key'] ?? null;
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.sync.set({ sf_api_key: key });
}

// 페이지 HTML에서 구조 요약 생성 (토큰 절약)
function summarizePageStructure(html: string): string {
  // DOM을 직접 파싱하지 않고 HTML 문자열에서 핵심 구조만 추출
  // 스크립트, 스타일 제거
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 태그 구조만 추출 (최대 3000자)
  const tags = cleaned.replace(/>[^<]+</g, '><').slice(0, 3000);
  return tags;
}

// Claude API로 데이터 구조 추론
export async function inferDataStructure(
  userPrompt: string,
  pageHtml: string,
  pageUrl: string
): Promise<AIScrapeResult> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('API_KEY_NOT_SET');
  }

  const structure = summarizePageStructure(pageHtml);

  const systemPrompt = `You are a web scraping assistant. Given a webpage's HTML structure and a user's description of what data they want, you must determine:
1. What CSS selector identifies the container of repeated items
2. What CSS selector identifies each individual item within the container
3. For each column the user wants, what CSS selector (relative to the item) extracts that data

Respond ONLY with valid JSON in this exact format:
{
  "containerSelector": "CSS selector for the container",
  "itemSelector": "CSS selector for each item (relative to container)",
  "columns": [
    { "name": "Column Name", "selector": "CSS selector relative to item", "type": "text|link|image|number" }
  ]
}`;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `URL: ${pageUrl}\n\nUser request: "${userPrompt}"\n\nPage HTML structure:\n${structure}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API_ERROR: ${response.status} ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text ?? '';

  // JSON 파싱
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI_PARSE_ERROR: No JSON in response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as AIScrapeResult;

  // 기본 유효성 검사
  if (!parsed.columns || !Array.isArray(parsed.columns) || parsed.columns.length === 0) {
    throw new Error('AI_PARSE_ERROR: Invalid columns');
  }

  return parsed;
}

// AI 추론 결과로 실제 데이터 추출 (Content Script에서 실행)
export function extractWithAIResult(
  result: AIScrapeResult
): { columns: string[]; rows: Record<string, string>[] } {
  const container = document.querySelector(result.containerSelector);
  if (!container) {
    return { columns: result.columns.map((c) => c.name), rows: [] };
  }

  const items = container.querySelectorAll(result.itemSelector);
  const columns = result.columns.map((c) => c.name);
  const rows: Record<string, string>[] = [];

  items.forEach((item) => {
    const row: Record<string, string> = {};
    for (const col of result.columns) {
      const el = item.querySelector(col.selector);
      if (!el) {
        row[col.name] = '';
        continue;
      }

      switch (col.type) {
        case 'link':
          row[col.name] = (el as HTMLAnchorElement).href ?? '';
          break;
        case 'image':
          row[col.name] = (el as HTMLImageElement).src ?? (el as HTMLImageElement).getAttribute('data-src') ?? '';
          break;
        case 'number':
          row[col.name] = (el.textContent ?? '').replace(/[^0-9.,\-]/g, '').trim();
          break;
        default:
          row[col.name] = (el.textContent ?? '').trim();
      }
    }
    rows.push(row);
  });

  return { columns, rows };
}
