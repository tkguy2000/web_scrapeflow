import { MessageType } from '../lib/types';
import type { ScrapeResult, ScrapeRow, ExportFormat, DetectedPatternInfo } from '../lib/types';
import { downloadData } from '../lib/export';

// === 다국어 텍스트 ===
type I18nValue = string | ((...args: string[]) => string);
const i18n: Record<string, Record<string, I18nValue>> = {
  en: {
    source: 'Source:',
    analyzeSite: 'Analyze Site',
    analyzing: 'Analyzing...',
    detectingPatterns: '🔍 Detecting patterns...',
    extractingData: '📊 Extracting data...',
    analysisComplete: '✅ Analysis complete!',
    exportData: 'Export Data',
    copy: 'Copy',
    siteClone: 'Site Clone',
    htmlClone: 'HTML Clone',
    sitePackage: 'Site Package',
    viewData: 'View Extracted Data',
    generating: 'Generating...',
    noPatternFound: 'No extractable data patterns found. Try HTML Clone instead.',
    patternFailed: 'Pattern detection failed — use Site Clone features',
    noDataFound: 'No data found. Try HTML Clone instead.',
    noDataExtracted: 'No data extracted — use Site Clone features',
    analysisFailed: 'Analysis failed',
    cloneFailed: 'Clone failed',
    emptyHtml: 'Empty HTML',
    packageFailed: 'Package generation failed',
    rowsColsExtracted: (rows: string, cols: string) => `${rows} rows × ${cols} columns extracted`,
    viewDataRows: (rows: string) => `View Extracted Data (${rows} rows)`,
    langToggle: 'EN/한',
  },
  ko: {
    source: '소스:',
    analyzeSite: '사이트 분석',
    analyzing: '분석 중...',
    detectingPatterns: '🔍 반복 패턴 감지 중...',
    extractingData: '📊 데이터 추출 중...',
    analysisComplete: '✅ 분석 완료!',
    exportData: '데이터 내보내기',
    copy: '복사',
    siteClone: '사이트 복제',
    htmlClone: 'HTML 클론',
    sitePackage: '사이트 패키지',
    viewData: '추출 데이터 보기',
    generating: '생성 중...',
    noPatternFound: '추출 가능한 데이터 패턴을 찾지 못했습니다. HTML 클론을 사용해보세요.',
    patternFailed: '패턴 감지 실패 — 사이트 복제 기능을 사용하세요',
    noDataFound: '데이터를 찾지 못했습니다. HTML 클론을 사용해보세요.',
    noDataExtracted: '추출된 데이터 없음 — 사이트 복제 기능을 사용하세요',
    analysisFailed: '분석 실패',
    cloneFailed: '클론 실패',
    emptyHtml: '빈 HTML',
    packageFailed: '패키지 생성 실패',
    rowsColsExtracted: (rows: string, cols: string) => `${rows}행 × ${cols}열 추출 완료`,
    viewDataRows: (rows: string) => `추출 데이터 보기 (${rows}행)`,
    langToggle: '한/EN',
  },
};

let currentLang = 'en';

function t(key: string, ...args: string[]): string {
  const val = i18n[currentLang]?.[key] ?? i18n['en'][key] ?? key;
  if (typeof val === 'function') return val(...args);
  return val;
}

function applyLang(lang: string): void {
  currentLang = lang;
  document.documentElement.lang = lang === 'ko' ? 'ko' : 'en';

  // data-i18n 속성으로 정적 텍스트 업데이트
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')!;
    const val = i18n[lang]?.[key];
      if (val && typeof val === 'string') el.textContent = val;
  });

  // 토글 버튼
  const $langBtn = document.getElementById('lang-toggle');
  if ($langBtn) $langBtn.textContent = t('langToggle');

  chrome.storage.local.set({ sf_lang: lang });
}

// === State ===
let currentResult: ScrapeResult | null = null;
let patterns: (DetectedPatternInfo & { columns?: { name: string; selector: string; type: string; attribute?: string }[] })[] = [];
let columns: { name: string; selector: string; type: string; attribute?: string }[] = [];
let currentPage = 1;
const PAGE_SIZE = 20;

// === DOM refs ===
const $ = (id: string) => document.getElementById(id)!;
const $sourceBar = $('source-bar');
const $sourceName = $('source-name');
const $btnAnalyze = $('btn-analyze') as HTMLButtonElement;
const $analyzeIcon = $('analyze-icon');
const $analyzeText = $('analyze-text');
const $analyzeStatus = $('analyze-status');
const $resultSection = $('result-section');
const $errorMsg = $('error-msg');

