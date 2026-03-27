# ScrapeFlow MVP Plan

## Problem Statement

Thunderbit(thunderbit.com)과 유사한 웹 스크래핑 도구를 만든다. Chrome Extension + 웹 대시보드로 구성된다.
사용자가 어떤 웹페이지에서든 데이터를 추출하고, 다양한 형식(JSON, CSV, HTML)으로 저장하며,
추가로 풀 페이지 스크린캡처와 다운로드한 데이터를 이용한 사이트 재생성 기능을 제공한다.

## 벤치마크 대상: Thunderbit

### Thunderbit 핵심 기능
1. **AI 웹 스크래핑** — 2클릭으로 웹페이지 데이터 테이블 추출
2. **자연어 컬럼 정의** — CSS 셀렉터 대신 "이름, 가격, 평점" 같은 자연어로 데이터 구조 지정
3. **다중 소스** — 웹페이지, PDF, 이미지, 문서
4. **서브페이지 크롤링** — 링크된 하위 페이지 자동 방문 및 데이터 추출
5. **데이터 내보내기** — Google Sheets, Airtable, Notion, JSON, CSV
6. **데이터 가공** — 요약, 분류, 번역, 포맷 변환
7. **프리빌트 템플릿** — 인기 사이트(Amazon, eBay 등)용 1클릭 스크래퍼

### ScrapeFlow 차별화 기능
1. **풀 페이지 스크린캡처** — 보이는 뷰포트가 아닌 전체 스크롤 길이의 페이지를 PNG/PDF로 캡처
2. **사이트 재생성** — 다운로드한 JSON/HTML 데이터를 이용해 유사한 구조의 사이트를 자동 생성

## Architecture

### 기술 스택 (리뷰 후 확정)
- **Chrome Extension**: Manifest V3, TypeScript, **Vite + CRXJS Plugin**
- **테스트**: Vitest (unit) + Playwright (E2E)
- **AI**: Claude API (@anthropic-ai/sdk, 데이터 구조 추론)
- **캡처**: Chrome DevTools Protocol (우선) + 스크롤 스티칭 (폴백)
- ~~웹 대시보드: Next.js 15~~ → Phase 2로 연기
- ~~데이터베이스: Supabase~~ → Phase 2로 연기

### 시스템 구성도
```
[Chrome Extension]
    ├── Popup UI (스크래핑 설정, 미리보기)
    ├── Content Script (페이지 DOM 접근, 데이터 추출)
    ├── Background Service Worker (상태 관리, API 통신)
    └── Side Panel (결과 표시, 내보내기)

[웹 대시보드]
    ├── 스크래핑 결과 관리
    ├── 템플릿 라이브러리
    ├── 사이트 재생성 도구
    └── 설정 & 계정 관리

[백엔드]
    ├── /api/scrape — 스크래핑 작업 실행
    ├── /api/capture — 풀 페이지 캡처
    ├── /api/export — 데이터 내보내기
    ├── /api/generate — 사이트 재생성
    └── /api/templates — 템플릿 CRUD
```

## MVP Scope (Phase 1)

### 핵심 기능 (Must Have)
1. **Chrome Extension 기본 구조**
   - Manifest V3 설정
   - Popup UI (스크래핑 시작 버튼, 기본 설정)
   - Content Script (DOM 파싱, 데이터 추출)
   - Side Panel (결과 표시)

2. **웹 데이터 스크래핑**
   - 테이블 형태 데이터 자동 감지 및 추출
   - 사용자 정의 셀렉터로 커스텀 추출
   - 자연어로 원하는 데이터 컬럼 정의 (AI 연동)

3. **데이터 내보내기**
   - JSON 다운로드
   - CSV 다운로드
   - HTML 테이블 다운로드
   - 클립보드 복사

4. **풀 페이지 스크린캡처**
   - 전체 스크롤 길이 캡처 (Chrome Extension captureVisibleTab + 스크롤 스티칭)
   - PNG 저장
   - PDF 저장
   - 캡처 영역 선택 (선택적)

