// 범용 반복 패턴 감지 — 클래스명에 의존하지 않는 구조적 분석
// "Sibling Signature Matching" 알고리즘으로 임의의 HTML 구조에서 반복 요소를 찾는다.
// AI 없이 순수 DOM 분석만으로 필드를 자동 추론한다.

import type { DetectedPatternInfo } from '../lib/types';

interface DetectedPattern {
  container: HTMLElement;
  items: HTMLElement[];
  signature: string;
  score: number;
}

// 자동 추론된 컬럼 정보
export interface InferredColumn {
  name: string;
  selector: string;
  type: 'text' | 'link' | 'image' | 'number';
  attribute?: string;
}

// 요소의 자식 구조 시그니처 계산
function computeChildSignature(el: Element): string {
  const childTags = Array.from(el.children)
    .map((c) => c.tagName)
    .sort()
    .join(',');
  return `${el.tagName}:${childTags}`;
}

// CSS 셀렉터 생성 — 요소를 고유하게 식별
function buildSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const parts: string[] = [];
  let current: HTMLElement | null = el;

  while (current && current !== document.body && parts.length < 4) {
    let sel = current.tagName.toLowerCase();

    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    const classes = Array.from(current.classList)
      .filter((c) => c.length > 2 && !/^(mt|mb|pt|pb|px|py|mx|my|w-|h-)\d/.test(c))
      .slice(0, 2);
    if (classes.length > 0) {
      sel += '.' + classes.map((c) => CSS.escape(c)).join('.');
    }

    const parent = current.parentElement;
    if (parent && !current.id) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName && s.className === current!.className
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        sel += `:nth-of-type(${idx})`;
      }
    }

    parts.unshift(sel);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

// 요소에서 간단한 상대 셀렉터 생성 (아이템 기준)
function buildRelativeSelector(el: Element, item: Element): string {
  // 태그 + 클래스로 셀렉터 생성
  let sel = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter((c) => c.length > 2)
    .slice(0, 2);
  if (classes.length > 0) {
    sel += '.' + classes.map((c) => CSS.escape(c)).join('.');
  }

  // 아이템 내에서 유일한지 확인
  const matches = item.querySelectorAll(sel);
  if (matches.length === 1) return sel;

  // 유일하지 않으면 부모 경로 추가
  const parent = el.parentElement;
  if (parent && parent !== item) {
    let parentSel = parent.tagName.toLowerCase();
    const pClasses = Array.from(parent.classList).filter((c) => c.length > 2).slice(0, 1);
    if (pClasses.length > 0) parentSel += '.' + CSS.escape(pClasses[0]);
    const combined = `${parentSel} > ${sel}`;
    if (item.querySelectorAll(combined).length === 1) return combined;
  }

  // nth-of-type 사용
  if (el.parentElement) {
    const siblings = Array.from(el.parentElement.children).filter((s) => s.tagName === el.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      return `${sel}:nth-of-type(${idx})`;
    }
  }

  return sel;
}

// 패턴 점수 계산
function scorePattern(container: HTMLElement, items: HTMLElement[]): number {
  const countScore = Math.min(items.length / 2, 25);
  const avgChildren =
    items.reduce((sum, item) => sum + item.querySelectorAll('*').length, 0) / items.length;
  const richnessScore = Math.min(avgChildren * 2, 25);

  let depth = 0;
  let el: HTMLElement | null = container;
  while (el && el !== document.body) { depth++; el = el.parentElement; }
  const depthPenalty = Math.max(0, (depth - 3) * 2);

  const hasContent = items.filter((item) => (item.textContent ?? '').trim().length > 10).length;
  const contentRatio = (hasContent / items.length) * 10;

  return countScore + richnessScore + contentRatio - depthPenalty;
}

function isInsideNavOrLayout(el: HTMLElement): boolean {
  return !!el.closest('nav, header, footer, [role="navigation"], [role="banner"]');
}

// === 순수 DOM 기반 컬럼 자동 추론 ===

