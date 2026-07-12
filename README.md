# ttj-skills-browser

> 전용 CDP 브라우저를 실행하고, 원샷 명령으로 즉시 제어하는 CLI 도구

AI 에이전트(Claude Code 등)와 사용자가 **같은 브라우저 화면을 보며 작업**하기 위한 도구입니다.
`playwright-core`의 `connectOverCDP`로 실행 중인 브라우저에 직접 연결하므로 세션 관리가 없고,
명령 하나가 ~0.4초에 끝납니다.

- ✅ 전용 Chrome 실행 (CDP 포트 9227, 고정 프로필 — 로그인 세션 유지)
- ✅ 원샷 명령: `eval` / `goto` / `click` / `type` / `wait` / `tabs` / `screenshot`
- ✅ 브라우저가 닫혀 있으면 **자동 재실행 후 작업 계속**
- ✅ `click`/`type`은 CDP 실제 입력 이벤트 (isTrusted=true), `type`은 글자당 100~300ms 랜덤 딜레이
- ✅ 페이지 요소 시각화 (`--visualize`): 배지 오버레이 + 호버 셀렉터 + 클릭 복사
- ✅ 하루 1회 자동 업데이트 확인

## 요구사항

| 항목 | 버전 |
|------|------|
| Node.js | >= 16.0.0 |
| Chrome / Chromium | 설치되어 있어야 함 |

## 설치

```bash
npm install -g ttj-skills-browser
```

전역 설치 후 에이전트 스킬도 자동 설치됩니다.

| 도구 | 호출 |
|------|------|
| Claude Code | `/ttj-skills-browser` |
| Codex | `$ttj-skills-browser` |

## 사용법

```bash
# 브라우저 실행 (이미 떠 있으면 창만 앞으로)
ttj-skills-browser

# 원샷 명령 — 실행 중인 브라우저의 활성 탭에서 즉시 수행
ttj-skills-browser eval "document.title"
ttj-skills-browser goto https://www.naver.com
ttj-skills-browser click "#login-btn"
ttj-skills-browser type "#query" "검색어"
ttj-skills-browser wait ".search-result" 5000
ttj-skills-browser tabs
ttj-skills-browser tab 2
ttj-skills-browser screenshot /tmp/shot.png --full

# 페이지 요소 시각화 (배지 오버레이 + 전체 스크린샷 → /tmp/ttj-refs-visual.png)
ttj-skills-browser --visualize
```

모든 원샷 명령은 실행 중인 브라우저를 자동 감지하고, 여러 탭 중 화면에 보이는 활성 탭을
자동 선택합니다. 브라우저가 없으면 자동으로 실행한 뒤 작업을 이어갑니다.

## 프로필 경로

| OS | 경로 |
|----|------|
| macOS / Linux | `~/.ttj-skills-browser` |
| Windows | `%APPDATA%\ttj-skills-browser` |

## 플랫폼별 Chrome 탐지 방식

| OS | 탐지 방법 |
|----|-----------|
| macOS | `mdfind -name "Google Chrome.app"` 또는 기본 앱 경로 |
| Linux | `which google-chrome` 또는 `which chromium` |
| Windows | `where chrome.exe` / `where chromium.exe` / 표준 설치 경로 |

## 개발

```bash
npm install     # 의존성 설치
npm run build   # TypeScript → dist/
npm start       # 로컬 실행
```

## 트러블슈팅

```bash
curl http://localhost:9227/json/version   # CDP 응답 확인
```

응답이 없으면 포트가 폴백되었을 수 있습니다. 브라우저 시작 로그의
"🔌 CDP 포트 XXXX 열림" 메시지에서 실제 포트를 확인하세요.

## 라이선스

MIT