// === 원클릭 분석: 패턴 감지 → 데이터 추출 → 결과 표시 ===
async function runFullAnalysis(): Promise<void> {
  $btnAnalyze.disabled = true;
  $analyzeIcon.classList.add('spinning');
  $analyzeText.textContent = t('analyzing');
  $analyzeStatus.textContent = t('detectingPatterns');
  $errorMsg.classList.add('hidden');
  $resultSection.classList.add('hidden');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    resetAnalyzeBtn();
    return;
  }

  try {
    // Step 1: 패턴 감지
    $analyzeStatus.textContent = t('detectingPatterns');
    const detectResponse = await chrome.runtime.sendMessage({
      type: MessageType.CLONE_DETECT_PATTERNS,
      payload: { tabId: tab.id },
    }) as { patterns: (DetectedPatternInfo & { columns?: { name: string; selector: string; type: string; attribute?: string }[] })[]; error?: string };

    if (detectResponse.error && (!detectResponse.patterns || detectResponse.patterns.length === 0)) {
      showError(detectResponse.error);
      return;
    }

    patterns = detectResponse.patterns ?? [];
    const bestPattern = patterns[0];
    columns = bestPattern?.columns ?? [];

    if (columns.length === 0) {
      showError(t('noPatternFound'));
      $resultSection.classList.remove('hidden');
      $('result-info').textContent = t('patternFailed');
      return;
    }

    // Step 2: 데이터 추출
    $analyzeStatus.textContent = t('extractingData');
    const extractResponse = await chrome.runtime.sendMessage({
      type: MessageType.CLONE_EXTRACT_DATA,
      payload: {
        tabId: tab.id,
        containerSelector: bestPattern.containerSelector,
        itemSelector: bestPattern.signature.split(':')[0].toLowerCase(),
        columns,
      },
    }) as ScrapeResult;

    if (extractResponse?.rows?.length > 0) {
      currentResult = extractResponse;
      $resultSection.classList.remove('hidden');
      $('result-info').textContent = t('rowsColsExtracted', String(currentResult.rows.length), String(currentResult.columns.length));
      $('table-toggle-text').textContent = t('viewDataRows', String(currentResult.rows.length));
      renderResultTable();
      $analyzeStatus.textContent = t('analysisComplete');
    } else {
      showError(t('noDataFound'));
      $resultSection.classList.remove('hidden');
      $('result-info').textContent = t('noDataExtracted');
    }
  } catch (err) {
    showError(`${t('analysisFailed')}: ${String(err)}`);
  } finally {
    resetAnalyzeBtn();
  }
}

function resetAnalyzeBtn(): void {
  $btnAnalyze.disabled = false;
  $analyzeIcon.classList.remove('spinning');
  $analyzeText.textContent = t('analyzeSite');
}

function showError(msg: string): void {
  $errorMsg.textContent = msg;
  $errorMsg.classList.remove('hidden');
}

// === 결과 테이블 ===
function renderResultTable(): void {
  if (!currentResult) return;

  const $head = $('result-head');
  const $body = $('result-body');

  $head.textContent = '';
  const headerRow = document.createElement('tr');
  for (const col of currentResult.columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  }
  $head.appendChild(headerRow);

  const totalPages = Math.ceil(currentResult.rows.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = currentResult.rows.slice(start, start + PAGE_SIZE);

  $body.textContent = '';
  for (const row of pageRows) {
    const tr = document.createElement('tr');
    for (const col of currentResult.columns) {
      const td = document.createElement('td');
      const value = String(row[col] ?? '');
      td.title = value;
      if (value.startsWith('http://') || value.startsWith('https://')) {
        const link = document.createElement('a');
        link.href = value;
        link.textContent = value.length > 40 ? value.slice(0, 40) + '...' : value;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        td.appendChild(link);
      } else {
        td.textContent = value.length > 60 ? value.slice(0, 60) + '...' : value;
      }
      tr.appendChild(td);
    }
    $body.appendChild(tr);
  }

  if (totalPages > 1) {
    $('pagination').classList.remove('hidden');
    $('page-info').textContent = `${currentPage} / ${totalPages}`;
    ($('btn-prev') as HTMLButtonElement).disabled = currentPage <= 1;
    ($('btn-next') as HTMLButtonElement).disabled = currentPage >= totalPages;
  } else {
    $('pagination').classList.add('hidden');
  }
}

// === 데이터 내보내기 ===
document.querySelectorAll('.export-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!currentResult) return;
    const format = (btn as HTMLElement).dataset['format'] as ExportFormat;
    downloadData(currentResult, format);
  });
});

