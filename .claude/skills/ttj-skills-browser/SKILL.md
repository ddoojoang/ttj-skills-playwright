---
name: ttj-skills-browser
description: ttj-skills-browser - 전용 브라우저 실행 + 원샷 명령(eval/goto/click/type/wait/tabs/screenshot) + 페이지 요소 시각화. 이 스킬로 브라우저를 연 뒤의 모든 브라우저 작업은 반드시 이 스킬의 명령으로 수행
disable-model-invocation: false
allowed-tools: Bash, Read, Write
auto-invoke-keywords: [
  "시각화해줘", "시각화해봐", "시각화 해줘", "시각화 해봐",
  "요소.*?(보여|찾아|시각|확인|표시|표현)",
  "구조.*?(보여|찾아|시각|확인|표시)",
  "HTML.*?(보여|찾아|시각|확인|표시)",
  "레이아웃.*?(보여|찾아|시각|확인|표시)",
  "(보여|찾아|시각|확인|표시).*?(요소|구조|HTML|레이아웃|버튼|링크)",
  "페이지.*?요소", "페이지 요소",
  "크롤링.*?(할만|하고싶|있어|가능|해줘|해볼)",
  "(수집|스크래핑).*?(할만|하고싶|있어|가능|해줘)"
]
---

# ttj-skills-browser

npm 패키지: `npm install -g ttj-skills-browser` · 명령: `/ttj-skills-browser`

전용 브라우저(CDP 포트 9227, 프로필 `~/.ttj-skills-browser` — Windows: `%APPDATA%\ttj-skills-browser`)를 실행하고, 원샷 명령으로 그 브라우저에서 즉시 작업한다. 로그인 세션은 프로필에 유지된다.

## 🚨 최우선 규칙: 모든 브라우저 작업은 이 브라우저로만

**사용자가 이 스킬로 브라우저를 연 이후, AI의 모든 브라우저 작업은 반드시 아래 명령만 사용한다.**

| 하고 싶은 것 | 명령 (즉시 실행, ~0.4초) |
|---|---|
| JS 실행 / DOM 조회 / 스타일 변경 | `ttj-skills-browser eval "<js>"` |
| 페이지 이동 (load 대기) | `ttj-skills-browser goto <url>` |
| 클릭 (진짜 마우스 이벤트) | `ttj-skills-browser click "<selector>"` |
| 텍스트 입력 (사람같은 랜덤 타이핑) | `ttj-skills-browser type "<selector>" "<텍스트>"` |
| 요소 등장 대기 (SPA/동적 콘텐츠) | `ttj-skills-browser wait "<selector>" [타임아웃ms]` |
| 탭 목록 / 탭 전환 | `ttj-skills-browser tabs` / `ttj-skills-browser tab <번호>` |
| 스크린샷 | `ttj-skills-browser screenshot [경로] [--full]` |
| 요소 시각화 | `ttj-skills-browser --visualize` |
| 크롤링 대상 분석 | `ttj-skills-browser crawl` |

모든 명령은 실행 중인 브라우저를 자동 감지해 CDP로 직접 연결하고, **화면에 보이는 활성 탭**을 자동 선택하며, **브라우저가 닫혀 있으면 자동으로 재실행 후 작업을 계속한다.**

> 💡 **click/type을 eval보다 우선 사용**: `eval`의 `el.click()`은 JS 가짜 이벤트(isTrusted=false)라
> 로그인·결제 버튼 등에서 무시될 수 있다. `click`/`type`은 CDP로 실제 입력 이벤트를 보내며,
> `type`은 글자당 100~300ms 랜덤 딜레이(봇 탐지 회피)가 자동 적용된다.

**금지 사항 (절대 하지 말 것):**
- ❌ 사전 상태 확인 (`curl :9227`, `ps aux`, `playwright-cli list`) — 명령이 알아서 브라우저를 찾음
- ❌ playwright-cli 세션 열기 / config 파일 작성 / CDP 연결 스크립트 새로 작성
- ❌ Puppeteer·Playwright로 다른 브라우저 실행 (별도 자동화 "코드 산출물" 요청 시에만 예외)
- ❌ 브라우저가 닫혔다고 사용자에게 되묻기 — 명령이 자동으로 재실행 후 작업 계속함

## 호출 방법

**자동 호출**: "ttj 브라우저 열어줘", "브라우저로 작업해줘" 같은 문장에서 자동 실행.
**명시적 호출**: `/ttj-skills-browser`
**직접 실행**: `ttj-skills-browser` (시각화 모드: `--visualize`)

## 🎯 시각화 요청 감지 (오탐 방지)

