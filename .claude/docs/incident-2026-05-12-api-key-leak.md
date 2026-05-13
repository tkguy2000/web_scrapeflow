# Incident — Anthropic API 키 유출로 USD 47.96 무단 사용

- **발생 시점**: 2026-03-27 (키 생성) ~ 2026-05-11 (마지막 외부 호출)
- **인지 시점**: 2026-05-12, console.anthropic.com 잔액 확인 중
- **피해 규모**: USD 47.96 누적 청구
- **영향 받은 키**: `web_scrapeflow` (`sk-ant-api03-fhR...CQAA`)
- **현재 상태**: 키 비활성화 완료, 출혈 멈춤
- **분류**: 시크릿 유출 / 클라이언트 측 번들 노출

---

## 한 줄 요약

Vite `define`을 통해 `.env`의 Anthropic API 키가 Chrome 확장 dist 번들에 평문으로 인라인되어, 배포된 확장에서 누구나 키를 추출할 수 있었고 외부에서 자동화로 호출당했다.

---

## 무엇이 일어났나

1. `extension/vite.config.ts:11-13`이 빌드 시 `.env`의 `CLAUDE_API_KEY`를 `__CLAUDE_API_KEY__` 전역 상수로 정의해 번들에 인라인.
2. `extension/src/lib/ai.ts`의 `getApiKey()`가 `chrome.storage.sync`에 사용자 입력 키가 없으면 `BUILD_TIME_KEY`를 폴백으로 반환.
3. 2026-03-29 commit `508fda9` "Chrome Web Store 배포 준비"로 dist 빌드.
4. 배포된 dist의 JS 파일에는 키가 평문으로 박혀있어, 확장을 설치한 누구라도 또는 CRX를 다운받아 압축 해제한 누구라도 키를 추출 가능.
5. 어떤 사용자가 키를 추출 → Anthropic API에 자신의 용도로 호출 → 2026-05-11까지 누적 $47.96.

---

## 어떻게 발견했나

- 사용자가 console.anthropic.com → Settings → Usage에서 잔액이 하루 사이 줄어든 것을 발견.
- 키별 사용량 화면에서 `web_scrapeflow` 키 한 줄이 $47.96으로 가장 위에 표시.
- 마지막 사용일 2026-05-11이 사용자 본인의 활동 패턴과 맞지 않아 외부 호출로 판단.

---

## 왜 일어났나 (근본 원인)

**클라이언트 측 코드(브라우저 확장)에 직접 시크릿을 박는 아키텍처를 채택했다.** Anthropic API 키는 서버 사이드에서만 사용해야 한다는 원칙을 어겼다.

**유발 요인**:
- 확장 개발 초기에 빠르게 동작 확인을 위해 `.env` → `define` 인라인 방식 사용
- 정식 배포 전에 이 폴백을 제거하지 않고 그대로 빌드/배포
- Code review나 배포 체크리스트에 "클라이언트 번들에 시크릿 없는지 확인" 항목 부재

---

## 무엇이 잘 되었나

- `.gitignore`가 `.env`를 정상 차단 → GitHub 직접 유출은 막혔음
- `chrome.storage.sync` 기반 사용자 키 입력 경로도 함께 구현되어 있었음 (단지 폴백이 위험했을 뿐, 폴백만 제거하면 정상 동작 가능)
- 누적 청구액이 $47.96에서 그쳤음 (Anthropic 결제 한도 / 잔액 한도가 있었던 듯, 만약 무제한 자동 충전이었다면 훨씬 컸을 수 있음)

---

## 무엇이 잘못 되었나

- 클라이언트 번들에 시크릿이 들어가도 빌드/배포 파이프라인에서 차단되지 않았다.
- Anthropic 콘솔에서 키별 사용량 알림이 설정돼 있지 않아 1.5개월 동안 누적된 후에야 발견.
- 같은 머신의 다른 프로젝트(`web_service/.claude/settings.local.json`)에도 다른 Anthropic 키가 curl 명령 안에 평문으로 박혀있었음 — 이번 사고와는 무관하지만 같은 종류의 위생 문제.

---

## 조치 항목

### 완료
- [x] `web_scrapeflow` 키 Anthropic 콘솔에서 revoke
- [x] 유출 경로 진단 (Vite define + Chrome 확장 클라이언트 평문 인라인 확인)
- [x] git 히스토리 sk-ant- 검색 → 실제 키 노출 없음 확인
- [x] `extension/vite.config.ts`의 `define` 블록 제거
- [x] `extension/src/lib/ai.ts`의 `__CLAUDE_API_KEY__` 선언과 `BUILD_TIME_KEY` 분기 제거
- [x] `extension/src/popup/popup.html`에 사용자 키 입력 안내 + Anthropic 콘솔 링크 추가
- [x] `manifest.json` 버전 0.1.0 → 0.2.0 업데이트
- [x] v0.2.0 빌드 + `scrapeflow-v0.2.0.zip` 패키징 (dist에 sk-ant-/__CLAUDE_API_KEY__ 잔존 0건 검증)
- [x] tsc / vitest(20개 테스트) 통과 확인
- [x] **Chrome Web Store에 v0.2.0 업로드 완료 (2026-05-12)** — 심사 대기 중
- [x] `web_service/.claude/settings.local.json`의 평문 Anthropic 키 2개 + Supabase service_role JWT 제거

