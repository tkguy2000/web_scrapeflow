// Next.js 패키지 내보내기 — 추출된 데이터를 Next.js 프로젝트에서 사용할 수 있는 JSON으로 변환

import type { ScrapeResult, SiteAssets, AICloneResult } from './types';

// Next.js 패키지 인터페이스
export interface NextJsPackage {
  metadata: {
    sourceUrl: string;
    generatedAt: string;
    pageType: string;
    generator: string;
  };
  data: {
    suggestedPath: string;
    rows: Record<string, unknown>[];
    typeDefinition: string;
    columns: { name: string; type: string }[];
  };
  assets: {
    images: { originalUrl: string; suggestedPath: string; alt?: string }[];
    fonts: { family: string; url?: string }[];
    colorPalette: string[];
    typography: { element: string; fontSize: string; fontWeight: string; fontFamily: string }[];
  };
  tailwindConfig: {
    colors: Record<string, string>;
    fontFamily: Record<string, string[]>;
  };
}

// PascalCase 변환
function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

// TypeScript 인터페이스 생성
function generateTypeDefinition(columns: { name: string; type: string }[], typeName: string): string {
  const lines = columns.map((col) => {
    const tsType = col.type === 'number' ? 'number' : 'string';
    // 안전한 프로퍼티명 생성
    const safeName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(col.name)
      ? col.name
      : `'${col.name}'`;
    return `  ${safeName}: ${tsType};`;
  });

  return `export interface ${typeName} {\n${lines.join('\n')}\n}`;
}

// RGB 문자열을 hex로 변환
function rgbToHex(rgb: string): string {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return rgb;
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Tailwind 색상 이름 추론
function inferColorName(hex: string, index: number): string {
  const colorNames = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'border'];
  return colorNames[index] ?? `color-${index + 1}`;
}

// Next.js 패키지 생성
export function generateNextJsPackage(
  result: ScrapeResult,
  assets: SiteAssets | null,
  aiResult: AICloneResult | null
): NextJsPackage {
  const pageType = aiResult?.pageType ?? 'other';
  const typeName = toPascalCase(pageType) + 'Item';

  // 컬럼 정보
  const columns = (aiResult?.columns ?? result.columns.map((c) => ({ name: c, type: 'text' as const }))).map((c) => ({
    name: typeof c === 'string' ? c : c.name,
    type: typeof c === 'string' ? 'text' : c.type,
  }));

  // TypeScript 인터페이스
  const typeDefinition = generateTypeDefinition(columns, typeName);

  // 이미지 에셋
  const images = (assets?.images ?? []).map((img, i) => ({
    originalUrl: img.src,
    suggestedPath: `public/images/${pageType}-${i + 1}${getImageExtension(img.src)}`,
    alt: img.alt,
  }));

  // 폰트 에셋
  const fonts = (assets?.fonts ?? []).map((f) => ({
    family: f.family,
    url: f.src,
  }));

  // Tailwind 색상 설정
  const colors: Record<string, string> = {};
  (assets?.colorPalette ?? []).slice(0, 8).forEach((c, i) => {
    const hex = rgbToHex(c);
    colors[inferColorName(hex, i)] = hex;
  });

  // Tailwind 폰트 설정
  const fontFamily: Record<string, string[]> = {};
  const seenFamilies = new Set<string>();
  (assets?.typographyScale ?? []).forEach((t) => {
    const family = t.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (seenFamilies.has(family)) return;
    seenFamilies.add(family);
    fontFamily[family.toLowerCase().replace(/\s+/g, '-')] = [family, 'sans-serif'];
  });

  return {
    metadata: {
      sourceUrl: result.url,
      generatedAt: new Date().toISOString(),
      pageType,
      generator: 'ScrapeFlow v0.1.0',
    },
    data: {
      suggestedPath: `data/${pageType}s.json`,
      rows: result.rows,
      typeDefinition,
      columns,
    },
    assets: {
      images,
      fonts,
      colorPalette: (assets?.colorPalette ?? []).map(rgbToHex),
      typography: (assets?.typographyScale ?? []).map((t) => ({
        element: t.element,
        fontSize: t.fontSize,
        fontWeight: t.fontWeight,
        fontFamily: t.fontFamily,
      })),
    },
    tailwindConfig: {
      colors,
      fontFamily,
    },
  };
}

// 이미지 확장자 추출
function getImageExtension(url: string): string {
  const match = url.match(/\.(png|jpg|jpeg|gif|svg|webp|avif)(\?|$)/i);
  return match ? `.${match[1].toLowerCase()}` : '.png';
}

// Next.js 패키지 다운로드
export function downloadNextJsPackage(pkg: NextJsPackage): void {
  const content = JSON.stringify(pkg, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `scrapeflow-nextjs-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
