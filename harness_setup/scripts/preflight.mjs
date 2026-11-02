// 이 파일이 하는 일: 검증을 시작하기 전에 이 PC에 필요한 도구·포트·런타임 기능이 갖춰졌는지 확인하고 결과를 표로 출력한다.
// 사용법: node harness_setup/scripts/preflight.mjs   (실패 항목이 있으면 종료 코드 1)
// 반복 실행해도 아무것도 바꾸지 않는다(읽기 전용 점검).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: String(detail ?? '') });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message.split('\n')[0] });
  }
};
const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// 포트가 비어 있는지: 실제로 열어 보고 바로 닫는다
const portFree = (port) => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', () => reject(new Error(`포트 ${port} 사용 중`)));
  s.listen(port, '0.0.0.0', () => s.close(() => resolve(`포트 ${port} 비어 있음`)));
});

await check('Node.js 24 이상', () => {
  const major = +process.versions.node.split('.')[0];
  if (major < 24) throw new Error(`현재 ${process.versions.node}`);
  return process.versions.node;
});
await check('npm', () => run('npm -v'));
await check('git', () => run('git --version'));
await check('node:sqlite + FTS5', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec("create virtual table t using fts5(x, tokenize='unicode61')");
  return db.prepare('select sqlite_version() v').get().v;
});
await check('Microsoft Edge 설치(E2E 브라우저)', () => {
  const cands = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('msedge.exe 없음');
  return hit;
});
await check('Playwright로 Edge 실행', async () => {
  const proj = process.cwd();
  const pw = path.join(proj, 'node_modules', '@playwright', 'test');
  if (!fs.existsSync(pw)) return '건너뜀: @playwright/test 미설치(phase-01-task-01에서 설치) — 2026-11-02 별도 실험으로 확인됨';
  const { chromium } = await import('file:///' + path.join(proj, 'node_modules', 'playwright-core', 'index.mjs').replace(/\\/g, '/'));
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const v = b.version();
  await b.close();
  return `Edge ${v}`;
});
// 8090=제품, 18090~18093=구현 워커 슬롯 0~3의 E2E, 18094~18097=검증 워커 슬롯 0~3 (loop_setup/LOOP.md §4)
for (const p of [8090, 18090, 18091, 18092, 18093, 18094, 18095, 18096, 18097]) await check(`포트 ${p}`, () => portFree(p));
await check('디스크 여유(작업 드라이브)', () => {
  const out = run('powershell -NoProfile -Command "(Get-PSDrive C).Free/1GB"');
  const gb = parseFloat(out);
  if (gb < 5) throw new Error(`여유 ${gb.toFixed(1)}GB (<5GB)`);
  return `${gb.toFixed(1)}GB`;
});

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n실패 ${failed.length}건` : '\n모든 점검 통과');
process.exit(failed.length ? 1 : 0);