### 심사 대기 중 / 후속
- [ ] Chrome Web Store 심사 통과 확인 (보통 1-3일)
- [ ] 심사 통과 후 기존 사용자에게 v0.2.0 자동 배포 확인
- [ ] (선택) Anthropic 콘솔에서 자동 충전(auto-recharge) 해제 또는 키별 사용량 알림 임계치 설정

### 권장
- [ ] 다른 프로젝트의 `vite.config.*`, `next.config.*`, `webpack.config.*`에서 Anthropic 키를 클라이언트 번들에 주입하는 `define`/`NEXT_PUBLIC_*` 패턴 검색
- [ ] `contentflow-chrome-extension.zip`도 같은 패턴인지 점검
- [ ] Anthropic 콘솔에서 키별 사용량 알림 (예: $5 도달 시 이메일) 설정
- [ ] 잔액 자동 충전(auto-recharge)을 꺼두고 수동 충전으로 전환

---

## 재발 방지 체크리스트

새 프로젝트나 배포 전에 다음을 확인:

### 시크릿 위치
- [ ] `.env`의 변수가 클라이언트 번들에 들어가는 경로가 있는가? (Vite `define`, `NEXT_PUBLIC_*`, Webpack `DefinePlugin`, `process.env.*` 직접 참조 등)
- [ ] 시크릿(API 키, 토큰)이 클라이언트(브라우저, 모바일, 데스크톱 확장)에서 직접 사용되는가?
  - **YES면 잘못된 아키텍처** — 백엔드 프록시를 만들고 사용자별 인증을 거쳐 호출
  - 사용자 본인 키를 입력받아 쓰는 경우만 클라이언트 보관 허용

### 빌드/배포 직전
- [ ] dist 빌드 후 `grep -r "sk-ant\|sk-proj\|AIza\|AKIA" dist/` 같은 스캔으로 시크릿 검출
- [ ] CRX/ZIP 압축 해제 후 동일 스캔
- [ ] CI에 시크릿 스캐너 (예: `gitleaks`, `trufflehog`) 도입

### 운영 중
- [ ] 모든 API 키에 사용량 알림 임계치 설정
- [ ] 자동 충전을 끄거나 월 한도 설정
- [ ] 키 만료(rotation) 일정 — 6개월에 한 번씩 회전
- [ ] 권한 캐시 파일(`.claude/settings.local.json`, IDE 설정 등)에 시크릿이 박히지 않도록 와일드카드 패턴 사용

### Anthropic 키 관리 (현재 머신)
- [ ] 모든 키에 명시적 이름 부여 (어느 프로젝트가 쓰는지 추적 가능하게)
- [ ] `stock`/`stock2` 공용 키 분리 — 한 프로젝트가 유출돼도 다른 쪽 영향 없도록

---

## 타임라인

| 시각 | 사건 |
|---|---|
| 2026-03-27 12:08 | `web_ScrapeFlow/.env`에 `CLAUDE_API_KEY` 저장 |
| 2026-03-29 22:30 | commit `508fda9` "Chrome Web Store 배포 준비" — dist 빌드 시 키 인라인 |
| 2026-03-29 이후 | 어딘가에 배포된 dist에서 누군가 키 추출 추정 |
| ~2026-05-11 | 외부에서 자동화 호출 누적, $47.96 청구 |
| 2026-05-12 | 사용자 인지 → Anthropic 콘솔에서 키 비활성화 |
| 2026-05-12 | 유출 경로 진단 완료 → 본 회고 문서 작성 |
| 2026-05-12 | 코드 수정 완료 (vite.config / ai.ts / popup.html) + v0.2.0 빌드 |
| 2026-05-12 | Chrome Web Store에 v0.2.0 업로드 (심사 대기) |

---

## 관련 자료

- Plan: [C:\Users\tkguy\.claude\plans\ai-scalable-hamming.md](C:\Users\tkguy\.claude\plans\ai-scalable-hamming.md)
- 유출 코드: [extension/vite.config.ts:11-13](../../extension/vite.config.ts), [extension/src/lib/ai.ts:3-30](../../extension/src/lib/ai.ts)
- 관련 커밋: `508fda9` (2026-03-29) "Chrome Web Store 배포 준비"

---

## 교훈 (한 줄로)

**"확장 프로그램은 서버가 아니다."** 클라이언트에서 동작하는 모든 코드(브라우저 확장, 모바일 앱, 데스크톱 앱)는 사용자가 분해해 들여다볼 수 있다. 그 안에 시크릿을 박지 말 것.
