// 사이트 에셋 추출 — CSS, 이미지, 폰트, 색상 팔레트, 타이포그래피
// Content Script에서 실행하여 CORS 우회

import type { SiteAssets } from '../lib/types';

// 스타일시트 추출 — 같은 출처는 cssRules 직접 읽기, 교차 출처는 스킵
function extractStylesheets(): SiteAssets['stylesheets'] {
  const results: SiteAssets['stylesheets'] = [];

  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i];
    const href = sheet.href;

    try {
      const rules = sheet.cssRules;
      let cssText = '';
      for (let j = 0; j < rules.length; j++) {
        cssText += rules[j].cssText + '\n';
      }
      results.push({ href, cssText });
    } catch {
      // 교차 출처 스타일시트 — cssRules 접근 불가, href만 기록
      if (href) {
        results.push({ href, cssText: '' });
      }
    }
  }

  // 인라인 스타일도 수집
  const inlineStyles = document.querySelectorAll('style');
  inlineStyles.forEach((style) => {
    if (style.textContent) {
      results.push({ href: null, cssText: style.textContent });
    }
  });

  return results;
}

// 이미지 추출 — <img> 태그 + background-image
function extractImages(): SiteAssets['images'] {
  const images: SiteAssets['images'] = [];
  const seen = new Set<string>();

  // <img> 태그
  document.querySelectorAll('img').forEach((img) => {
    const src = img.src || img.getAttribute('data-src') || '';
    if (!src || seen.has(src)) return;
    seen.add(src);

    images.push({
      src,
      alt: img.alt || undefined,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      isBackground: false,
    });
  });

  // background-image (주요 요소만 — 전체 순회는 성능 문제)
  const candidates = document.querySelectorAll<HTMLElement>(
    'div, section, article, main, header, footer, [class*="hero"], [class*="banner"], [class*="bg"]'
  );

  candidates.forEach((el) => {
    const bgImage = getComputedStyle(el).backgroundImage;
    if (!bgImage || bgImage === 'none') return;

    // url(...) 패턴에서 URL 추출
    const match = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (!match) return;

    const src = match[1];
    if (seen.has(src)) return;
    seen.add(src);

    images.push({
      src,
      width: el.offsetWidth,
      height: el.offsetHeight,
      isBackground: true,
    });
  });

  return images;
}

// 폰트 추출 — @font-face 규칙 파싱
function extractFonts(): SiteAssets['fonts'] {
  const fonts: SiteAssets['fonts'] = [];
  const seen = new Set<string>();

  for (let i = 0; i < document.styleSheets.length; i++) {
    try {
      const rules = document.styleSheets[i].cssRules;
      for (let j = 0; j < rules.length; j++) {
        const rule = rules[j];
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
          const weight = rule.style.getPropertyValue('font-weight') || '400';
          const srcValue = rule.style.getPropertyValue('src');

          // src에서 URL 추출
          const urlMatch = srcValue.match(/url\(["']?([^"')]+)["']?\)/);
          const src = urlMatch ? urlMatch[1] : undefined;

          const key = `${family}:${weight}`;
          if (seen.has(key)) continue;
          seen.add(key);

          fonts.push({ family, weight, src });
        }
      }
    } catch {
      // 교차 출처 스타일시트 스킵
    }
  }

  return fonts;
}

// 색상 팔레트 추출 — 주요 요소의 color, backgroundColor 수집
function extractColorPalette(): string[] {
  const colorCount = new Map<string, number>();

  // 주요 요소만 순회 (성능 고려)
  const selectors = 'h1, h2, h3, h4, h5, h6, p, a, span, div, section, button, nav, header, footer, main, article';
  const elements = document.querySelectorAll<HTMLElement>(selectors);

  elements.forEach((el) => {
    const style = getComputedStyle(el);

    const colors = [style.color, style.backgroundColor, style.borderColor];
    for (const c of colors) {
      if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') continue;
      colorCount.set(c, (colorCount.get(c) || 0) + 1);
    }
  });

  // 빈도순 정렬, 상위 20개
  return Array.from(colorCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([color]) => color);
}

// 타이포그래피 스케일 추출
function extractTypographyScale(): SiteAssets['typographyScale'] {
  const scale: SiteAssets['typographyScale'] = [];
  const seen = new Set<string>();

  const elements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'li', 'span', 'blockquote'];

  for (const tag of elements) {
    const el = document.querySelector(tag);
    if (!el) continue;

    const style = getComputedStyle(el);
    const key = `${tag}:${style.fontSize}:${style.fontWeight}`;
    if (seen.has(key)) continue;
    seen.add(key);

    scale.push({
      element: tag,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      fontFamily: style.fontFamily,
    });
  }

  return scale;
}

// 메인 에셋 추출 함수
export function extractAllAssets(): SiteAssets {
  return {
    stylesheets: extractStylesheets(),
    images: extractImages(),
    fonts: extractFonts(),
    colorPalette: extractColorPalette(),
    typographyScale: extractTypographyScale(),
  };
}