// === HTML 클론 ===
$('btn-clone-html').addEventListener('click', async () => {
  const btn = $('btn-clone-html') as HTMLButtonElement;
  btn.disabled = true;
  btn.querySelector('.dl-label')!.textContent = t('generating');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const response = await chrome.runtime.sendMessage({
      type: MessageType.CLONE_EXTRACT_ASSETS,
      payload: { tabId: tab.id },
    }) as { html: string; error?: string };

    if (response.error || !response.html) {
      alert(`${t('cloneFailed')}: ${response.error ?? t('emptyHtml')}`);
      return;
    }

    downloadBlob(response.html, 'text/html', `clone-${Date.now()}.html`);
  } finally {
    btn.disabled = false;
    btn.querySelector('.dl-label')!.textContent = t('htmlClone');
  }
});

// === 사이트 패키지 (HTML + CSS 분리 + content.json) ===
$('btn-site-package').addEventListener('click', async () => {
  const btn = $('btn-site-package') as HTMLButtonElement;
  btn.disabled = true;
  btn.querySelector('.dl-label')!.textContent = t('generating');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // 페이지에서 HTML 구조 + CSS 분리 추출
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 확장 프로그램/광고차단 주입 CSS 필터링 패턴
        const JUNK_PATTERNS = [
          'data-darkreader', 'darkreader',
          'display: none !important',
          'adsbygoogle', 'adsense', 'advert',
          '#adblock', '.adblock', '#ads-', '.ads-',
          'data-ad-', 'div-gpt-ad',
          'taboola', 'outbrain', 'zergnet',
          'sponsored', 'sponsor',
        ];

        function isJunkRule(cssText: string): boolean {
          const lower = cssText.toLowerCase();
          if (lower.includes('display: none !important') && cssText.length > 500) return true;
          if (lower.includes('darkreader')) return true;
          if (lower.includes('chrome-extension://')) return true;
          if (lower.includes('moz-extension://')) return true;
          return false;
        }

        function isJunkSheet(sheet: CSSStyleSheet): boolean {
          const href = sheet.href ?? '';
          if (href.includes('chrome-extension://')) return true;
          if (href.includes('moz-extension://')) return true;
          const owner = sheet.ownerNode as HTMLElement | null;
          if (owner?.hasAttribute('data-darkreader-mode')) return true;
          if (owner?.classList?.contains('darkreader')) return true;
          return false;
        }

        // CSS 수집 — 정크 필터링
        const cssTexts: string[] = [];
        for (const sheet of Array.from(document.styleSheets)) {
          if (isJunkSheet(sheet)) continue;
          try {
            const rules = Array.from(sheet.cssRules);
            const cleanRules = rules
              .map(r => r.cssText)
              .filter(text => !isJunkRule(text));
            if (cleanRules.length > 0) {
              const source = sheet.href ?? 'inline';
              cssTexts.push(`/* === ${source} === */\n` + cleanRules.join('\n'));
            }
          } catch {
            if (sheet.href) cssTexts.push(`@import url("${sheet.href}");`);
          }
        }

        let combinedCss = cssTexts.join('\n\n');
        combinedCss = combinedCss.replace(/@font-face\s*\{[^}]*url\([^)]*\.(woff2?|ttf|otf|eot)[^}]*\}/gi, '/* @font-face removed — use system fonts */');
        combinedCss = combinedCss.replace(
          /--vp-font-family-base:\s*[^;]+;/g,
          '--vp-font-family-base: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;'
        );
        combinedCss = combinedCss.replace(/"Inter var"[^,]*,\s*/g, '');

        // HTML 클린업
        const baseUrl = window.location.origin;
        const doc = document.documentElement.cloneNode(true) as HTMLElement;

        doc.querySelectorAll('[data-darkreader-mode], [data-darkreader-scheme], .darkreader, meta[name="darkreader"]').forEach(el => el.remove());
        doc.querySelectorAll('[id^="thunderbit"], [id^="c4g-"], #open-side-panel').forEach(el => el.remove());

        doc.querySelectorAll('[src]').forEach(el => {
          const src = el.getAttribute('src');
          if (src && !src.startsWith('http') && !src.startsWith('data:')) {
            try { el.setAttribute('src', new URL(src, baseUrl).href); } catch { /* skip */ }
          }
        });
        doc.querySelectorAll('a[href]').forEach(el => {
          const href = el.getAttribute('href');
          if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
            try { el.setAttribute('href', new URL(href, baseUrl).href); } catch { /* skip */ }
          }
        });
        doc.querySelectorAll('[srcset]').forEach(el => {
          const srcset = el.getAttribute('srcset');
          if (srcset) {
            const converted = srcset.split(',').map(part => {
              const [url, ...rest] = part.trim().split(/\s+/);
              try { return [new URL(url, baseUrl).href, ...rest].join(' '); } catch { return part; }
            }).join(', ');
            el.setAttribute('srcset', converted);
          }
        });

        doc.querySelectorAll('script, style, link[rel="stylesheet"]').forEach(el => el.remove());
        doc.querySelectorAll('[data-darkreader-inline-bgcolor], [data-darkreader-inline-color], [data-darkreader-inline-border]').forEach(el => {
          Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('data-darkreader')) el.removeAttribute(attr.name);
          });
        });

        const head = doc.querySelector('head');
        if (head) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'style.css';
          head.prepend(link);
        }

        const navLinks: { title: string; url: string }[] = [];
        doc.querySelectorAll('nav a, aside a, [class*="sidebar"] a, [class*="menu"] a').forEach(a => {
          const title = (a.textContent ?? '').trim();
          const url = a.getAttribute('href') ?? '';
          if (title && url) navLinks.push({ title, url });
        });

        const sections: { title: string; content: string; images: string[]; links: string[] }[] = [];
        doc.querySelectorAll('h1, h2, h3').forEach(heading => {
          const title = (heading.textContent ?? '').trim();
          const images: string[] = [];
          const links: string[] = [];
          let content = '';

          let sibling = heading.nextElementSibling;
          while (sibling && !/^H[1-3]$/.test(sibling.tagName)) {
            content += (sibling.textContent ?? '').trim() + '\n';
            sibling.querySelectorAll('img').forEach(img => {
              const src = img.getAttribute('src');
              if (src) images.push(src);
            });
            sibling.querySelectorAll('a[href]').forEach(a => {
              const href = a.getAttribute('href');
              if (href && href.startsWith('http')) links.push(href);
            });
            sibling = sibling.nextElementSibling;
          }

          if (title) sections.push({ title, content: content.trim(), images, links });
        });

        return {
          html: `<!DOCTYPE html>\n${doc.outerHTML}`,
          css: combinedCss,
          nav: navLinks,
          sections,
          meta: { title: document.title, url: window.location.href, description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '' },
        };
      },
    });

    const pkg = result?.result as {
      html: string; css: string;
      nav: { title: string; url: string }[];
      sections: { title: string; content: string; images: string[]; links: string[] }[];
      meta: { title: string; url: string; description: string };
    } | undefined;

    if (!pkg) {
      alert(t('packageFailed'));
      return;
    }

    const contentJson = JSON.stringify({
      meta: pkg.meta,
      navigation: pkg.nav,
      sections: pkg.sections,
      extractedData: currentResult ? { columns: currentResult.columns, rows: currentResult.rows } : null,
    }, null, 2);

    const readme = `# ScrapeFlow Site Package

## Source: ${pkg.meta.title}
- URL: ${pkg.meta.url}
- Extracted: ${new Date().toISOString().slice(0, 10)}

## File Structure
- \`index.html\` — Page structure (references style.css)
- \`style.css\` — Separated stylesheet (customize colors, fonts, etc.)
- \`content.json\` — Extracted content data
  - \`meta\` — Page metadata
  - \`navigation\` — Navigation link list
  - \`sections\` — Content sections (title, content, images, links)
  - \`extractedData\` — Pattern-based extracted data (table format)

## Customization Guide
1. Edit colors/fonts/layout in \`style.css\`
2. Replace data in \`content.json\` with your content
3. Adjust structure in \`index.html\`
4. Preview locally, then deploy

Generated by ScrapeFlow
`;

    downloadBlob(pkg.html, 'text/html', 'index.html');
    setTimeout(() => downloadBlob(pkg.css, 'text/css', 'style.css'), 300);
    setTimeout(() => downloadBlob(contentJson, 'application/json', 'content.json'), 600);
    setTimeout(() => downloadBlob(readme, 'text/markdown', 'README.md'), 900);

  } finally {
    btn.disabled = false;
    btn.querySelector('.dl-label')!.textContent = t('sitePackage');
  }
});

// === 유틸리티 ===
function downloadBlob(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// === 페이지네이션 ===
$('btn-prev').addEventListener('click', () => {
  if (currentPage > 1) { currentPage--; renderResultTable(); }
});
$('btn-next').addEventListener('click', () => {
  if (currentResult && currentPage < Math.ceil(currentResult.rows.length / PAGE_SIZE)) {
    currentPage++; renderResultTable();
  }
});

// === 이벤트 ===
$btnAnalyze.addEventListener('click', runFullAnalysis);

// === 언어 토글 ===
document.getElementById('lang-toggle')!.addEventListener('click', () => {
  applyLang(currentLang === 'ko' ? 'en' : 'ko');
});

// === Init ===
async function init(): Promise<void> {
  // 저장된 언어 설정 복원
  const stored = await chrome.storage.local.get(['sf_lang']);
  if (stored['sf_lang']) {
    applyLang(stored['sf_lang'] as string);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    $sourceName.textContent = tab.title ?? '';
    $sourceBar.classList.remove('hidden');
  }
}

init();