**판단 기준: "대상(요소/구조/HTML/버튼/링크...)" + "요청 표현" 둘 다 있을 때만 시각화 모드 실행.**

- 요청 표현: 보여줘/보여줄래, 찾아줘/찾아봐, 시각화해줘, 확인해줘, 표시해줘, 화면으로, 그림으로, 뭐가 있어?
- ✅ 실행: "요소들 **보여줘**", "페이지 구조 **시각화해줘**", "버튼이나 링크 **찾아줘**"
- ❌ 미실행 (단순 진술/정보성): "이 페이지의 요소는...", "버튼 요소가 있어", "div 요소를 찾는다"

## ⚡ 원샷 명령 사용법

### eval — 활성 탭에서 JS 실행 (결과는 JSON으로 stdout 출력)
```bash
ttj-skills-browser eval "document.title"
ttj-skills-browser eval "document.querySelector('#btn').style.background='yellow'"
ttj-skills-browser eval "(() => [...document.querySelectorAll('a')].length)()"           # 즉시실행 함수
ttj-skills-browser eval "(async () => { await new Promise(r => setTimeout(r, 500)); return location.href; })()"
```

### goto — 페이지 이동 (load 대기 포함)
```bash
ttj-skills-browser goto https://www.naver.com
ttj-skills-browser goto naver.com        # https:// 자동 보완
```

### click / type — 진짜 입력 이벤트
```bash
ttj-skills-browser click "#login-btn"
ttj-skills-browser type "#query" "검색어"
```

### wait — 요소 등장 대기
```bash
ttj-skills-browser wait ".search-result"        # 기본 10초 타임아웃
ttj-skills-browser wait ".lazy-content" 30000
```

### tabs / tab — 탭 조회·전환
```bash
ttj-skills-browser tabs      # ▶ [1] NAVER — https://www.naver.com ...
ttj-skills-browser tab 2     # 2번 탭을 앞으로 (이후 명령이 이 탭 대상)
```

### screenshot — 활성 탭 스크린샷
```bash
ttj-skills-browser screenshot                      # 기본 경로는 로그에 출력됨 (뷰포트)
ttj-skills-browser screenshot /tmp/full.png --full # 전체 페이지
```

## 시각화 기능 (Reference Visualization)

`--visualize`: 자동 스크롤(lazy-load 트리거) 후 모든 가시 요소(div/버튼/링크/input 등)에 빨간 배지(e1, e2...)와 아웃라인을 주입하고, 전체 페이지 스크린샷을 임시 폴더에 저장한다 (**정확한 경로는 실행 로그의 "📸 스크린샷 저장:" 줄에 출력** — 그 경로를 Read). 브라우저에서 배지에 호버하면 셀렉터 라벨이 뜨고, 클릭하면 고유 CSS 셀렉터가 클립보드에 복사된다.

**AI 실행 절차:**
1. `ttj-skills-browser --visualize` 실행
2. 로그의 "📸 스크린샷 저장:" 경로를 Read 도구로 사용자에게 표시
3. 요소 분류 테이블 출력:

| 위치 | Refs | 요소 |
|------|------|------|
| 헤더 | e1~e5 | 로고, 네비게이션, 검색 |
| 메인 | e6~e15 | 상품 카드 × 3, 버튼 |
| 푸터 | e16~e20 | 링크, 저작권 |

## 🕷 크롤링 대상 분석 (crawl)

**트리거**: 브라우저를 열어둔 상태에서 사용자가 "크롤링할만한거 있어?", "크롤링하고싶어",
"이 페이지에서 뭘 수집할 수 있어?" 같이 말하면 이 모드를 실행한다.

`ttj-skills-browser crawl`은 **레이아웃별 최상위 부모 영역만** 뚜렷한 빨간 박스로 보여준다
(디테일한 개별 요소 대신 구역 단위 — 예: 기사 목록 전체, 사이드바 위젯, 카드 그리드.
중첩된 하위 영역과 페이지 전체 래퍼는 제외되어 박스와 배지가 겹치지 않음):
- 각 영역에 배지(`e1 ×6` = 자식 요소 6개)와 굵은 아웃라인 표시
- **배지에 마우스를 올리면 그 박스만 남고 나머지는 모두 숨겨지며** 셀렉터 라벨이 표시됨 (일반 시각화와 동일)
- 배지 클릭 시 컨테이너 셀렉터 클립보드 복사
- 분석 결과 JSON을 stdout에 출력 (진행 로그는 stderr — stdout만 파싱하면 순수 JSON)
- 전체 페이지 스크린샷을 임시 폴더에 저장 (경로는 로그의 "📸 스크린샷 저장:" 줄)

