---
name: bb
description: Playwright 브라우저 상태 확인, 레퍼런스 시각화, API 캡처 → Bruno + TypeScript 생성
disable-model-invocation: true
argument-hint: [1|2|3]
allowed-tools: Bash, Read, Write
---

# Playwright 브라우저 도구

playwright-cli (CLI 도구)를 사용하여 브라우저를 파악하고 조작합니다.
**MCP가 아닌 Bash로 playwright-cli 명령어를 직접 실행합니다.**

**브라우저 프로필 경로 (고정):** `/Users/ileum/playwright-workspace/~/playwright-workspace/profile`
모든 open 명령에 반드시 `--profile=/Users/ileum/playwright-workspace/~/playwright-workspace/profile` 옵션을 사용한다.
이 프로필에 쿠키, 로그인 세션 등이 저장되어 재연결 시에도 유지된다.

인수: $ARGUMENTS

---

## 공통: 브라우저 탐지 (모든 명령 실행 전 필수)

**2단계로 탐지한다. playwright-cli 세션이 끊어져도 CDP로 브라우저를 찾는다.**

### 탐지 1: playwright-cli 세션 확인
```bash
playwright-cli list
```

### 탐지 2: CDP 포트 스캔 (항상 실행 - 탐지 1 결과와 무관)
```bash
ps aux | grep remote-debugging-port | grep -v grep
```
`--remote-debugging-port=XXXXX` 에서 포트 번호를 파싱한다.
포트를 찾으면:
```bash
curl -s http://localhost:{포트}/json/version
curl -s http://localhost:{포트}/json/list
```

### 탐지 결과 판단:

| playwright-cli 세션 | CDP 브라우저 | 상태 | 조치 |
|---------------------|-------------|------|------|
| active (open) | 발견 | 정상 | 바로 명령 실행 |
| closed / 없음 | 발견 | 세션 끊김 | `/bb 1`: CDP 정보 보고. `/bb 2`: 자동 재연결 후 실행 |
| closed / 없음 | 미발견 | 브라우저 없음 | 자동 실행 후 상태 보고 |

**브라우저 미발견 시 (자동 실행):**
브라우저가 실행되지 않았습니다. 자동으로 실행합니다.
```bash
playwright-cli open --headed --profile=/Users/ileum/playwright-workspace/~/playwright-workspace/profile https://www.google.com
```
실행 후 탐지를 다시 수행한다.

---

## `/bb 1` - 브라우저 상태 체크

위 공통 탐지를 실행한 후, 찾은 정보를 아래 형식으로 보고:

| 항목 | 값 |
|------|-----|
| CLI 세션 | active / closed / 없음 |
| 브라우저 | Chrome/XXX |
| CDP 포트 | XXXXX |
| WebSocket URL | ws://localhost:XXXXX/devtools/browser/... |
| PID | XXXXX |
| 열린 페이지 | N개 - 페이지제목1 (URL1), ... |

**CLI 세션이 closed이지만 CDP 브라우저가 있는 경우:**
위 테이블을 정상 보고한다. (CDP로 브라우저를 감지했으므로 경고 없이 정상 보고)

**브라우저 미발견 시 자동 실행 절차:**
1. 브라우저를 foreground로 실행:
```bash
playwright-cli open --headed --profile=/Users/ileum/playwright-workspace/~/playwright-workspace/profile https://www.google.com
```
2. 탐지 1, 2를 다시 실행한다.
3. 상태 테이블을 출력한다.

---

## `/bb 2` - 레퍼런스 시각화

