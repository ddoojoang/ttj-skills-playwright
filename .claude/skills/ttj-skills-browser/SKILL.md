---
name: TTJ-SKILLS-BROWSER
description: TTJ Skills Browser - Playwright CLI + 자동 프로필 & 설치 관리 + 페이지 요소 시각화
disable-model-invocation: false
allowed-tools: Bash, Read, Write
auto-invoke-keywords: [
  "시각화해줘", "시각화해봐", "시각화 해줘", "시각화 해봐",
  "요소.*?(보여|찾아|시각|확인|표시|표현)",
  "구조.*?(보여|찾아|시각|확인|표시)",
  "HTML.*?(보여|찾아|시각|확인|표시)",
  "레이아웃.*?(보여|찾아|시각|확인|표시)",
  "(보여|찾아|시각|확인|표시).*?(요소|구조|HTML|레이아웃|버튼|링크)",
  "페이지.*?요소", "페이지 요소"
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

## 🎯 시각화 요청 감지 (오탐 방지)

> **⚠️ 핵심 규칙: "요소" · "구조" · "HTML" 같은 단어만으로는 실행하지 않습니다.**
> **반드시 "요청 표현"(보여줘/찾아줘/시각화 등)이 함께 있어야만 시각화 모드를 실행합니다.**

### ✅ 실행되는 경우 (대상 + 요청 표현)
- "요소들 **보여줘**" — 요소 + 보여줘
- "페이지 구조 **시각화해줘**" — 구조 + 시각화
- "버튼이나 링크 **찾아줘**" — 대상 + 찾아줘
- "이 페이지 어떻게 구성됐는지 **화면으로 보여줄래?**" — 보여줄래
- "HTML 구조 **확인해줘**" — HTML + 확인해줘

### ❌ 실행되지 않는 경우 (요청 표현 없음 = 단순 진술/정보성)
- "이 페이지의 요소는..." — 요청 표현 없음
- "HTML 요소가..." — 정보성, 요청 아님
- "버튼 요소가 있어" — 단순 진술
- "div 요소를 찾는다" — 요청이 아님

### 요청 표현 목록 (다음 중 하나가 반드시 포함되어야 함)
- 보여줘, 보여줄래, 보여줄래?
- 찾아줘, 찾아봐, 찾으라
- 시각화해줘, 시각화해봐
- 확인해줘, 확인해봐
- 표시해줘, 표현해줘
- 화면으로, 그림으로
- 어떻게 구성돼?, 뭐가 있어?, 어때?

**판단 기준: "대상(요소/구조/HTML/버튼/링크...)" + "요청 표현" 이 둘 다 있을 때만 `/TTJ-SKILLS-BROWSER`를 시각화 모드로 실행합니다.**

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

## 개발 규칙 (자동화 스크립트 작성 시)

사용자가 크롤링, 자동화, DOM 조작을 요청했을 때의 개발 규칙:

### 기본 라이브러리 (언어 미명시 시)

**브라우저 제어**: Puppeteer (기본값)
- 사용자가 Selenium, Playwright 등 명시 시 그에 따름

**HTTP 요청**: Axios + Cheerio 조합
- Axios: HTTP 요청 수행
- Cheerio: HTML 파싱 및 CSS 선택자 크롤링

### 자동화 인간화 (봇 탐지 회피)

**타이핑: 항상 랜덤 간격**
- 권장: 글자마다 100-300ms 랜덤 지연
- 목적: 사람처럼 보이기

**크롤링/요소 접근: 항상 랜덤 간격**
- 권장: 요소마다 500ms-2s 랜덤 대기
- 목적: 봇 탐지 회피

**구현 예시:**
```javascript
// 랜덤 간격 타이핑
const randomDelay = () => Math.random() * 200 + 100; // 100-300ms
await page.type(selector, text, { delay: randomDelay() });

// 랜덤 간격 크롤링
const randomWait = () => Math.random() * 1500 + 500; // 500-2000ms
await page.waitForTimeout(randomWait());
```

### OS별 브라우저 감지 & 자동 선택

**규칙:**
1. 사용자 PC의 OS 자동 감지 (Mac / Windows / Linux)
2. 해당 OS에 설치된 기본 브라우저 사용
3. 경로 자동 감지해서 실행

**OS별 브라우저:**
| OS | 기본 브라우저 |
|---|---|
| macOS | Chrome, Safari, Firefox 등 (설치된 것) |
| Windows | Edge, Chrome, Firefox 등 (설치된 것) |
| Linux | Chrome, Firefox 등 (설치된 것) |

**사용자가 특정 브라우저 명시하지 않으면 OS 기본값 사용**
```javascript
// 예: Puppeteer 자동 브라우저 감지
const browser = await puppeteer.launch();
// → OS에 따라 기본 브라우저 자동 선택
```

## DOM 제어 코드 개발 워크플로우

사용자가 크롤링, 자동화, DOM 조작을 요청했을 때의 개발 절차:

### 규칙 (반드시 준수)
1. **절대 바로 코드를 작성하지 말 것**
2. **개발자도구 콘솔에서 먼저 테스트**
3. **console.log로 결과 확인**
4. **동작이 검증된 후에만 최종 코드 작성**

### 단계별 프로세스

#### Step 1️⃣: 콘솔에서 코드 테스트
브라우저의 개발자도구 콘솔에서:
```javascript
// 테스트 코드 실행
document.querySelectorAll('.item').forEach(el => {
  console.log(el.textContent);
});
```

#### Step 2️⃣: 결과 확인
- 콘솔에 예상한 데이터가 출력되는가?
- 오류는 없는가?
- 모든 요소를 정확히 선택했는가?

#### Step 3️⃣: 동작 검증
- 데이터 형식이 맞는가?
- 빠진 것은 없는가?
- 중복이 있는가?

#### Step 4️⃣: 최종 코드 작성
검증된 코드를 프로덕션 코드에 적용

### 실제 예시

**사용자 요청:** "네이버 검색 결과의 제목과 URL을 크롤링해줄래?"

**AI의 작업 흐름:**

1. 브라우저 개발자도구 열기

2. 콘솔에서 먼저 테스트:
   ```javascript
   // 먼저 요소 확인
   document.querySelectorAll('a.title')
   // → 10개 항목 반환 ✅

   // 텍스트 추출 테스트
   const titles = Array.from(document.querySelectorAll('a.title'))
     .map(a => a.textContent);
   console.log(titles);
   // → ["검색결과1", "검색결과2", ...] ✅

   // URL 추출 테스트
   const urls = Array.from(document.querySelectorAll('a.title'))
     .map(a => a.href);
   console.log(urls);
   // → ["https://...", "https://...", ...] ✅
   ```

3. 결과 확인 완료 ✓

4. 최종 크롤링 코드 작성

### 주의사항
- 브라우저 콘솔 없이 바로 코드를 작성하지 말 것
- console.log는 필수 (동작 검증)
- 모든 엣지 케이스를 테스트할 것 (빈 요소, 로딩 지연 등)

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
