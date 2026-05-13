# ScrapeFlow

Thunderbit 벤치마킹 기반 웹 스크래퍼 Chrome Extension. **순수 DOM 분석 기반**으로 데이터 추출, 다중 형식 내보내기, 풀 페이지 캡처를 지원한다. AI 기능은 v0.2.0에서 완전히 제거됨 (아래 "사고 이력" 참조).

## 규칙

- 항상 한국어로 응답할 것
- 코드 주석은 한국어로 작성

## 기술 스택

- Chrome Extension: Manifest V3, TypeScript, Vite + CRXJS Plugin
- 데이터 추출: 순수 DOM 분석 (테이블/리스트/카드/dl 감지 + Sibling Signature Matching)
- 캡처: Chrome DevTools Protocol (우선) + 스크롤 스티칭 (폴백)
- 테스트: Vitest (unit, jsdom)
- **외부 API 호출 없음** — 모든 처리는 브라우저 내부에서 완료

## 현재 버전

- manifest: **v0.3.0** (2026-05-12 AI 코드 전면 제거 후 재빌드)
- Chrome Web Store ID: `lpmffcafghlgeicmcidpfngnldknglcf`
- 배포 zip: `extension/scrapeflow-v0.3.0.zip`

## 프로젝트 구조

```
extension/
├── src/
│   ├── popup/           # Extension 팝업 UI (스크래핑/캡처/AI/설정)
│   ├── sidepanel/       # Side Panel (결과 테이블, 히스토리, 내보내기)
│   ├── content/
│   │   ├── scraper.ts          # DOM 파싱 (테이블/리스트/카드/dl 감지)
│   │   ├── selector.ts         # 요소 선택 UI (호버 하이라이트, CSS 셀렉터 생성)
│   │   ├── pattern-detector.ts # 범용 반복 패턴 감지 (Sibling Signature Matching, AI 없이 구조 분석)
│   │   └── asset-extractor.ts  # 사이트 에셋 추출 (CSS, 이미지, 폰트, 팔레트)
│   ├── background/
│   │   └── service-worker.ts  # 메시지 라우팅, CDP 캡처, AI 스크래핑
│   ├── lib/
│   │   ├── types.ts    # MessageType enum, 에러 타입, 공유 인터페이스
│   │   ├── export.ts   # ExportStrategy (JSON/CSV/HTML)
│   │   └── storage.ts  # chrome.storage 래퍼
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
npx tsc --noEmit   # 타입 체크만 수행 (빌드 없이)
```

## 테스트

Chrome Extension 로컬 로드: `chrome://extensions` → 개발자 모드 → `extension/dist` 폴더 로드

## 🚨 보안: 외부 API 호출 금지 — 최우선 규칙

> **2026-03~05 사고 비용: USD 47.96** — v0.1.0이 Vite `define`으로 `.env`의 Anthropic 키를 dist 번들에 평문 인라인. 배포된 CRX에서 누군가 키를 추출해 1.5개월간 자동 호출. v0.2.0에서 AI 기능 자체를 완전히 제거하여 근본 원인 차단. 회고: [.claude/docs/incident-2026-05-12-api-key-leak.md](.claude/docs/incident-2026-05-12-api-key-leak.md)

### 🟥 사고의 결정적 교훈

UI에서 AI 버튼을 제거(`f658eb5`, `31fb9f8`)했지만 `lib/ai.ts`와 `service-worker.ts`의 라우터, popup 설정 패널의 키 입력란을 살려둔 것이 사고의 본질이다. **사용자에게 안 보이는 코드 경로도 빌드 결과물에 들어가면 공격면이 된다.** UI에서 기능을 빼면 코드도 같은 PR에서 함께 죽여라. "혹시 나중에 쓸지 모르니"는 안전을 비용으로 치환하는 자기 기만이다.

### 🔴 절대 금지 (AI가 코드 제안 시 멈출 신호)

이 확장은 **클라이언트 코드**이며, **외부 API 호출이 일절 없도록 v0.2.0에서 재설계됐다.** 다음 패턴이 코드/제안에 나타나면 **즉시 멈추고 사용자에게 보고할 것**:

| 금지 패턴 | 이유 |
|---|---|
| `fetch('https://api.anthropic.com/...')` 또는 임의 외부 API 호출 추가 | 키를 어디 둘 거든 클라이언트 코드는 분해 가능 |
| `lib/ai.ts` 같은 AI 클라이언트 모듈 재도입 | 사고 원인 재현 |
| popup/sidepanel에 "API Key" 입력란 추가 | UI에 키 입력란이 있다는 건 어디선가 키를 쓴다는 뜻 |
| `host_permissions`에 외부 API 도메인 추가 | 호출 의도의 명백한 신호 |
| `MessageType`에 `SCRAPE_AI`/`INFER_*` 같은 AI 라우팅 추가 | 동상 |

