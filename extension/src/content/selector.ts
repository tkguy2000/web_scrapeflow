// 사용자 요소 선택 UI — 페이지 위에 오버레이로 표시
// 호버 시 하이라이트, 클릭 시 셀렉터 생성

import { MessageType } from '../lib/types';
import type { Message } from '../lib/types';

let isActive = false;
let overlay: HTMLDivElement | null = null;
let tooltip: HTMLDivElement | null = null;
let selectedElements: Element[] = [];
let onComplete: ((selector: string) => void) | null = null;

// CSS 셀렉터 생성
function generateSelector(el: Element): string {
  // ID가 있으면 사용
  if (el.id) return `#${CSS.escape(el.id)}`;

  // 클래스 기반 셀렉터
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter((c) => !c.startsWith('sf-')) // ScrapeFlow 내부 클래스 제외
    .slice(0, 3);

  if (classes.length > 0) {
    const classSelector = classes.map((c) => `.${CSS.escape(c)}`).join('');
    const matches = document.querySelectorAll(`${tag}${classSelector}`);
    if (matches.length <= 10) return `${tag}${classSelector}`;
  }

  // nth-child 폴백
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(el) + 1;
    const parentSelector = generateSelector(parent);
    return `${parentSelector} > ${tag}:nth-child(${index})`;
  }

  return tag;
}

// 유사 요소 자동 선택 — 같은 패턴의 형제 요소들
function findSimilarElements(el: Element): Element[] {
  const parent = el.parentElement;
  if (!parent) return [el];

  const tag = el.tagName;
  const className = el.className;

  // 같은 부모 아래 동일 태그+클래스
  const siblings = Array.from(parent.children).filter(
    (child) => child.tagName === tag && child.className === className
  );

  if (siblings.length >= 2) return siblings;
  return [el];
}

// 오버레이 생성
function createOverlay(): void {
  overlay = document.createElement('div');
  overlay.id = 'sf-overlay';
  overlay.style.cssText = `
    position: fixed; pointer-events: none; z-index: 2147483646;
    border: 2px solid #6c5ce7; background: rgba(108, 92, 231, 0.1);
    border-radius: 4px; transition: all 0.1s ease;
    display: none;
  `;

  tooltip = document.createElement('div');
  tooltip.id = 'sf-tooltip';
  tooltip.style.cssText = `
    position: fixed; z-index: 2147483647; pointer-events: none;
    background: #1a1a2e; color: #fff; font-size: 12px;
    padding: 4px 8px; border-radius: 4px; font-family: monospace;
    max-width: 400px; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; display: none;
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(tooltip);
}

// 오버레이 위치 업데이트
function updateOverlay(el: Element): void {
  if (!overlay || !tooltip) return;

  const rect = el.getBoundingClientRect();
  overlay.style.display = 'block';
  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;

  const selector = generateSelector(el);
  tooltip.style.display = 'block';
  tooltip.textContent = `${el.tagName.toLowerCase()} — ${selector}`;
  tooltip.style.top = `${Math.max(0, rect.top - 28)}px`;
  tooltip.style.left = `${rect.left}px`;
}

// 선택된 요소 하이라이트
function highlightSelected(elements: Element[]): void {
  // 기존 하이라이트 제거
  document.querySelectorAll('.sf-selected').forEach((el) => {
    el.classList.remove('sf-selected');
    (el as HTMLElement).style.outline = '';
  });

  elements.forEach((el) => {
    el.classList.add('sf-selected');
    (el as HTMLElement).style.outline = '2px solid #00b894';
  });
}

// 이벤트 핸들러
function handleMouseMove(e: MouseEvent): void {
  if (!isActive) return;
  const target = e.target as Element;
  if (target.id?.startsWith('sf-')) return;
  updateOverlay(target);
}

function handleClick(e: MouseEvent): void {
  if (!isActive) return;
  e.preventDefault();
  e.stopPropagation();

  const target = e.target as Element;
  if (target.id?.startsWith('sf-')) return;

  const similar = findSimilarElements(target);
  selectedElements = similar;
  highlightSelected(similar);

  const selector = generateSelector(target);

  // 선택 완료 콜백
  if (onComplete) {
    onComplete(selector);
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    deactivateSelector();
  }
}

// 선택 모드 활성화
export function activateSelector(callback: (selector: string) => void): void {
  if (isActive) return;
  isActive = true;
  onComplete = callback;

  createOverlay();
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.body.style.cursor = 'crosshair';
}

// 선택 모드 비활성화
export function deactivateSelector(): void {
  isActive = false;
  onComplete = null;

  overlay?.remove();
  tooltip?.remove();
  overlay = null;
  tooltip = null;

  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  document.body.style.cursor = '';

  // 하이라이트 제거
  document.querySelectorAll('.sf-selected').forEach((el) => {
    el.classList.remove('sf-selected');
    (el as HTMLElement).style.outline = '';
  });
  selectedElements = [];
}

// 선택된 요소 반환
export function getSelectedElements(): Element[] {
  return selectedElements;
}

// 메시지 리스너 — popup/sidepanel에서 선택 모드 제어
chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse: (response: unknown) => void) => {
    if (message.type === ('SELECTOR_ACTIVATE' as MessageType)) {
      activateSelector((selector) => {
        chrome.runtime.sendMessage({
          type: 'SELECTOR_RESULT',
          payload: {
            selector,
            count: selectedElements.length,
            sampleText: selectedElements.slice(0, 3).map((el) => (el.textContent ?? '').trim().slice(0, 50)),
          },
        });
      });
      sendResponse({ ok: true });
    }

    if (message.type === ('SELECTOR_DEACTIVATE' as MessageType)) {
      deactivateSelector();
      sendResponse({ ok: true });
    }

    return true;
  }
);
