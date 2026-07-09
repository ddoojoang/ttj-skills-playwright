---
name: TTJ-SKILLS-BROWSER
description: TTJ Skills Browser - Playwright CLI + 자동 프로필 & 설치 관리
disable-model-invocation: false
allowed-tools: Bash, Read, Write
---

# TTJ Skills Browser

npm 패키지: `npm install -g ttj-skills-browser`
명령: `/TTJ-SKILLS-BROWSER`

> ⚠️ Windows 사용자는 v1.0.8 이상 필수
> 설치: `npm install -g ttj-skills-browser@latest`

## 기능
- ✅ playwright-cli 자동 설치 확인
- ✅ Chrome/Chromium 설치 확인
- ✅ 브라우저 프로필 자동 생성
  - macOS / Linux: `~/.ttj-skills-browser`
  - Windows: `%APPDATA%\ttj-skills-browser` (예: `C:\Users\<username>\AppData\Roaming\ttj-skills-browser`)
- ✅ 포트 9227 자동 할당
- ✅ 브라우저 자동 실행
- ✅ 버전 자동 체크 및 업데이트 알림

## 사용 방법

### 자동 호출
스킬을 명시적으로 호출하지 않아도 됩니다:
- "ttj 브라우저 열어줘"
- "브라우저로 작업해줘"
- "ttj 브라우저가 필요해"

이런 문장에서 Claude가 자동으로 이 스킬을 호출합니다.

### 명시적 호출
또는 직접 호출:
`/TTJ-SKILLS-BROWSER`

### 직접 실행
```bash
npm install -g ttj-skills-browser
ttj-skills-browser
```

## 자동 업데이트

스킬 실행 시 최신 버전을 자동으로 확인하고 필요하면 업데이트합니다:
- 최신 버전이 있으면: "✅ 최신버전이 있어서 업데이트했습니다"
- 이미 최신이면: 아무 메시지 없이 진행
- 업데이트 실패해도: 현재 버전으로 계속 사용

## 실행 흐름
1. playwright-cli 탐지/설치
2. Chrome 탐지
3. 프로필 생성
4. 포트 확인 (9227 또는 다음 가능한 포트)
5. 브라우저 실행
6. 버전 체크 → 업데이트 알림

## 설치 확인
```bash
# Mac / Git Bash
command -v ttj-skills-browser && echo "설치됨" || echo "미설치"
```

```powershell
# Windows PowerShell
if (Get-Command ttj-skills-browser -ErrorAction SilentlyContinue) { "설치됨" } else { "미설치" }
```

## 설정 확인 (프로필 폴더 존재 여부)

### Mac / Linux
```bash
ls -la ~/.ttj-skills-browser
```

### Windows PowerShell
```powershell
dir $env:APPDATA\ttj-skills-browser
```

## CDP 포트 검증

브라우저 실행 후 Chrome DevTools Protocol이 열렸는지 확인:

```bash
curl -s http://localhost:9227/json/version
```

정상 응답 예:
```json
{
  "Browser": "Chrome/149.0.7827.199",
  "Protocol-Version": "1.3",
  "webSocketDebuggerUrl": "ws://localhost:9227/devtools/browser/..."
}
```

응답이 없으면:
1. 브라우저가 실행 중인지 확인
2. 포트가 폴백되었을 가능성 - 로그에서 실제 포트 확인

## 포트 폴백

포트 9227이 사용 중인 경우:
- 브라우저는 자동으로 다음 가능한 포트에서 실행됨
- 실제 포트 확인: 스크립트 실행 후 로그에서 "🔌 CDP 포트 XXXX 열림" 메시지 확인
- 다른 도구에서 포트를 사용해야 하면 위 메시지의 포트 번호 사용

## 업데이트 확인
```bash
# 최신 버전으로 업데이트
npm install -g ttj-skills-browser@latest
```