새로운 AI 기능을 진짜 추가해야 한다면 **백엔드 프록시 + 사용자별 인증 + 사용량 제한**이 전제다. 그 전엔 거부.

### 🔴 클라이언트 시크릿 인라인 금지 (외부 API가 다시 추가될 경우)

| 금지 패턴 | 이유 | 올바른 대안 |
|---|---|---|
| `vite.config.*`의 `define: { __KEY__: ... }` | 빌드 시 번들에 평문 인라인 | `chrome.storage.sync`에서 사용자 입력 키 로드 |
| `loadEnv()` 호출 후 결과를 `define`/`process.env`로 노출 | 위와 동일 | `.env`는 서버용에만 사용 |
| `declare const __ANY_KEY__: string;` | `define`과 짝을 이루는 빌드 타임 상수 | 제거 |
| `BUILD_TIME_KEY` / `DEFAULT_API_KEY` / `FALLBACK_KEY` 같은 폴백 | 사용자 키 없을 때 개발자 키로 폴백 = 누구나 사용 가능 | 키 없으면 `throw new Error('API_KEY_NOT_SET')` |
| 코드/주석/테스트/`.claude/settings.local.json`에 `sk-ant-api03-` 또는 `sk-proj-` 실제 prefix | 평문 시크릿 | `sk-ant-test-key` 같은 명백한 더미 또는 mock |
| `host_permissions: ["http://*", "https://*"]` 없이 fetch 호출 차단되는 워크어라운드로 키를 백엔드 없이 노출 | 아키텍처 미스 | 본인 키 입력 방식 유지 |
| `.env` 파일을 `dist/`, `*.zip`, git에 포함 | 직접 유출 | `.gitignore` 확인, `.env`는 로컬 전용 |

### ✅ 현재 상태 (v0.2.0)

- `extension/src/lib/ai.ts` — **삭제됨**
- `extension/src/lib/export-nextjs.ts` — **삭제됨** (AI 결과 의존 + 죽은 코드였음)
- `extension/src/__tests__/ai.test.ts` — **삭제됨**
- `service-worker.ts`의 `handleAiScrape` + `SCRAPE_START` 라우터 — **삭제됨**
- popup의 "Claude API Key" 입력 패널 — **삭제됨**
- `MessageType.SCRAPE_START`는 `content/scraper.ts`(DOM 추출 트리거)에서만 사용
- 외부 fetch 호출 0건, `chrome.storage.sync`에 키 저장 없음

### 🔒 코드 수정 시 강제 체크 (AI 셀프-가드)

이 프로젝트 코드를 수정할 때 다음 중 하나라도 만지면 **수정 후 반드시 위 "절대 금지" 표와 대조하고 결과를 사용자에게 보고**:

- `extension/vite.config.ts`
- `extension/src/manifest.json`의 `host_permissions` 또는 `content_security_policy`
- `.env` 또는 `.env.example`
- `package.json`의 build script / dependencies (특히 `@anthropic-ai/*`, `openai` 같은 LLM SDK)
- 새로운 `*.config.ts` 추가
- popup/sidepanel에 입력 폼 추가 (특히 `type="password"`)
- **UI에서 기능을 제거하는 PR**: 같은 PR에서 백엔드 코드도 죽였는지 검증 (사고의 본질)

### 배포 전 체크리스트 (모든 항목 통과해야 Web Store 업로드)

```bash
# 1. dist에 시크릿/AI 흔적 0건 — v0.2.0 이후 항상 무출력이어야 함
grep -rE "sk-ant|sk-proj|anthropic|x-api-key|__CLAUDE_API_KEY__|BUILD_TIME_KEY|inferDataStructure|inferCloneStructure" extension/dist/

# 2. zip 패키지 내부도 스캔
unzip -p extension/*.zip "*.js" | grep -E "sk-ant|sk-proj|anthropic"

# 3. vite.config.ts에 define 블록 없는지
grep -n "define" extension/vite.config.ts   # `defineConfig` import만 보여야 함

# 4. manifest 버전 증가 확인 (Web Store는 같은 버전 거부)
grep version extension/src/manifest.json

# 5. 타입체크 + 테스트
cd extension && npx tsc --noEmit && npx vitest run
```

체크리스트:
- [ ] 위 5개 명령 전부 통과 (1번 무출력, 2번 무출력, 3번 import만, 5번 17/17 통과)
- [ ] `extension/package.json`과 `manifest.json`의 version 일치
- [ ] manifest의 `host_permissions`에 외부 API 도메인 없는지 (`<all_urls>`만 허용 — 페이지 DOM 접근용)
- [ ] popup/sidepanel HTML에 `<input type="password">` 또는 "API Key" 문자열 없는지

