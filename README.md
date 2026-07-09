# TTJ Browser

> Playwright CLI 브라우저를 자동 프로필 관리 및 설치 확인과 함께 실행하는 CLI 도구

TTJ Browser는 `playwright-cli`를 감싸(wrapper) 아래 작업을 자동화합니다.

- ✅ `playwright-cli` 설치 여부 자동 확인 및 설치
- ✅ Chrome / Chromium 설치 여부 확인 (macOS / Linux / Windows)
- ✅ 전용 프로필 디렉토리 자동 생성
- ✅ 사용 가능한 디버깅 포트 자동 할당 (9227부터)
- ✅ 브라우저 자동 실행
- ✅ 최신 버전 자동 확인 및 업데이트 알림

## 요구사항

| 항목 | 버전 |
|------|------|
| Node.js | >= 16.0.0 |
| Chrome / Chromium | 설치되어 있어야 함 |

## 설치

```bash
npm install -g ttj-browser
```

## 사용법

```bash
ttj-browser
```

실행하면 다음 순서로 동작합니다.

1. `playwright-cli` 탐지 → 없으면 `npm install -g playwright-cli` 자동 실행
2. Chrome / Chromium 탐지 → 없으면 경고 후 종료
3. 프로필 디렉토리 생성
   - macOS / Linux: `~/.ttj-browser`
   - Windows: `%APPDATA%\ttj-browser`
4. 사용 가능한 포트 확인 (기본 9227, 사용 중이면 다음 포트)
5. 브라우저 실행 (`https://www.google.com`)
6. npm 최신 버전 확인 → 업데이트가 있으면 알림

## 플랫폼별 Chrome 탐지 방식

| OS | 탐지 방법 |
|----|-----------|
| macOS | `mdfind -name "Google Chrome.app"` 또는 기본 앱 경로 |
| Linux | `which google-chrome` 또는 `which chromium` |
| Windows | `where chrome.exe` 또는 `where chromium.exe` |

## 개발

```bash
# 의존성 설치
npm install

# 빌드 (TypeScript → dist/)
npm run build

# 로컬 실행
npm start
```

## 플랫폼별 설치 및 사용

### Windows

- **최소 버전:** v1.0.8 이상
- **설치:**
  ```bash
  npm install -g ttj-skills-browser@latest
  ```
- **프로필 경로:** `C:\Users\<username>\AppData\Roaming\ttj-skills-browser`
- **설정 확인:**
  ```powershell
  dir $env:APPDATA\ttj-skills-browser
  ```

### macOS / Linux

- **프로필 경로:** `~/.ttj-skills-browser`
- **설정 확인:**
  ```bash
  ls -la ~/.ttj-skills-browser
  ```

## CDP (Chrome DevTools Protocol) 검증

브라우저 실행 후 CDP가 정상 열렸는지 확인:

```bash
curl http://localhost:9227/json/version
```

정상 응답:
```json
{
  "Browser": "Chrome/149.0.7827.199",
  "Protocol-Version": "1.3",
  "webSocketDebuggerUrl": "ws://localhost:9227/devtools/browser/..."
}
```

응답이 없으면 포트가 폴백되었을 수 있습니다. 브라우저 시작 로그를 확인하세요.

## 라이선스

MIT