// 요소 타입에 따른 컬럼 이름 + 타입 추론
function inferColumnFromElement(el: Element, item: Element, existingNames: Set<string>): InferredColumn | null {
  const tag = el.tagName.toLowerCase();

  // 빈 요소 스킵
  const text = (el.textContent ?? '').trim();
  if (!text && tag !== 'img') return null;

  // 보이지 않는 요소 스킵
  if (el instanceof HTMLElement) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
  }

  let name = '';
  let type: InferredColumn['type'] = 'text';
  let attribute: string | undefined;

  // 태그별 추론
  if (tag === 'img') {
    name = 'Image';
    type = 'image';
    attribute = 'src';
  } else if (tag === 'a') {
    // 링크: 텍스트와 href 모두 추출 가치 있음
    const href = el.getAttribute('href') ?? '';
    if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
      name = 'Link';
      type = 'link';
      attribute = 'href';
    } else {
      return null;
    }
  } else if (/^h[1-6]$/.test(tag)) {
    name = 'Title';
    type = 'text';
  } else if (tag === 'time') {
    name = 'Date';
    type = 'text';
    attribute = 'datetime';
  } else if (tag === 'p') {
    name = text.length > 50 ? 'Description' : 'Text';
    type = 'text';
  } else if (tag === 'span' || tag === 'div' || tag === 'li') {
    // 클래스명에서 힌트 추출
    const cls = el.className.toLowerCase();
    if (cls.includes('title') || cls.includes('name')) name = 'Title';
    else if (cls.includes('desc')) name = 'Description';
    else if (cls.includes('price')) { name = 'Price'; type = 'number'; }
    else if (cls.includes('date') || cls.includes('time')) name = 'Date';
    else if (cls.includes('author') || cls.includes('user')) name = 'Author';
    else if (cls.includes('cat') || cls.includes('tag')) name = 'Category';
    else if (cls.includes('score') || cls.includes('rating') || cls.includes('count')) { name = 'Score'; type = 'number'; }
    else if (text.length <= 5 && /^[\d.,]+$/.test(text)) { name = 'Number'; type = 'number'; }
    else if (text.length > 100) name = 'Description';
    else name = 'Text';
  } else if (tag === 'button') {
    return null; // 버튼은 데이터가 아님
  } else {
    name = 'Text';
  }

  if (!name) return null;

  // 중복 이름 방지
  let finalName = name;
  let counter = 1;
  while (existingNames.has(finalName)) {
    counter++;
    finalName = `${name} ${counter}`;
  }
  existingNames.add(finalName);

  const selector = buildRelativeSelector(el, item);

  return { name: finalName, selector, type, attribute };
}

// 아이템 하나에서 모든 의미있는 컬럼 추론
function inferColumnsFromItem(item: HTMLElement): InferredColumn[] {
  const columns: InferredColumn[] = [];
  const existingNames = new Set<string>();

  // 직접 자식 먼저 분석 (깊은 중첩보다 직접 자식이 더 의미있음)
  const directChildren = Array.from(item.children);

  for (const child of directChildren) {
    const col = inferColumnFromElement(child, item, existingNames);
    if (col) columns.push(col);

    // 링크 안의 텍스트도 별도 추출 (제목인 경우 많음)
    if (child.tagName === 'A' && child.textContent?.trim()) {
      const textCol: InferredColumn = {
        name: existingNames.has('Title') ? 'Link Text' : 'Title',
        selector: buildRelativeSelector(child, item),
        type: 'text',
      };
      if (!existingNames.has(textCol.name)) {
        existingNames.add(textCol.name);
        columns.push(textCol);
      }
    }

    // 자식의 자식도 분석 (1단계 깊이만)
    const grandChildren = Array.from(child.children);
    for (const gc of grandChildren) {
      const gcCol = inferColumnFromElement(gc, item, existingNames);
      if (gcCol) columns.push(gcCol);

      // 링크 안의 텍스트
      if (gc.tagName === 'A' && gc.textContent?.trim()) {
        const linkTextName = existingNames.has('Title') ? 'Link Text' : 'Title';
        if (!existingNames.has(linkTextName)) {
          existingNames.add(linkTextName);
          columns.push({
            name: linkTextName,
            selector: buildRelativeSelector(gc, item),
            type: 'text',
          });
        }
      }
    }
  }

  // 컬럼이 없으면 전체 텍스트라도 추출
  if (columns.length === 0) {
    columns.push({ name: 'Content', selector: ':scope', type: 'text' });
  }

  return columns;
}