## 사고 이력

### 2026-03~05: Anthropic API 키 유출 — USD 47.96 손실

- **범인 키**: `web_scrapeflow` (`sk-ant-api03-fhR...CQAA`) — 비활성화 완료
- **유출 경로**: `extension/vite.config.ts`의 `define: { __CLAUDE_API_KEY__: env.CLAUDE_API_KEY }` → dist JS 번들에 평문 인라인 → `extension/src/lib/ai.ts`의 `BUILD_TIME_KEY` 폴백이 storage 키 없을 때 사용
- **타임라인**: 2026-03-27 키 생성 → 2026-03-29 commit `508fda9`로 dist 빌드/배포 → 2026-05-11까지 외부 자동화 호출 → 2026-05-12 사용자 인지 → 같은 날 v0.2.0 패치 배포
- **현재**: 키 revoke 완료, v0.2.0이 Chrome Web Store 심사 대기 중
- **회고**: [.claude/docs/incident-2026-05-12-api-key-leak.md](.claude/docs/incident-2026-05-12-api-key-leak.md)
- **조사 plan**: [.claude/plans/incident-2026-05-12-api-key-leak-investigation.md](.claude/plans/incident-2026-05-12-api-key-leak-investigation.md)
- **근본 차단 (2026-05-12 추가)**: AI 기능 자체를 코드베이스에서 완전 제거. `lib/ai.ts`/`export-nextjs.ts`/`ai.test.ts` 파일 삭제, `handleAiScrape` 라우터 제거, popup의 API Key 입력 패널 제거. 외부 API 호출 0건 상태로 회귀.
- **교훈**: ① "확장 프로그램은 서버가 아니다" — 클라이언트 코드에 시크릿을 박지 말 것. ② "UI에서 빼면 코드도 죽여라" — 미사용 코드도 빌드 결과물에 들어가면 공격면이 된다. 위 "🚨 보안" 섹션 참조.

## 수정 이력

| 날짜 | 파일 | 변경 내용 |
|------|------|----------|
| 2026-05-12 | `extension/vite.config.ts` | `define` 블록 제거, `loadEnv` 호출 제거 — 빌드 타임 키 주입 폐기 |
| 2026-05-12 | `extension/src/lib/ai.ts` | `__CLAUDE_API_KEY__` 선언 + `BUILD_TIME_KEY` 폴백 제거 — storage 키만 사용 |
| 2026-05-12 | `extension/src/popup/popup.html` | 사용자 키 입력 안내 + Anthropic 콘솔 링크 추가 |
| 2026-05-12 | `extension/src/manifest.json` | 버전 0.1.0 → 0.2.0 (보안 패치) |
| 2026-05-12 | `CLAUDE.md` | 프로젝트 구조에 누락 파일 3개(`pattern-detector.ts`, `asset-extractor.ts`, `export-nextjs.ts`) 추가, `npx tsc --noEmit` 명령어 노출 |
| 2026-05-12 | `CLAUDE.md` | 🚨 보안 섹션 강화 — 금지 패턴 표, AI 셀프-가드 규칙, 배포 전 시크릿 스캔 명령어 추가 (USD 47.96 사고 재발 방지) |
| 2026-05-12 | `extension/src/lib/ai.ts`, `export-nextjs.ts`, `__tests__/ai.test.ts` | 파일 전체 삭제 — AI 기능 코드베이스에서 근본 제거 |
| 2026-05-12 | `extension/src/background/service-worker.ts` | `inferDataStructure` import + `SCRAPE_START` 라우팅 + `handleAiScrape()` 함수 제거 |
| 2026-05-12 | `extension/src/popup/popup.html`, `popup.ts` | 설정 패널(API Key 입력란/Save 버튼/Settings 푸터 버튼) 제거, `AI` 뱃지 제거, 버전 표기 v0.1.0 → v0.2.0, 관련 i18n 키 제거 |
| 2026-05-12 | `extension/src/lib/types.ts`, `__tests__/types.test.ts` | `AICloneResult`/`AICloneColumn`/`AI_API_FAILED` 제거 |
| 2026-05-12 | `CLAUDE.md` | "AI 웹 스크래퍼" → "웹 스크래퍼" 재정의, 기술 스택에서 Claude API 제거, 보안 섹션 v2 — "UI에서 빼면 코드도 죽여라" 교훈 명문화 |
| 2026-05-12 | `extension/package.json` | 버전 0.1.0 → 0.2.0 (manifest와 정렬) |
| 2026-05-12 | `manifest.json`, `package.json`, `popup.html` | 버전 0.2.0 → 0.3.0 (AI 제거 후 재빌드용 — 이전 v0.2.0 zip은 보안 패치만 반영되어 AI 코드 잔존) |
