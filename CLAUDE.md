# ScrapeFlow

Thunderbit 벤치마킹 기반 AI 웹 스크래퍼 Chrome Extension. 데이터 추출, 다중 형식 내보내기, 풀 페이지 캡처를 지원한다.

## 규칙

- 항상 한국어로 응답할 것
- 코드 주석은 한국어로 작성

## 기술 스택

- Chrome Extension: Manifest V3, TypeScript, Vite + CRXJS Plugin
- AI: Claude API (@anthropic-ai/sdk, Haiku 모델)
- 캡처: Chrome DevTools Protocol (우선) + 스크롤 스티칭 (폴백)
- 테스트: Vitest (unit, jsdom)

## 프로젝트 구조

```
extension/
├── src/
│   ├── popup/           # Extension 팝업 UI (스크래핑/캡처/AI/설정)
│   ├── sidepanel/       # Side Panel (결과 테이블, 히스토리, 내보내기)
│   ├── content/
│   │   ├── scraper.ts   # DOM 파싱 (테이블/리스트/카드/dl 감지)
│   │   └── selector.ts  # 요소 선택 UI (호버 하이라이트, CSS 셀렉터 생성)
│   ├── background/
│   │   └── service-worker.ts  # 메시지 라우팅, CDP 캡처, AI 스크래핑
│   ├── lib/
│   │   ├── types.ts     # MessageType enum, 에러 타입, 공유 인터페이스
│   │   ├── export.ts    # ExportStrategy (JSON/CSV/HTML)
│   │   ├── storage.ts   # chrome.storage 래퍼
│   │   └── ai.ts        # Claude API 연동 (자연어 → CSS 셀렉터)
│   ├── assets/          # 아이콘
│   └── __tests__/       # Vitest 테스트
├── vite.config.ts
├── vitest.config.ts
└── tsconfig.json
```

## 개발 명령어

```bash
cd extension
npm run dev        # Vite dev server (HMR)
npm run build      # 프로덕션 빌드 → dist/
npm run test       # Vitest 실행
npm run test:watch # Vitest watch 모드
```

## 테스트

Chrome Extension 로컬 로드: `chrome://extensions` → 개발자 모드 → `extension/dist` 폴더 로드
