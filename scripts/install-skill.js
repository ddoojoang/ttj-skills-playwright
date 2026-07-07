#!/usr/bin/env node
/**
 * Claude Code 스킬 자동 설치
 * npm install 후 ~/.claude/skills/에 스킬을 복사합니다
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const skillName = 'ttj-skills-browser';
const skillSourceDir = path.join(__dirname, '..', '.claude', 'skills', skillName);
const skillTargetDir = path.join(homedir(), '.claude', 'skills', skillName);
const skillFile = 'SKILL.md';

try {
  // ~/.claude/skills 디렉토리 생성
  const skillsDir = path.join(homedir(), '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  // 대상 디렉토리 생성
  if (!fs.existsSync(skillTargetDir)) {
    fs.mkdirSync(skillTargetDir, { recursive: true });
  }

  // SKILL.md 복사
  const sourceFile = path.join(skillSourceDir, skillFile);
  const targetFile = path.join(skillTargetDir, skillFile);

  if (fs.existsSync(sourceFile)) {
    fs.copyFileSync(sourceFile, targetFile);
    console.log(`✅ Claude Code 스킬 설치 완료: ${targetFile}`);
    console.log(`   이제 어디서든 /TTJ-SKILLS-BROWSER 스킬을 사용할 수 있습니다!`);

    // 설치 완료 플래그 파일 생성 (빠른 확인용)
    const flagFile = path.join(homedir(), '.ttj-skills-browser-installed');
    fs.writeFileSync(flagFile, `${new Date().toISOString()}\n`);
  } else {
    console.warn(`⚠️  SKILL.md를 찾을 수 없습니다: ${sourceFile}`);
  }
} catch (err) {
  console.error(`❌ 스킬 설치 중 오류 발생:`, err.message);
  process.exit(1);
}
