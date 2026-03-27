// 범용 반복 패턴 감지 — 클래스명에 의존하지 않는 구조적 분석
// "Sibling Signature Matching" 알고리즘으로 임의의 HTML 구조에서 반복 요소를 찾는다.

import type { DetectedPatternInfo } from '../lib/types';

interface DetectedPattern {
  container: HTMLElement;
  items: HTMLElement[];
  signature: string;
  score: number;
  sampleHtml: string;
}

// 요소의 자식 구조 시그니처 계산
// 예: <div> 안에 <h3>, <p>, <a> → "DIV:A,H3,P"
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

    // 클래스 중 의미 있는 것 사용 (짧은 유틸 클래스 제외)
    const classes = Array.from(current.classList)
      .filter((c) => c.length > 2 && !/^(mt|mb|pt|pb|px|py|mx|my|w-|h-)\d/.test(c))
      .slice(0, 2);
    if (classes.length > 0) {
      sel += '.' + classes.map((c) => CSS.escape(c)).join('.');
    }

    // 같은 태그+클래스를 가진 형제 중 몇 번째인지
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

// 패턴 점수 계산 — 항목 수, 콘텐츠 풍부도, 깊이 고려
function scorePattern(container: HTMLElement, items: HTMLElement[]): number {
  // 항목 수 (3개부터 가치, 최대 50점)
  const countScore = Math.min(items.length / 2, 25);

  // 콘텐츠 풍부도 — 아이템당 평균 자식 요소 수
  const avgChildren =
    items.reduce((sum, item) => sum + item.querySelectorAll('*').length, 0) / items.length;
  const richnessScore = Math.min(avgChildren * 2, 25);

  // 깊이 페널티 — DOM 트리 깊이가 깊을수록 점수 감소
  let depth = 0;
  let el: HTMLElement | null = container;
  while (el && el !== document.body) {
    depth++;
    el = el.parentElement;
  }
  const depthPenalty = Math.max(0, (depth - 3) * 2);

  // 텍스트 콘텐츠가 있는 아이템 비율
  const hasContent = items.filter((item) => (item.textContent ?? '').trim().length > 10).length;
  const contentRatio = (hasContent / items.length) * 10;

  return countScore + richnessScore + contentRatio - depthPenalty;
}

// 네비게이션/레이아웃 요소 내부인지 확인
function isInsideNavOrLayout(el: HTMLElement): boolean {
  return !!el.closest('nav, header, footer, [role="navigation"], [role="banner"]');
}

// 메인: 모든 반복 패턴 감지
export function detectRepeatedPatterns(): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const processed = new Set<HTMLElement>(); // 중복 방지

  // body부터 모든 요소 순회
  const allElements = document.body.querySelectorAll<HTMLElement>('*');

  for (const container of allElements) {
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length < 3) continue; // 최소 3개 자식
    if (isInsideNavOrLayout(container)) continue; // 네비게이션 제외
    if (processed.has(container)) continue;

    // 자식별 시그니처 계산
    const signatures = new Map<string, HTMLElement[]>();
    for (const child of children) {
      // 자식 요소가 2개 미만이면 너무 단순 — 스킵
      if (child.children.length < 1) continue;

      const sig = computeChildSignature(child);
      if (!signatures.has(sig)) signatures.set(sig, []);
      signatures.get(sig)!.push(child);
    }

    // 가장 많이 반복되는 시그니처 찾기
    for (const [sig, items] of signatures) {
      if (items.length < 3) continue;
      if (items.length / children.length < 0.7) continue;

      // 중복 컨테이너 방지 — 이미 처리된 부모/자식 건너뛰기
      let skip = false;
      for (const existing of patterns) {
        if (
          existing.container.contains(container) ||
          container.contains(existing.container)
        ) {
          // 더 높은 점수를 가진 것을 유지
          const newScore = scorePattern(container, items);
          if (newScore > existing.score) {
            // 기존 것을 제거하고 새 것으로 대체
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
      // 샘플 HTML: 첫 2개 아이템 (AI 분석용, 4000자 제한)
      const sampleHtml = items
        .slice(0, 2)
        .map((item) => item.outerHTML)
        .join('\n')
        .slice(0, 4000);

      patterns.push({ container, items, signature: sig, score, sampleHtml });
      processed.add(container);
    }
  }

  // 점수 순 정렬
  patterns.sort((a, b) => b.score - a.score);
  return patterns;
}

// 직렬화 가능한 형태로 변환 (SW 전달용)
export function detectPatternsSerializable(): DetectedPatternInfo[] {
  return detectRepeatedPatterns().map((p) => ({
    containerSelector: buildSelector(p.container),
    itemCount: p.items.length,
    signature: p.signature,
    score: p.score,
    sampleHtml: p.sampleHtml,
  }));
}

// AI 셀렉터로 데이터 추출 (Content Script에서 실행)
export function extractWithCloneSelectors(
  containerSelector: string,
  itemSelector: string,
  columns: { name: string; selector: string; type: string; attribute?: string }[]
): { columns: string[]; rows: Record<string, string>[] } {
  const container = document.querySelector(containerSelector);
  if (!container) return { columns: columns.map((c) => c.name), rows: [] };

  const items = container.querySelectorAll(itemSelector);
  const colNames = columns.map((c) => c.name);
  const rows: Record<string, string>[] = [];

  items.forEach((item) => {
    const row: Record<string, string> = {};
    for (const col of columns) {
      const el = item.querySelector(col.selector);
      if (!el) {
        row[col.name] = '';
        continue;
      }

      // attribute가 지정되면 해당 속성값 추출
      if (col.attribute) {
        row[col.name] = el.getAttribute(col.attribute) ?? '';
        // 상대 URL → 절대 URL 변환
        if (
          (col.type === 'link' || col.type === 'image' || col.type === 'file') &&
          row[col.name]
        ) {
          try {
            row[col.name] = new URL(row[col.name], window.location.href).href;
          } catch {
            // URL 변환 실패 시 원본 유지
          }
        }
        continue;
      }

      switch (col.type) {
        case 'link':
          row[col.name] = (el as HTMLAnchorElement).href ?? '';
          break;
        case 'image':
          row[col.name] =
            (el as HTMLImageElement).src ||
            el.getAttribute('data-src') ||
            '';
          break;
        case 'file':
          row[col.name] = (el as HTMLAnchorElement).href ?? '';
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

  return { columns: colNames, rows };
}
