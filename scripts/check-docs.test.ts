// 이 파일이 하는 일: 문서 검사(scripts/check-docs.ts)와 lint의 docs 단계가 실제 문서를 통과시키고, 소제목·확인일·출처·그림이 빠진 문서는 잡아내는지 확인한다(phase-05-task-04).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import { checkDocs, imageLinks, missingHeadings, REQUIRED_HEADINGS, sectionBody, tableRows, unsourcedRows } from './check-docs.ts';
import { readmeShots } from './screens/phase-05-task-04.ts';
import { makeTmpDir } from '../tests/helpers/tmp-dir.ts';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** 실제 문서를 복사한 가짜 프로젝트 폴더(일부 문서를 바꿔 끼울 수 있다) */
function copyDocs(replace: Record<string, (text: string) => string> = {}): string {
  const root = makeTmpDir('docs-');
  dirs.push(root);
  for (const rel of Object.keys(REQUIRED_HEADINGS)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const text = read(rel);
    fs.writeFileSync(full, replace[rel] ? replace[rel](text) : text);
  }
  fs.cpSync(path.join(ROOT, 'docs', 'images'), path.join(root, 'docs', 'images'), { recursive: true });
  return root;
}

describe('phase-05-task-04 문서 검사', () => {
  test('phase-05-task-04 AC1: 실제 문서 7개에 원문 12·13절 필수 소제목이 빠짐없이 있다(누락 0건)', () => {
    const r = checkDocs(ROOT);
    expect(r.problems).toEqual([]);
    expect(r.checked).toBe(Object.keys(REQUIRED_HEADINGS).length);
  });

  test('phase-05-task-04 AC1: lint의 docs 단계가 돌고 검사한 문서 수를 출력한다', () => {
    const r = spawnSync(process.execPath, ['scripts/lint.ts', '--steps', 'docs'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stdout).toContain(`[lint:docs] checked ${Object.keys(REQUIRED_HEADINGS).length}`);
    expect(r.status).toBe(0);
  });

  test('phase-05-task-04 AC1: 소제목이 하나라도 빠지면 lint docs 단계가 실패한다', () => {
    const root = copyDocs({ 'docs/GUIDE.md': (t) => t.replace(/^## 백업과 복원.*$/m, '## 데이터 보관') });
    expect(checkDocs(root).problems).toContain('docs/GUIDE.md: 필수 소제목 "백업과 복원"이(가) 없어요');
    const r = spawnSync(process.execPath, ['scripts/lint.ts', '--steps', 'docs', '--root', root], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('백업과 복원');
  });

  test('phase-05-task-04 AC1: 코드 블록 안의 # 줄은 소제목으로 세지 않는다', () => {
    expect(missingHeadings('```\n## 할 수 있는 일\n```\n', ['할 수 있는 일'])).toEqual(['할 수 있는 일']);
    expect(missingHeadings('## 할 수 있는 일 (화면)\n', ['할 수 있는 일'])).toEqual([]);
  });

  test('phase-05-task-04 AC2: COST.md 가격표·데이터 정책표의 모든 줄에 확인일과 출처 URL이 있다', () => {
    const cost = read('docs/COST.md');
    for (const sec of ['공급자·모델 가격 비교표', '공급자별 데이터 정책']) {
      const body = sectionBody(cost, sec);
      expect(body, sec).not.toBeNull();
      const rows = tableRows(body as string);
      // 가격표는 3사 × 3등급 = 9줄 이상, 데이터 정책은 3사 이상
      expect(rows.length, sec).toBeGreaterThanOrEqual(sec.startsWith('공급자·모델') ? 9 : 3);
      expect(unsourcedRows(body as string), sec).toEqual([]);
      for (const r of rows) expect(r).toMatch(/2026-11-03/);
    }
  });

  test('phase-05-task-04 AC2: 확인일이나 출처가 빠진 가격 줄은 문제로 잡는다', () => {
    const body = ['| 공급자 | 모델 | 확인일 | 출처 |', '|---|---|---|---|', '| A | m1 | 2026-11-03 | https://example.com/p |', '| B | m2 | 2026-11-03 | 공식 페이지 |', '| C | m3 | 어제 | https://example.com/q |'].join('\n');
    expect(tableRows(body)).toHaveLength(3);
    expect(unsourcedRows(body).map((r) => (r.split('|')[1] ?? '').trim())).toEqual(['B', 'C']);
    const root = copyDocs({ 'docs/COST.md': (t) => t.replace(/(## 공급자·모델 가격 비교표[^\n]*\n)/, '$1\n| 공급자 | 모델 |\n|---|---|\n| X | 확인 안 됨 |\n') });
    expect(checkDocs(root).problems.some((p) => p.includes('확인일 또는 출처 주소가 없어요'))).toBe(true);
  });

  test('phase-05-task-04 AC3: 안내서(README에서 옮긴 docs/GUIDE.md)가 가리키는 스크린샷 파일이 모두 있고, 촬영 목록(readmeShots)의 화면이 빠짐없이 실려 있다', () => {
    const guide = read('docs/GUIDE.md');
    // 안내서는 docs/ 안에 있어서 그림 경로가 docs/ 기준(images/…)이다. 저장소 기준 경로로 바꿔 비교한다
    const imgs = imageLinks(guide).map((p) => path.posix.join('docs', p));
    for (const img of imgs) expect(fs.existsSync(path.join(ROOT, img)), img).toBe(true);
    for (const s of readmeShots) {
      const rel = `docs/images/${s.file}.png`;
      expect(imgs, rel).toContain(rel);
      const buf = fs.readFileSync(path.join(ROOT, rel));
      // PNG 파일이고 촬영 목록의 너비로 찍혔다(IHDR 너비 = 16~19바이트)
      expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(buf.readUInt32BE(16), rel).toBe(s.width);
    }
    expect(readmeShots.some((s) => s.width === 390)).toBe(true);
    // 그림 없는 README는 잡는다
    const root = copyDocs({ 'README.md': (t) => t.replace(/!\[[^\]]*\]\([^)]*\)/g, '') });
    expect(checkDocs(root).problems.some((p) => p.includes('화면 그림이 0장뿐'))).toBe(true);
  });

  test('phase-05-task-04 AC4: 안내서(docs/GUIDE.md) 설치 절차가 실제 실행 파일·요구 버전과 맞는다(리허설은 phase-05-task-05)', () => {
    const readme = read('docs/GUIDE.md');
    const install = sectionBody(readme, '설치하기 (Windows)') as string;
    expect(install).toMatch(/Node\.js 24 LTS/);
    expect(install).toContain('https://nodejs.org');
    expect(install).toContain('start.bat');
    const pkg = JSON.parse(read('package.json')) as { engines: { node: string } };
    expect(pkg.engines.node).toBe('>=24');
    expect(fs.existsSync(path.join(ROOT, 'start.bat'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'stop.bat'))).toBe(true);
    // start.bat이 안내하는 주소·포트와 같다
    expect(readme).toContain('http://localhost:8090');
    expect(read('scripts/windows/start-main.cmd')).toContain('Node.js 24 LTS');
  });
});