현재 열린 페이지의 주요 div 및 인터랙티브 요소에 빨간 라벨(e1 tag#id.class)과 아웃라인을 오버레이한 뒤 스크린샷을 보여준다. 라벨에는 셀렉터 정보, 링크 URL, input 타입 등이 표시되며, 라벨 클릭 시 CSS 셀렉터가 클립보드에 복사된다.

### Case A: playwright-cli 세션이 active인 경우
바로 Step 1(JS 오버레이 주입)으로 진행.

### Case B: 세션 끊김 (closed이지만 CDP 브라우저 발견)
자동 재연결 수행:

1. CDP에서 현재 열린 페이지 URL을 가져온다:
```bash
curl -s http://localhost:{포트}/json/list
```
첫 번째 페이지의 url을 기억한다.

2. 기존 브라우저 프로세스를 종료한다 (SIGTERM으로 graceful shutdown):
```bash
kill {PID} && sleep 1
```
종료 확인:
```bash
ps -p {PID} > /dev/null 2>&1 && kill -9 {PID}
```

3. 같은 프로필로 브라우저를 다시 연다:
```bash
playwright-cli open --headed --profile=/Users/ileum/playwright-workspace/~/playwright-workspace/profile {기억한_URL}
```

4. 재연결 완료 후 Step 1로 진행한다.

### Case C: 브라우저 완전 미발견 (playwright-cli 세션도 없고 CDP 브라우저도 없음)
브라우저를 자동 실행:

1. foreground로 브라우저 실행:
```bash
playwright-cli open --headed --profile=/Users/ileum/playwright-workspace/~/playwright-workspace/profile https://www.google.com
```

2. 실행 완료 후 Step 1(JS 오버레이 주입)으로 진행한다.

### Step 1: JS 오버레이 주입 (자동 스크롤 + 전체 페이지 오버레이)
```bash
playwright-cli run-code "async page => {
  // Auto-scroll to trigger lazy-load content
  await page.evaluate(async () => {
    const distance = window.innerHeight;
    let currentPosition = 0;
    const maxScroll = document.body.scrollHeight;
    while (currentPosition < maxScroll) {
      window.scrollTo(0, currentPosition);
      currentPosition += distance;
      await new Promise(r => setTimeout(r, 200));
    }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 300));
  });

  await page.evaluate(() => {
    document.querySelectorAll('.pw-ref-overlay,.pw-ref-style,.pw-ref-svg,.pw-ref-badge').forEach(e => e.remove());
    document.querySelectorAll('.pw-ref-highlight').forEach(e => e.classList.remove('pw-ref-highlight'));

    const style = document.createElement('style');
    style.className = 'pw-ref-style';
    style.textContent = \`
      .pw-ref-badge {
        position:absolute;width:18px;height:18px;border-radius:50%;
        background:rgba(220,38,38,0.92);color:#fff;font-size:9px;font-weight:bold;
        display:flex;align-items:center;justify-content:center;
        z-index:999999;pointer-events:auto;cursor:pointer;font-family:monospace;
        box-shadow:0 1px 3px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.5);
        line-height:1;transition:transform 0.1s;
      }
      .pw-ref-badge:hover {
        transform:scale(1.2);background:rgba(30,64,175,0.95);
      }
      .pw-ref-badge.pw-copied {
        background:rgba(22,163,74,0.95);
      }
      .pw-ref-overlay {
        position:absolute;background:rgba(220,38,38,0.92);color:#fff;
        font-size:10px;font-weight:bold;padding:2px 5px;border-radius:4px;
        z-index:999999;pointer-events:none;
        font-family:monospace;line-height:14px;white-space:nowrap;
        box-shadow:0 2px 6px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.3);
        max-width:none;overflow:visible;text-overflow:unset;
        user-select:none;display:none;
      }
      .pw-ref-highlight {
        outline:1.5px solid rgba(220,38,38,0.5)!important;outline-offset:1px;
      }
      .pw-ref-highlight.pw-ref-focused {
        outline:3px solid rgba(220,38,38,0.9)!important;outline-offset:2px;
      }
      .pw-ref-highlight.pw-ref-dimmed {
        outline-color:transparent!important;
      }
      .pw-ref-badge.pw-ref-dimmed {
        opacity:0!important;pointer-events:none!important;
      }
      .pw-ref-tooltip {
        position:fixed;top:10px;left:50%;transform:translateX(-50%);
        background:rgba(22,163,74,0.95);color:#fff;padding:8px 16px;
        border-radius:8px;font-family:monospace;font-size:13px;font-weight:bold;
        z-index:1000001;pointer-events:none;
        box-shadow:0 4px 12px rgba(0,0,0,0.3);
        animation: pw-fade 1.5s ease-out forwards;
      }
      @keyframes pw-fade {
        0%{opacity:1;transform:translateX(-50%) translateY(0)}
        70%{opacity:1}
        100%{opacity:0;transform:translateX(-50%) translateY(-10px)}
      }
    \`;
    document.head.appendChild(style);

    const getUniqueSelector = (el) => {
      if (el.id) return el.tagName.toLowerCase() + '#' + el.id;

      const path = [];
      let current = el;
      while (current && current !== document.body && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase();

        if (current.id) {
          path.unshift(tag + '#' + current.id);
          break;
        }

        const parent = current.parentElement;
        if (!parent) break;

        const cls = Array.from(current.classList)
          .filter(c => !c.startsWith('pw-ref-'))
          .slice(0, 2).map(c => '.' + c).join('');

        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        const part = siblings.length > 1
          ? tag + cls + ':nth-of-type(' + (Array.from(parent.children).filter(c => c.tagName === current.tagName).indexOf(current) + 1) + ')'
          : tag + cls;

        path.unshift(part);

        const testSelector = path.join(' > ');
        try {
          if (document.querySelectorAll(testSelector).length === 1) return testSelector;
        } catch(e) {}

        current = parent;
      }
      return path.join(' > ');
    };

    const getShortUniqueSelector = (el) => {
      const tag = el.tagName.toLowerCase();
      const cls = Array.from(el.classList)
        .filter(c => !c.startsWith('pw-ref-'))
        .slice(0, 2).map(c => '.' + c).join('');

      // Case 1: has id
      if (el.id) return tag + '#' + el.id;

      // Case 2: tag.class — check if unique in document
      const base = tag + cls;
      try {
        if (document.querySelectorAll(base).length === 1) return base;
      } catch(e) {}

      // Case 3: add :nth-of-type among siblings
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        const nthIdx = siblings.indexOf(el) + 1;
        const withNth = siblings.length > 1 ? base + ':nth-of-type(' + nthIdx + ')' : base;
        try {
          if (document.querySelectorAll(withNth).length === 1) return withNth;
        } catch(e) {}

        // Case 4: prepend parent selector (max 1 level)
        const pTag = parent.tagName.toLowerCase();
        const pId = parent.id ? '#' + parent.id : '';
        const pCls = pId ? '' : Array.from(parent.classList)
          .filter(c => !c.startsWith('pw-ref-'))
          .slice(0, 2).map(c => '.' + c).join('');
        const parentSel = pTag + pId + pCls;

        // Check if parent itself needs nth-of-type
        const grandParent = parent.parentElement;
        const parentWithNth = grandParent
          ? (() => {
              const pSiblings = Array.from(grandParent.children).filter(c => c.tagName === parent.tagName);
              return pSiblings.length > 1
                ? parentSel + ':nth-of-type(' + (pSiblings.indexOf(parent) + 1) + ')'
                : parentSel;
            })()
          : parentSel;

        return parentWithNth + ' > ' + withNth;
      }

      return base;
    };

    const sels = 'div,a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem]';
    let idx = 1;

    document.querySelectorAll(sels).forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;

      const tag = el.tagName.toLowerCase();

      let extra = '';
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        extra = href ? ' → ' + href : '';
      } else if (tag === 'input') {
        const t = el.type || 'text';
        const ph = el.placeholder ? ' \\\"' + el.placeholder + '\\\"' : '';
        extra = ' [' + t + ph + ']';
      } else if (tag === 'textarea') {
        const ph = el.placeholder ? ' \\\"' + el.placeholder + '\\\"' : '';
        extra = ' [textarea' + ph + ']';
      }

      const aria = el.getAttribute('aria-label');
      const ariaStr = aria ? ' @\\\"' + aria + '\\\"' : '';

      const shortUniqueSelector = getShortUniqueSelector(el);
      const labelText = 'e' + idx + ' ' + shortUniqueSelector + extra + ariaStr;
      const copyStr = getUniqueSelector(el);
      const refId = 'pw-ref-' + idx;

      const badge = document.createElement('div');
      badge.className = 'pw-ref-badge';
      badge.textContent = 'e' + idx;
      badge.dataset.refId = refId;
      badge.style.left = (rect.left + window.scrollX - 8) + 'px';
      badge.style.top = (rect.top + window.scrollY - 8) + 'px';
      document.body.appendChild(badge);

      el.classList.add('pw-ref-highlight');

      const labelLeft = rect.left + window.scrollX - 8;
      const labelTop = (rect.top + window.scrollY - 28 < window.scrollY)
        ? rect.top + window.scrollY + 14
        : rect.top + window.scrollY - 28;

      const label = document.createElement('div');
      label.className = 'pw-ref-overlay';
      label.textContent = labelText;
      label.style.left = labelLeft + 'px';
      label.style.top = labelTop + 'px';
      label.dataset.refId = refId;
      label.dataset.selector = copyStr;
      document.body.appendChild(label);

      badge.addEventListener('mouseenter', () => {
        document.querySelectorAll('.pw-ref-highlight').forEach(e => e.classList.add('pw-ref-dimmed'));
        el.classList.remove('pw-ref-dimmed');
        el.classList.add('pw-ref-focused');
        document.querySelectorAll('.pw-ref-badge').forEach(b => b.classList.add('pw-ref-dimmed'));
        badge.classList.remove('pw-ref-dimmed');
        label.style.display = 'block';
      });

      badge.addEventListener('mouseleave', () => {
        document.querySelectorAll('.pw-ref-dimmed').forEach(e => e.classList.remove('pw-ref-dimmed'));
        el.classList.remove('pw-ref-focused');
        label.style.display = 'none';
      });

      badge.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        navigator.clipboard.writeText(copyStr).then(() => {
          badge.classList.add('pw-copied');
          const old = document.querySelector('.pw-ref-tooltip');
          if (old) old.remove();
          const toast = document.createElement('div');
          toast.className = 'pw-ref-tooltip';
          toast.textContent = 'Copied: ' + copyStr;
          document.body.appendChild(toast);
          setTimeout(() => { badge.classList.remove('pw-copied'); }, 800);
          setTimeout(() => { toast.remove(); }, 1500);
        });
      });

      idx++;
    });
    return idx - 1;
  });
}"
```

### Step 2: 전체 페이지(fullPage) 스크린샷 촬영
```bash
playwright-cli run-code "async page => {
  await page.screenshot({ path: '/tmp/refs_visual.png', fullPage: true });
}"
```
Read 도구로 `/tmp/refs_visual.png`를 읽어서 사용자에게 이미지를 보여준다.

스크린샷 표시 후, 주요 영역을 테이블로 정리:
| 위치 | Refs | 요소들 |
|------|------|--------|
| 예: 헤더 | e1~e5 | 로고, 네비게이션, 검색 |

### 오버레이 제거 (필요 시):
```bash
playwright-cli run-code "async page => {
  await page.evaluate(() => {
    document.querySelectorAll('.pw-ref-overlay,.pw-ref-style,.pw-ref-svg,.pw-ref-badge').forEach(e => e.remove());
    document.querySelectorAll('.pw-ref-highlight').forEach(e => e.classList.remove('pw-ref-highlight'));
  });
}"
```

---

## `/bb 3` - API 캡처 → Bruno 컬렉션 → TypeScript REST API 생성

브라우저에서 사용자가 직접 수행한 작업(로그인, 포스팅 등)을 CDP로 실시간 캡처하여
Bruno 컬렉션(.bru 파일)으로 저장하고, TypeScript REST API 코드를 자동 생성한다.

### ⛔ 절대 금지 사항
- **Playwright / Puppeteer / Selenium 등 브라우저 자동화 프레임워크를 제안하지 말 것**
- 동적 값(토큰, 암호화된 값, 타임스탬프 등)을 .bru 파일에 하드코딩하지 말 것
- 사용자 인증 정보(id, password)를 코드에 직접 삽입하지 말 것 — 항상 환경변수 사용
- Bruno 스크립트 없이 해결 불가한 동적 파라미터를 정적으로 처리하지 말 것

---

### Bruno 전체 기능 레퍼런스 (Phase 4 작업 전 반드시 숙지)

#### Bruno 블록 구조 (완전한 .bru 파일 구조)
```
meta {
  name: 요청명
  type: http
  seq: 순서번호
}

get/post/put/patch/delete {
  url: {{baseUrl}}/path/{{dynamicSegment}}
  body: json | form-urlencoded | multipart-form | text | xml | graphql | none
  auth: bearer | basic | digest | oauth2 | none
}

params:query {
  key: {{value}}
  ~disabledKey: value
}

headers {
  Content-Type: application/json
  Authorization: Bearer {{accessToken}}
  ~X-Disabled-Header: value
}

auth:bearer {
  token: {{accessToken}}
}

auth:basic {
  username: {{username}}
  password: {{password}}
}

body:json {
  {
    "key": "{{variable}}",
    "static": "hardcoded"
  }
}

body:form-urlencoded {
  key: {{variable}}
  staticKey: staticValue
}

body:multipart-form {
  fileField: @file(/path/to/file)
  textField: value
}

vars:pre {
  // 요청 전 정적 변수 (이 요청에서만 사용)
  staticVar: someValue
}

vars:post {
  // 응답 바디에서 값 추출 → 컬렉션 변수로 저장
  accessToken: res.body.data.token
  userId: res.body.data.user.id
  sessionKey: res.body.sessionKey
  // res.headers, res.status, res.body 모두 접근 가능
}

script:pre-request {
  // 요청 직전 실행 — 동적 값 계산, 암호화, 서명 생성
  // bru API 전체 사용 가능
  const timestamp = Date.now();
  bru.setVar('timestamp', timestamp);
}

script:post-response {
  // 응답 수신 후 실행 — 복잡한 값 추출, 조건부 처리
  const body = res.getBody();
  if (body.data?.token) {
    bru.setVar('accessToken', body.data.token);
  }
}

assert {
  // 응답 검증 (자동화 테스트)
  res.status: eq 200
  res.body.success: eq true
  res.body.data.token: isDefined
  res.responseTime: lt 3000
}

tests {
  // 상세 테스트 코드
  test("로그인 성공", function() {
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('token');
  });
}
```

#### Bruno bru API 완전 레퍼런스
```javascript
// 컬렉션 변수 (요청 간 공유)
bru.setVar('key', value)         // 값 저장
bru.getVar('key')                // 값 읽기

// 환경 변수 (.env 파일 또는 environments/*.bru)
bru.getEnvVar('KEY')             // 읽기
bru.setEnvVar('KEY', value)      // 쓰기 (주의: 환경 파일 실제 변경)

// 요청/응답 접근 (script:post-response 전용)
res.getStatus()                  // HTTP 상태코드
res.getHeaders()                 // 응답 헤더 객체
res.getHeader('content-type')    // 특정 헤더
res.getBody()                    // 응답 바디 (파싱된 JSON 또는 텍스트)

// 현재 요청 수정 (script:pre-request 전용)
req.setUrl(url)
req.setMethod('POST')
req.setHeader('X-Key', value)
req.setBody(body)

// 유틸리티
bru.cwd()                        // 컬렉션 루트 경로
bru.getRequestVar('key')         // vars:pre에서 정의한 값
```

#### Bruno 환경 파일 구조
```
{컬렉션폴더}/
├── environments/
│   ├── local.bru       ← 로컬 개발 환경
│   ├── prod.bru        ← 프로덕션 환경
│   └── .gitignore      ← secret.bru 제외
├── environments/secret.bru  ← 민감 정보 (gitignore 처리)
```

`environments/local.bru` 형식:
```
vars {
  baseUrl: https://example.com
  apiVersion: v1
}

vars:secret {
  username:
  password:
  accessToken:
}
```

`environments/secret.bru` (gitignore 처리 필수):
```
vars:secret {
  username: actualUsername
  password: actualPassword
}
```

#### 동적 파라미터 분류 기준 (Phase 4에서 반드시 적용)

캡처된 각 요청의 파라미터를 아래 기준으로 분류한다:

| 유형 | 예시 | Bruno 처리 방법 |
|------|------|----------------|
| **환경 변수** | baseUrl, apiKey, username, password | `bru.getEnvVar()` + `{{envVar}}` |
| **이전 응답에서 추출** | accessToken, sessionId, csrfToken | 이전 요청 `vars:post` → `{{varName}}` |
| **요청 시 계산** | timestamp, nonce, 랜덤 ID | `script:pre-request` + `bru.setVar()` |
| **암호화/서명** | ECIES encpw, HMAC signature, RSA ciphertext | `script:pre-request` + crypto 라이브러리 |
| **HTML에서 파싱** | dynamicKey, CSRF hidden input | 이전 GET 요청 `script:post-response` 파싱 |
| **정적 값** | Content-Type, svctype: '0', locale: 'ko_KR' | .bru에 직접 하드코딩 허용 |

#### 암호화 파라미터 탐지 패턴
요청 바디/헤더에서 다음 패턴 발견 시 `script:pre-request`로 처리:
- 매 요청마다 값이 변하는 긴 Base64 문자열 → 암호화된 값
- `encpw`, `encnm`, `cipherText`, `signature`, `hash` 키 → 암호화/서명
- 쉼표로 구분된 Base64 4개 (`a,b,c,d`) → ECIES 패턴
- `X-CSRF-Token`, `_token` → HTML에서 파싱 필요
- `tid=`, `q=` 타임스탬프 URL 파라미터 → 동적 생성

#### ECIES (타원곡선 암호화) 패턴 — Naver 등
```javascript
// script:pre-request 내부
const { ec: EC } = require('elliptic');
const CryptoJS = require('crypto-js');

const generateEccPw = (password, serverPublicKeyHex, sessionKey) => {
  const ec = new EC('p256');
  const ephemeralKey = ec.genKeyPair();
  const ephemeralPublicHex = ephemeralKey.getPublic(false, 'hex');
  const serverPublicKey = ec.keyFromPublic(serverPublicKeyHex, 'hex');
  const sharedSecretHex = ephemeralKey
    .derive(serverPublicKey.getPublic())
    .toString(16)
    .padStart(64, '0');
  const aesKeyHex = CryptoJS.SHA256(sharedSecretHex).toString(CryptoJS.enc.Hex);
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(
    password,
    CryptoJS.enc.Hex.parse(aesKeyHex),
    { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  );
  const cipherBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const ivBase64 = CryptoJS.enc.Base64.stringify(iv);
  return `${cipherBase64},${ivBase64},${ephemeralPublicHex},${sessionKey}`;
};

const password = bru.getEnvVar('PASSWORD');
const publicKey = bru.getVar('serverPublicKey');   // 이전 요청에서 추출
const sessionKey = bru.getVar('sessionKey');       // 이전 요청에서 추출
bru.setVar('encpw', generateEccPw(password, publicKey, sessionKey));
```

---

### 브라우저 준비

공통 탐지를 먼저 수행한다. 브라우저가 없으면 자동 실행 후 진행한다.

### Phase 1. 사용자에게 확인

브라우저가 준비되면 사용자에게 질문한다:
```
1. 어떤 사이트에서 작업하실 건가요? (URL 또는 사이트명)
2. 어떤 작업을 기록할 건가요? (예: 로그인, 글 포스팅, 상품 등록 등)
```

답변을 받아 컬렉션 폴더명 결정 규칙:
- `{사이트명}-{작업명}` 소문자, 공백은 하이픈
- 예: `naver-login`, `tistory-posting`, `coupang-product-register`

**컬렉션 루트 경로 (고정):** `/Volumes/T7_Mac/0.AITOM/3.bruno/`
**캡처 JSON 저장 경로:** `/Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}/captured-requests.json`

폴더 생성:
```bash
COLLECTION_DIR="/Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}"
mkdir "$COLLECTION_DIR"
mkdir "$COLLECTION_DIR/environments"
mkdir "$COLLECTION_DIR/src"
mkdir "$COLLECTION_DIR/src/api"
mkdir "$COLLECTION_DIR/src/flows"
```

### Phase 2. CDP 네트워크 캡처 시작

CDP 포트를 공통 탐지에서 파싱한 값으로 사용한다.
캡처 결과는 반드시 `/Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}/captured-requests.json` 에 저장한다.

아래 스크립트를 `/tmp/api-capture.js`로 저장:

```javascript
const CDP = require('chrome-remote-interface');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '9222');
const OUTPUT = process.argv[3] || '/tmp/captured-requests.json';
const STOP_FILE = '/tmp/stop-capture';

if (fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);

const captured = [];
const pending = {};

const isTarget = (type) => ['XHR', 'Fetch'].includes(type);

const run = async () => {
  const client = await CDP({ port: PORT });
  const { Network } = client;

  await Network.enable({ maxPostDataSize: 65536 });

  Network.requestWillBeSent(({ requestId, request, type, timestamp }) => {
    if (!isTarget(type)) return;
    pending[requestId] = {
      seq: captured.length + Object.keys(pending).length + 1,
      type,
      method: request.method,
      url: request.url,
      headers: request.headers,
      postData: request.postData || null,
      timestamp,
      response: null,
      responseBody: null,
    };
  });

  Network.responseReceived(({ requestId, response }) => {
    if (!pending[requestId]) return;
    pending[requestId].response = {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      mimeType: response.mimeType,
    };
  });

  Network.loadingFinished(async ({ requestId }) => {
    const req = pending[requestId];
    if (!req) return;
    try {
      const { body, base64Encoded } = await Network.getResponseBody({ requestId });
      req.responseBody = base64Encoded
        ? Buffer.from(body, 'base64').toString('utf8')
        : body;
    } catch (e) {
      req.responseBody = null;
    }
    captured.push(req);
    delete pending[requestId];
    fs.writeFileSync(OUTPUT, JSON.stringify(captured, null, 2));
    console.log('[CAPTURED]', req.method, req.url);
  });

  console.log('[CDP] 캡처 시작 - 포트:', PORT);

  const stopWatch = setInterval(() => {
    if (!fs.existsSync(STOP_FILE)) return;
    clearInterval(stopWatch);
    fs.writeFileSync(OUTPUT, JSON.stringify(captured, null, 2));
    console.log('[CDP] 완료 -', captured.length, '개 저장');
    client.close();
    process.exit(0);
  }, 500);
};

run().catch(err => {
  console.error('[CDP] 오류:', err.message);
  process.exit(1);
});
```

백그라운드 실행:
```bash
CAPTURE_OUTPUT="/Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}/captured-requests.json"
node /tmp/api-capture.js {CDP_PORT} "$CAPTURE_OUTPUT" > /tmp/capture.log 2>&1 &
echo $! > /tmp/capture-pid.txt
sleep 1
cat /tmp/capture.log
```

실행 확인 후 사용자에게 안내:
```
✅ 캡처 준비 완료!

이제 브라우저에서 {작업명}을 직접 진행해주세요.
모든 XHR/Fetch 요청이 자동으로 기록됩니다.

완료되면 "완료" 또는 "done"이라고 말씀해주세요.
```

### Phase 3. 완료 신호 → 캡처 중단

사용자가 "완료", "done", "끝" 신호를 보내면:

```bash
touch /tmp/stop-capture && sleep 2
cat /tmp/capture.log | tail -5
```

캡처 결과 확인:
```bash
CAPTURE_OUTPUT="/Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}/captured-requests.json"
node -e "
const d = require('$CAPTURE_OUTPUT');
console.log('캡처된 요청:', d.length, '개');
d.forEach((r, i) => console.log(i+1+'.', r.method, r.url, '->', r.response?.status));
"
```

### Phase 4. 동적 파라미터 분석 (Bruno 변환 전 필수)

캡처된 `captured-requests.json`을 읽고 각 요청의 파라미터를 분석한다.

**분석 항목:**
1. 요청 순서 파악 — 어떤 응답 값이 다음 요청에 사용되는가
2. 동적 파라미터 식별 — 매 요청마다 바뀌는 값 (토큰, 암호화값, 타임스탬프)
3. 의존관계 매핑 — `요청 N의 응답.X → 요청 M의 파라미터.Y`
4. 암호화 패턴 탐지 — 위 레퍼런스의 암호화 파라미터 탐지 패턴 적용
5. 정적 파라미터 확정 — 모든 요청에서 동일한 값

**분석 결과를 테이블로 출력:**
```
| 요청 | 파라미터 | 유형 | Bruno 처리 |
|------|---------|------|-----------|
| POST /login | username | 환경변수 | {{username}} |
| POST /login | encpw | ECIES 암호화 | script:pre-request |
| POST /login | sessionKey | 이전응답 추출 | vars:post + {{sessionKey}} |
| GET /user | Authorization | 이전응답 추출 | vars:post + auth:bearer |
```

### Phase 5. Bruno 컬렉션 파일 생성

**bruno.json 생성:**
```json
{
  "version": "1",
  "name": "{컬렉션명}",
  "type": "collection",
  "ignore": ["node_modules", ".git", "environments/secret.bru"]
}
```

**environments/local.bru 생성:**
```
vars {
  baseUrl: {사이트 기본 URL}
}

vars:secret {
  username:
  password:
  accessToken:
}
```

**environments/.gitignore 생성:**
```
secret.bru
```

**각 요청 → .bru 파일 변환 규칙:**

파일명: `{seq:02d}-{method}-{url마지막세그먼트}.bru`
예: `01-GET-login-page.bru`, `02-GET-dynamicEcKey.bru`, `03-POST-login.bru`

**.bru 파일 생성 원칙 (반드시 준수):**

1. **URL**: 도메인을 `{{baseUrl}}`로 치환. 동적 경로 세그먼트는 `{{varName}}`
2. **헤더 필터링**: `sec-*`, `:method`, `:path`, `:authority`, `:scheme`, `content-length` 제외. `cookie`는 Bruno가 자동 관리하므로 제외.
3. **정적 파라미터**: .bru 바디에 직접 작성
4. **동적 파라미터**: 반드시 `{{varName}}` + 해당 출처에 `vars:post` 또는 `script:pre-request`
5. **인증 정보**: 절대 하드코딩 금지 — `{{username}}`, `bru.getEnvVar('PASSWORD')`
6. **`vars:post` 우선**: 응답 바디에서 직접 추출 가능한 값은 `vars:post` 사용
7. **`script:pre-request` 필수**: 암호화, 서명, 해시, 타임스탬프 등 계산이 필요한 값
8. **`assert` 블록**: 각 요청에 최소 `res.status: eq 200` 추가 (또는 예상 상태코드)

**`vars:post` 패턴 예시:**
```
vars:post {
  accessToken: res.body.data.token
  userId: res.body.data.user.id
  // 배열 첫 번째 항목
  firstItemId: res.body.items[0].id
  // 헤더에서 추출
  sessionCookie: res.headers['set-cookie']
}
```

**`script:post-response` 패턴 예시 (복잡한 추출):**
```
script:post-response {
  // HTML에서 hidden input 파싱
  const html = res.getBody();
  const match = html.match(/name="dynamicKey"[^>]*value="([^"]+)"/);
  if (match) bru.setVar('dynamicKey', match[1]);

  // 조건부 추출
  const body = res.getBody();
  if (body?.data?.token) bru.setVar('accessToken', body.data.token);
}
```

**암호화 파라미터가 있는 요청의 .bru 예시 (ECIES):**
```
meta {
  name: 03 - POST Login
  type: http
  seq: 3
}

post {
  url: {{baseUrl}}/nidlogin.login
  body: form-urlencoded
  auth: none
}

headers {
  Referer: {{baseUrl}}/nidlogin.login
  Origin: {{baseUrl}}
}

body:form-urlencoded {
  encnm: {{sessionKey}}
  encpw: {{encpw}}
  id: {{username}}
  pw:
  svctype: 0
  url: https://www.naver.com
  ncptok: {{ncptToken}}
  stay: 1
  locale: ko_KR
}

script:pre-request {
  const { ec: EC } = require('elliptic');
  const CryptoJS = require('crypto-js');

  const generateEccPw = (password, serverPublicKeyHex, sessionKey) => {
    const ec = new EC('p256');
    const ephemeralKey = ec.genKeyPair();
    const ephemeralPublicHex = ephemeralKey.getPublic(false, 'hex');
    const serverPublicKey = ec.keyFromPublic(serverPublicKeyHex, 'hex');
    const sharedSecretHex = ephemeralKey
      .derive(serverPublicKey.getPublic())
      .toString(16)
      .padStart(64, '0');
    const aesKeyHex = CryptoJS.SHA256(sharedSecretHex).toString(CryptoJS.enc.Hex);
    const iv = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(
      password,
      CryptoJS.enc.Hex.parse(aesKeyHex),
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    );
    const cipherBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
    const ivBase64 = CryptoJS.enc.Base64.stringify(iv);
    return `${cipherBase64},${ivBase64},${ephemeralPublicHex},${sessionKey}`;
  };

  const password = bru.getEnvVar('password');
  const publicKey = bru.getVar('serverPublicKey');
  const sessionKey = bru.getVar('sessionKey');
  bru.setVar('encpw', generateEccPw(password, publicKey, sessionKey));
}

assert {
  res.status: in [200, 302]
}
```

Write 도구로 각 .bru 파일을 `/Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}/` 에 저장한다.
환경 파일은 `/Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}/environments/` 에 저장한다.

### Phase 6. TypeScript REST API 코드 생성

TypeScript 코드는 Bruno 컬렉션의 동적 파라미터 분석을 그대로 반영한다.

#### 코딩 원칙 (반드시 준수)
- **함수형 프로그래밍**: 순수 함수, `const fn = () => {}` 형식 (function 선언 금지)
- **단방향 데이터 흐름**: input → transform → output, 상태 역주입 금지
- **함수는 작게 전문적으로**: 하나의 함수 = 하나의 역할
- **불변성**: `var` 금지, `push/splice` 금지 → spread 사용
- **선언형**: `for` 루프 금지 → `map/filter/reduce` 사용
- **순수 함수 분리**: 암호화, 파싱, 변환 함수는 순수 함수로 작성
- **사이드이펙트 분리**: HTTP 요청, 파일 I/O, 환경변수 읽기는 별도 함수

#### 필수 생성 파일

**src/types.ts** — 요청/응답 타입
```typescript
// 캡처된 요청/응답 바디를 분석하여 타입 자동 생성
export type LoginRequest = { username: string; password: string };
export type LoginResponse = { token: string; userId?: string };
```

**src/cookie.ts** — 쿠키 관리 (세션 쿠키가 있는 경우 필수 생성)
```typescript
import { CookieJar } from 'tough-cookie';

const jar = new CookieJar();

const addCookies = (headers: Headers, url: string): void => {
  const setCookie = headers.get('set-cookie');
  if (setCookie) jar.setCookieSync(setCookie, url);
};

const getCookieHeader = (url: string): string =>
  jar.getCookiesSync(url).map(c => c.cookieString()).join('; ');

const clearJar = (): void => jar.removeAllCookiesSync();

export { addCookies, getCookieHeader, clearJar };
```

**src/client.ts** — fetch 래퍼 (쿠키 포함, 순수 함수)
```typescript
import { addCookies, getCookieHeader } from './cookie';

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 ...',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

const request = async <T>(url: string, options: RequestInit, asText = false): Promise<T> => {
  const cookieHeader = getCookieHeader(url);
  const headers = {
    ...BASE_HEADERS,
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };
  const res = await fetch(url, { ...options, headers, redirect: 'manual' });
  addCookies(res.headers, url);
  if (asText) return res.text() as Promise<T>;
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (location) return request<T>(location, { method: 'GET' });
  }
  const contentType = res.headers.get('content-type') ?? '';
  return contentType.includes('application/json')
    ? (res.json() as Promise<T>)
    : (res.text() as Promise<T>);
};

const get = <T>(url: string, headers: Record<string, string> = {}): Promise<T> =>
  request<T>(url, { method: 'GET', headers });

const getText = (url: string, headers: Record<string, string> = {}): Promise<string> =>
  request<string>(url, { method: 'GET', headers }, true);

const post = <T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> =>
  request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const postForm = <T>(url: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<T> =>
  request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });

export { get, getText, post, postForm };
```

**src/api/{domain}.ts** — 각 API 엔드포인트 (순수 함수)
```typescript
// 암호화가 필요한 파라미터는 순수 함수로 분리
const parseDynamicKey = (html: string): string => {
  const match = html.match(/name="dynamicKey"[^>]*value="([^"]+)"/);
  if (!match) throw new Error('dynamicKey not found');
  return match[1];
};

const fetchEcKey = (keyId: string): Promise<{ sessionKey: string; publicKey: string }> =>
  getText(`${BASE}/login/dynamicEcKey/${keyId}`, { Referer: `${BASE}/login` })
    .then(raw => {
      const [sessionKey, publicKey] = raw.split(',');
      return { sessionKey: sessionKey.trim(), publicKey: publicKey.trim() };
    });
```

**src/flows/{flow}.ts** — 단방향 흐름 조합
```typescript
// credentials → encrypt → submit → verify → result
const loginFlow = (creds: LoginRequest): Promise<LoginResult> =>
  fetchLoginPage()
    .then(html => parseDynamicKey(html))
    .then(keyId => fetchEcKey(keyId))
    .then(({ sessionKey, publicKey }) => ({
      sessionKey,
      encpw: generateEncryptedPassword(creds.password, publicKey, sessionKey),
    }))
    .then(({ sessionKey, encpw }) => submitLoginForm({ ...creds, sessionKey, encpw }))
    .then(verifySession);
```

**src/index.ts** — 진입점
```typescript
// Load .env
import fs from 'fs';
import path from 'path';
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(line => line.includes('=') && !line.startsWith('#'))
    .forEach(line => {
      const [key, ...rest] = line.split('=');
      process.env[key.trim()] = rest.join('=').trim();
    });
}
```

**.env** — 실제 인증 정보 (gitignore 처리)
```
SITE_USERNAME=
SITE_PASSWORD=
```

**.env.example** — 환경변수 템플릿
```
SITE_USERNAME=
SITE_PASSWORD=
```

**package.json** — 필요한 의존성 포함
```json
{
  "name": "{폴더명}",
  "type": "module",
  "scripts": {
    "start": "npx tsx src/index.ts",
    "debug": "npx tsx src/debug.ts"
  },
  "dependencies": {
    "elliptic": "^6.x",
    "crypto-js": "^4.x",
    "tough-cookie": "^4.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "@types/node": "^20.x",
    "@types/elliptic": "^6.x",
    "@types/crypto-js": "^4.x"
  }
}
```
(암호화 라이브러리는 탐지된 암호화 패턴에 따라 포함 여부 결정)

Write 도구로 모든 파일을 `/Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}/` 에 저장한다.

### Phase 7. 최종 보고

```
✅ 완료

| 항목 | 값 |
|------|-----|
| 캡처된 요청 | N개 |
| Bruno 컬렉션 | /Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}/ |
| .bru 파일 | N개 |
| 환경 파일 | environments/local.bru |
| TypeScript 파일 | types.ts, client.ts, cookie.ts, api/*.ts, flows/*.ts |
| 동적 파라미터 처리 | vars:post N개, script:pre-request N개 |

## API 흐름 분석
| 순서 | 메서드 | URL | 역할 | 동적 파라미터 | 의존관계 |
|------|--------|-----|------|-------------|----------|
| 1 | GET | /login | 로그인 페이지 | - | - |
| 2 | GET | /dynamicEcKey/{{keyId}} | EC 공개키 | keyId (HTML 파싱) | 1번 dynamicKey |
| 3 | POST | /login | 로그인 | encpw (ECIES 암호화) | 2번 publicKey, sessionKey |

## Bruno 실행 방법
1. Bruno 앱에서 컬렉션 열기: /Volumes/T7_Mac/0.AITOM/3.bruno/{폴더명}/
2. environments/local.bru에서 vars:secret 값 입력
3. 요청을 순서대로 실행 (seq 순서 보장)
```

---

## 인수 없이 `/bb` 만 입력한 경우

사용법을 안내:
```
/bb 1  → 브라우저 상태 체크 (CLI 세션 + CDP 포트 + 열린 페이지)
/bb 2  → 레퍼런스 시각화 (셀렉터 라벨 + 클릭 복사 + 아웃라인 오버레이)
/bb 3  → API 캡처 → Bruno 컬렉션 + TypeScript REST API 자동 생성

※ 모두 브라우저가 없으면 자동으로 실행합니다.
※ 세션이 끊어져도 /bb 2, /bb 3이 자동 재연결합니다.
```