// === 메인 감지 함수 ===

export function detectRepeatedPatterns(): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const processed = new Set<HTMLElement>();

  const allElements = document.body.querySelectorAll<HTMLElement>('*');

  for (const container of allElements) {
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length < 3) continue;
    if (isInsideNavOrLayout(container)) continue;
    if (processed.has(container)) continue;

    const signatures = new Map<string, HTMLElement[]>();
    for (const child of children) {
      if (child.children.length < 1) continue;
      const sig = computeChildSignature(child);
      if (!signatures.has(sig)) signatures.set(sig, []);
      signatures.get(sig)!.push(child);
    }

    for (const [sig, items] of signatures) {
      if (items.length < 3) continue;
      if (items.length / children.length < 0.7) continue;

      let skip = false;
      for (const existing of patterns) {
        if (existing.container.contains(container) || container.contains(existing.container)) {
          const newScore = scorePattern(container, items);
          if (newScore > existing.score) {
            const idx = patterns.indexOf(existing);
            patterns.splice(idx, 1);
          } else {
            skip = true;
          }
          break;
        }
      }
      if (skip) continue;

      const score = scorePattern(container, items);
      patterns.push({ container, items, signature: sig, score });
      processed.add(container);
    }
  }

  patterns.sort((a, b) => b.score - a.score);
  return patterns;
}

// 직렬화 가능한 형태 + 자동 추론 컬럼 포함
export interface DetectedPatternWithColumns extends DetectedPatternInfo {
  columns: InferredColumn[];
}

export function detectPatternsWithColumns(): DetectedPatternWithColumns[] {
  return detectRepeatedPatterns().map((p) => {
    // 첫 번째 아이템에서 컬럼 구조 추론
    const columns = inferColumnsFromItem(p.items[0]);

    return {
      containerSelector: buildSelector(p.container),
      itemCount: p.items.length,
      signature: p.signature,
      score: p.score,
      sampleHtml: '',
      columns,
    };
  });
}

// 기존 호환용
export function detectPatternsSerializable(): DetectedPatternInfo[] {
  return detectPatternsWithColumns();
}

// DOM 기반 직접 추출 — AI 없이 감지된 패턴에서 바로 데이터 추출
export function extractFromPattern(
  patternIndex: number = 0
): { columns: string[]; rows: Record<string, string>[]; patternInfo: string } | null {
  const patterns = detectRepeatedPatterns();
  if (patternIndex >= patterns.length) return null;

  const pattern = patterns[patternIndex];
  const columns = inferColumnsFromItem(pattern.items[0]);

  const rows: Record<string, string>[] = [];

  for (const item of pattern.items) {
    const row: Record<string, string> = {};
    let hasData = false;

    for (const col of columns) {
      const el = item.querySelector(col.selector);
      if (!el) { row[col.name] = ''; continue; }

      if (col.attribute) {
        let val = el.getAttribute(col.attribute) ?? '';
        if ((col.type === 'link' || col.type === 'image') && val) {
          try { val = new URL(val, window.location.href).href; } catch { /* 원본 유지 */ }
        }
        row[col.name] = val;
      } else if (col.type === 'link') {
        row[col.name] = (el as HTMLAnchorElement).href ?? '';
      } else if (col.type === 'image') {
        row[col.name] = (el as HTMLImageElement).src || el.getAttribute('data-src') || '';
      } else if (col.type === 'number') {
        row[col.name] = (el.textContent ?? '').replace(/[^0-9.,\-]/g, '').trim();
      } else {
        row[col.name] = (el.textContent ?? '').trim();
      }

      if (row[col.name]) hasData = true;
    }

    if (hasData) rows.push(row);
  }

  return {
    columns: columns.map((c) => c.name),
    rows,
    patternInfo: `${pattern.items.length}개 항목 (${pattern.signature})`,
  };
}
