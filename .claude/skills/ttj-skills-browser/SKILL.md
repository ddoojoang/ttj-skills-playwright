---
name: TTJ-SKILLS-BROWSER
description: TTJ Skills Browser - Playwright CLI + 자동 프로필 & 설치 관리 + 페이지 요소 시각화
disable-model-invocation: false
allowed-tools: Bash, Read, Write
auto-invoke-keywords: [
  "시각화", "요소", "구조", "구성", "보여줘", "찾아줘",
  "HTML", "셀렉터", "버튼", "링크", "입력", "form", "div",
  "레이아웃", "화면", "스크린샷", "참조", "reference", "라벨"
]
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

### 1️⃣ 자동 호출 (기존)
스킬을 명시적으로 호출하지 않아도 됩니다:
- "ttj 브라우저 열어줘"
- "브라우저로 작업해줘"
- "ttj 브라우저가 필요해"

이런 문장에서 Claude가 자동으로 이 스킬을 호출합니다.

### 2️⃣ 시각화 자동 감지 (새로 추가!)
사용자가 다음 키워드로 말하면 자동으로 시각화 모드가 실행됩니다:
- "시각화 해줘"
- "이 사이트 요소들 보여줘"
- "요소를 화면으로 보여줘"
- "html이 어떻게 구성된건지 그림으로 보여줘"
- "페이지 구조를 보여줄래?"
- "어떤 요소들이 있어?"
- "버튼이나 링크 찾아줘"

**검색(감지) 키워드:**
**시각화, 요소, 구조, 구성, 보여줘, 찾아줘, HTML, 셀렉터, 버튼, 링크, 입력, form, div, 레이아웃, 화면, 스크린샷, 참조, reference, 라벨**

위 키워드가 포함되면 Claude가 자동으로 `/TTJ-SKILLS-BROWSER`를 시각화 모드로 실행합니다.

### 3️⃣ 명시적 호출
또는 직접 호출:
`/TTJ-SKILLS-BROWSER`

### 직접 실행
```bash
npm install -g ttj-skills-browser
ttj-skills-browser

# 시각화 모드 (페이지 요소 라벨 오버레이 + 스크린샷)
VISUALIZE=true ttj-skills-browser
# 또는
ttj-skills-browser --visualize
```

## 시각화 기능 (Reference Visualization)

브라우저에서 열린 페이지의 모든 요소를 시각화합니다 (`bb 2` 로직 이식).

### 기능
1. **자동 감지** - 모든 div, 버튼, 링크, input, select, textarea 등 찾기
2. **라벨 오버레이** - e1, e2, e3... 순번 배지 + 셀렉터/링크/타입 정보 표시
3. **클릭 복사** - 라벨(배지) 클릭 시 고유 CSS 셀렉터를 클립보드에 복사
4. **스크린샷** - 자동 스크롤(lazy-load 트리거) 후 전체 페이지 시각화 이미지를 `/tmp/ttj-refs-visual.png`로 저장

### 실행 흐름
1. 현재 열린 페이지에 자동 스크롤 → lazy-load 콘텐츠 로드
2. 모든 가시 요소에 빨간 배지(e1, e2...)와 아웃라인 주입
3. 전체 페이지(fullPage) 스크린샷 촬영 → `/tmp/ttj-refs-visual.png`
4. Read 도구로 스크린샷을 사용자에게 표시
5. 요소 분류 테이블 출력

### 출력 예시
| 위치 | Refs | 요소 |
|------|------|------|
| 헤더 | e1~e5 | 로고, 네비게이션, 검색 |
| 메인 | e6~e15 | 상품 카드 × 3, 버튼 |
| 푸터 | e16~e20 | 링크, 저작권 |

> ⚠️ 시각화는 `playwright-cli` 활성 세션이 필요합니다. 세션이 없으면 오류를 로깅하고 조용히 넘어갑니다(best-effort).

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