### 확장 기능 (Phase 2)
5. **서브페이지 크롤링**
6. **사이트 재생성 도구** — HTML/JSON 데이터로 유사 사이트 자동 생성
7. **웹 대시보드** — 결과 관리, 히스토리
8. **프리빌트 템플릿**
9. **Google Sheets / Airtable 직접 내보내기**

## 파일 구조 (MVP)

```
web_ScrapeFlow/
├── extension/                    # Chrome Extension
│   ├── manifest.json             # Manifest V3
│   ├── src/
│   │   ├── popup/                # Extension 팝업 UI
│   │   │   ├── popup.html
│   │   │   ├── popup.ts
│   │   │   └── popup.css
│   │   ├── sidepanel/            # Side Panel UI
│   │   │   ├── sidepanel.html
│   │   │   ├── sidepanel.ts
│   │   │   └── sidepanel.css
│   │   ├── content/              # Content Scripts
│   │   │   ├── scraper.ts        # 데이터 추출 로직
│   │   │   ├── capture.ts        # 풀 페이지 캡처
│   │   │   └── selector.ts       # 요소 선택 UI
│   │   ├── background/           # Service Worker
│   │   │   └── service-worker.ts
│   │   ├── lib/                  # 공유 라이브러리
│   │   │   ├── types.ts
│   │   │   ├── storage.ts
│   │   │   └── export.ts
│   │   └── assets/               # 아이콘, 이미지
│   ├── vite.config.ts            # Vite + CRXJS
│   ├── tsconfig.json
│   └── package.json
├── web/                          # 웹 대시보드 (Phase 2)
├── CLAUDE.md
└── package.json
```

## 풀 페이지 스크린캡처 구현 전략 (리뷰 후 확정)

### 주 접근: Chrome DevTools Protocol (CDP)
1. `chrome.debugger.attach(tabId, "1.3")` — 디버거 연결
2. `Page.captureScreenshot({ captureBeyondViewport: true, clip: { x, y, width, height, scale } })` — 전체 페이지 캡처
3. Base64 → Blob → download
4. `chrome.debugger.detach(tabId)` — 디버거 해제

**장점:** fixed/sticky 중복 없음, lazy-load 자동 처리, 단일 API 호출
**권한:** `"debugger"` 권한 manifest에 추가 필요

### 폴백: 스크롤 스티칭 (CDP 불가 시)
- chrome:// 페이지, 디버거 attach 거부 페이지 대응
- `captureVisibleTab` + 스크롤 + Canvas 스티칭
- fixed/sticky 요소는 첫 캡처에만 포함, 이후 CSS로 숨김

### 크기 제한
- Chrome Canvas 최대: 32767 x 32767 px
- 초과 시 분할 캡처 + 별도 파일 저장
- PDF 내보내기 시 jsPDF로 멀티페이지

## 사이트 재생성 구현 전략 (Phase 2)

### 접근 방식
1. 스크래핑한 HTML 구조 + CSS + 이미지 자산 저장
2. AI가 HTML 구조를 분석하여 컴포넌트화
3. 템플릿 엔진으로 재생성 가능한 구조로 변환
4. 사용자가 데이터만 바꿔서 유사 사이트 생성

## 개발 순서 (1주 MVP, CC+gstack 압축)

### Day 1: Extension 기본 구조 + 빌드
- [ ] Vite + CRXJS + TypeScript 설정
- [ ] Manifest V3 작성 (permissions: activeTab, debugger, storage, sidePanel)
- [ ] Popup UI 기본 레이아웃 (페이지 미리보기 + 시작 버튼)
- [ ] Content Script 주입 확인
- [ ] Side Panel 기본 설정
- [ ] Background Service Worker 메시지 라우팅 (MessageType enum)

### Day 2: 데이터 스크래핑 핵심
- [ ] DOM 파싱 및 테이블/리스트/카드 데이터 자동 감지
- [ ] 사용자 요소 선택 UI (클릭으로 셀렉터 생성, 하이라이트)
- [ ] 추출 데이터 미리보기 (Side Panel)
- [ ] 빈 상태 / 첫 사용 온보딩 UI