**AI 실행 절차:**
1. `ttj-skills-browser crawl` 실행
2. 로그의 "📸 스크린샷 저장:" 경로를 Read 도구로 사용자에게 표시
3. JSON 분석 결과를 리스트업 테이블로 출력:

| Ref | 설명 (샘플 기반) | 자식 수 | 추출 가능 필드 | 컨테이너 셀렉터 |
|-----|------------------|--------|---------------|----------------|
| e1 | 호텔 카드 목록 | 30 | 제목, 링크, 이미지, 가격 | `div#hotel-list` |
| e2 | 리뷰 목록 | 12 | 텍스트, 날짜 | `ul.reviews` |

   (영역이 많으면 자식 수·크기 기준 상위 항목 위주로 요약해서 리스트업)

4. 사용자가 `e1` 같은 ref나 리스트 항목을 지정하면, 해당 컨테이너 셀렉터 기준으로 `eval`로
   데이터 추출을 검증한 뒤 크롤링을 진행한다 (코드 산출물 요청 시 아래 개발 규칙 적용)

**시각화 규칙**: `crawl`과 `--visualize`는 실행할 때마다 **기존 오버레이를 모두 제거하고
새것만 표시**한다 (같은 배지 클래스 공유 — 겹쳐 보이는 일 없음).

## 개발 규칙 (자동화 스크립트 "코드 산출물" 요청 시에만)

> 열려 있는 스킬 브라우저에서 즉시 작업하는 경우에는 위의 원샷 명령만 사용한다.

**기본 라이브러리 (언어 미명시 시)**: 브라우저 제어 = Puppeteer, HTTP 크롤링 = Axios + Cheerio. 사용자가 다른 도구를 명시하면 그에 따름.

**브라우저 자동화는 headless: false가 기본값** — 사용자가 화면으로 동작을 확인할 수 있어야 한다:
```javascript
const browser = await puppeteer.launch({ headless: false });   // 명시적 요청 시에만 true
```

**코드 구성: 기능을 함수 단위로 묶는다** — 하나의 함수 = 하나의 역할. 로그인/목록 수집/상세 파싱/저장을
각각 독립 함수로 분리하고, 흐름 함수가 이들을 조합한다 (거대한 단일 스크립트 금지):
```javascript
const fetchListPage = (page) => { ... };      // 목록 수집만
const parseItem = (el) => ({ ... });          // 파싱만 (순수 함수)
const saveResults = (items) => { ... };       // 저장만 (부수 효과)
const crawl = async () => saveResults((await fetchListPage(page)).map(parseItem));
```

**자동화 인간화 (봇 탐지 회피) — 필수:**
```javascript
const randomDelay = () => Math.random() * 200 + 100;   // 타이핑: 글자당 100-300ms
await page.type(selector, text, { delay: randomDelay() });

const randomWait = () => Math.random() * 1500 + 500;   // 요소 접근: 500ms-2s
await page.waitForTimeout(randomWait());
```

**개발 절차 — 검증 후 코드 작성:**
1. `eval` 명령으로 열려 있는 탭에서 셀렉터·로직 먼저 테스트:
   ```bash
   ttj-skills-browser eval "(() => [...document.querySelectorAll('.item')].map(el => el.textContent))()"
   ```
2. 예상 데이터가 나오는지, 누락·중복은 없는지 확인
3. 검증된 셀렉터·로직으로만 최종 코드 작성 (검증 없이 바로 코드 작성 금지)

**완료 후 실행 테스트 (필수)** — 코드를 작성했다고 끝이 아니다:
4. AI가 작성한 코드를 **직접 디버깅 모드로 실행** (headless: false로 브라우저 동작을 띄운 채,
   단계별 로그를 출력하며 실행)
5. 오류·빈 결과·셀렉터 미스가 나오면 수정 → 재실행을 **정상 완료될 때까지 반복**
6. 최종 실행 결과(수집 건수, 샘플 데이터)를 사용자에게 보고한 뒤에만 작업 완료로 간주

## 트러블슈팅 (명령이 반복 실패할 때만)

```bash
command -v ttj-skills-browser                  # 설치 확인 (미설치: npm install -g ttj-skills-browser@latest)
curl -s http://localhost:9227/json/version    # CDP 응답 확인
```
- CDP 응답이 없는데 브라우저가 떠 있다면 포트 폴백 가능성 — 실행 로그의 "🔌 CDP 포트 XXXX 열림"에서 실제 포트 확인
- 업데이트는 실행 시 하루 1회 자동 확인·설치됨 (실패해도 현재 버전으로 계속 동작)
