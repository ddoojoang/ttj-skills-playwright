#!/usr/bin/env node
/**
 * Claude Code / Codex 스킬 자동 설치
 * npm install 후 Claude Code와 Codex의 사용자 전역 스킬 위치에 복사합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const skillName = 'ttj-skills-browser';
const skillSourceDir = path.join(__dirname, '..', '.claude', 'skills', skillName);
const skillFile = 'SKILL.md';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Codex frontmatter must stay in sync with the source description. We reuse
// the source's own `description:` line so it never drifts (e.g. stale
// "Playwright CLI" wording). Codex-specific fields (auto-invoke-keywords,
// allowed-tools) are dropped — only name + description are kept.
function extractDescription(content) {
  const match = content.match(/^description:\s*(.+)$/m);
  return match ? match[1].trim() : `${skillName} - dedicated CDP browser CLI`;
}

function toCodexSkill(content) {
  const description = extractDescription(content);
  const codexFrontmatter = `---\nname: ${skillName}\ndescription: ${description}\n---`;

  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) {
      return `${codexFrontmatter}${content.slice(end + 4)}`;
    }
  }

  return `${codexFrontmatter}\n\n${content}`;
}

try {
  const sourceFile = path.join(skillSourceDir, skillFile);

  if (fs.existsSync(sourceFile)) {
    const sourceContent = fs.readFileSync(sourceFile, 'utf8');

    // Claude Code: 기존 /ttj-skills-browser 호출 방식 유지
    const claudeTargetDir = path.join(homedir(), '.claude', 'skills', skillName);
    const claudeTargetFile = path.join(claudeTargetDir, skillFile);
    ensureDir(claudeTargetDir);
    fs.copyFileSync(sourceFile, claudeTargetFile);
    console.log(`✅ Claude Code 스킬 설치 완료: ${claudeTargetFile}`);
    console.log(`   이제 어디서든 /ttj-skills-browser 스킬을 사용할 수 있습니다!`);

    // Codex: 사용자 전역 스킬 위치에 lower-case kebab-case 이름으로 설치
    const codexTargetDir = path.join(homedir(), '.agents', 'skills', skillName);
    const codexTargetFile = path.join(codexTargetDir, skillFile);
    ensureDir(codexTargetDir);
    fs.writeFileSync(codexTargetFile, toCodexSkill(sourceContent));
    console.log(`✅ Codex 스킬 설치 완료: ${codexTargetFile}`);
    console.log(`   이제 Codex에서 $${skillName} 스킬을 사용할 수 있습니다!`);

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