### Day 3: 내보내기 + AI 연동
- [ ] ExportStrategy 인터페이스 + JSON/CSV/HTML 구현
- [ ] 클립보드 복사
- [ ] Claude API 연동 (자연어 → 데이터 구조 추론)
- [ ] AI 실패 시 수동 컬럼 정의 폴백

### Day 4: 풀 페이지 캡처
- [ ] CDP `Page.captureScreenshot` 구현 (주 방식)
- [ ] 스크롤 스티칭 폴백 구현
- [ ] PNG/PDF 저장 (jsPDF for PDF)
- [ ] 프로그레스 바 UI

### Day 5: 테스트 + 폴리시
- [ ] Vitest 유닛 테스트 (스크래핑, 내보내기, 메시지 라우팅)
- [ ] 키보드 내비게이션 + ARIA labels
- [ ] 에러 핸들링 정리 (ScrapeError, CaptureError, ExportError)
- [ ] Chrome Extension 로컬 로드 테스트

## 검증 방법

1. Chrome Extension을 로컬에서 로드하여 테스트
2. 다양한 웹사이트에서 데이터 추출 테스트 (테이블, 리스트, 카드 형태)
3. 내보내기 형식별 데이터 정합성 확인
4. 풀 페이지 캡처 결과물 확인 (긴 페이지, lazy-load 페이지)
5. gstack /qa로 자동화 QA 테스트

---

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|
| 1 | CEO | Extension Only MVP (대시보드 Phase 2로 연기) | P5 (explicit) | 1인 개발 MVP에서 대시보드는 오버엔지니어링 | Extension + Dashboard 동시 개발 |
| 2 | CEO | Webpack → Vite + CRXJS | P3 (pragmatic) | 더 빠른 빌드, HMR, 현대적 | Webpack 유지 |
| 3 | CEO | 스크롤 스티칭 → CDP 우선 (스티칭 폴백) | P1 (completeness) | CDP가 더 안정적 + 폴백으로 완전성 확보 | CDP만 또는 스티칭만 |
| 4 | CEO | 4주 → 1주 압축 | P6 (action) | CC+gstack으로 30x 압축 가능 | 원래 4주 유지 |
| 5 | CEO | SELECTIVE EXPANSION 모드 | P1+P3 | 현재 스코프 유지 + 개선 기회 체리픽 | SCOPE EXPANSION |
| 6 | Design | 빈 상태 디자인 추가 | P1 (completeness) | 첫 사용자 UX에 필수 | 빈 상태 무시 |
| 7 | Design | Popup에 페이지 미리보기 추가 | P1 | "2클릭" UX의 핵심 - 무엇을 스크래핑하는지 보여줘야 함 | 미리보기 없이 시작 버튼만 |
| 8 | Design | keyboard nav + ARIA labels 추가 | P1 | 접근성은 MVP에서도 필수 | 접근성 나중에 |
| 9 | Design | 프로그레스 바 + 결과 카운트 | P1 | 사용자 신뢰 구축에 필수 | 로딩 없이 결과만 표시 |
| 10 | Eng | ExportStrategy 인터페이스 | P4 (DRY) | JSON/CSV/HTML 내보내기 공통화 | 각각 별도 구현 |
| 11 | Eng | 메시지 타입 enum 정의 | P5 (explicit) | SW 내부 라우팅 명확화 | 문자열 리터럴 |
| 12 | Eng | Vitest + Playwright 테스트 | P1 | 완전한 커버리지 목표 | 테스트 나중에 |
| 13 | Eng | CDP 폴백으로 스크롤 스티칭 유지 | P1 | chrome:// 등 CDP 불가 페이지 대응 | 폴백 없음 |

### TASTE Decisions (사용자 결정 필요)

**TASTE #1: 디자인 시스템 타이밍**
- 추천: 구현 시작 시 `/design-consultation`으로 정의 (지금은 아님)
- 대안: MVP 전에 DESIGN.md 생성
- 영향: 지금 하면 +30분, 나중에 하면 리팩토링 가능성
