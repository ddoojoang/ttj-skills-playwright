---
name: TTJ-SKILLS-BROWSER
description: TTJ Skills Browser - Playwright CLI + 자동 프로필 & 설치 관리
disable-model-invocation: true
allowed-tools: Bash, Read, Write
---

# TTJ Skills Browser

npm 패키지: `npm install -g ttj-skills-browser`
명령: `/TTJ-SKILLS-BROWSER`

## 기능
- ✅ playwright-cli 자동 설치 확인
- ✅ Chrome/Chromium 설치 확인
- ✅ ~/.ttj-skills-browser 프로필 자동 생성
- ✅ 포트 9227 자동 할당
- ✅ 브라우저 자동 실행
- ✅ 버전 자동 체크 및 업데이트 알림

## 사용 방법
```bash
npm install -g ttj-skills-browser
ttj-skills-browser
```

## 실행 흐름
1. playwright-cli 탐지/설치
2. Chrome 탐지
3. 프로필 생성
4. 포트 확인 (9227 또는 다음 가능한 포트)
5. 브라우저 실행
6. 버전 체크 → 업데이트 알림

## 설치 확인 (빠름 <0.1초)
```bash
# 빠른 확인: 설치 플래그 파일 확인
[ -f ~/.ttj-skills-browser-installed ] && echo "설치됨" || echo "미설치"
```

## 업데이트 확인
```bash
# 최신 버전으로 업데이트
npm install -g ttj-skills-browser@latest
```
