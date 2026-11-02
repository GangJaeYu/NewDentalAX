// 이 파일이 하는 일: 머리 주석 검사(check-file-headers)와 lint의 headers 단계가 머리 주석이 없는 파일을 찾아 실패시키는지 확인한다(phase-01-task-01 AC1).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import { checkFileHeaders, hasHeader } from './check-file-headers.ts';
import { makeTmpDir } from '../tests/helpers/tmp-dir.ts';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** 가짜 프로젝트 폴더를 만든다: files는 {상대 경로: 내용} */
function fakeProject(files: Record<string, string>): string {
  const root = makeTmpDir('headers-');
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return root;
}

const GOOD = '// 이 파일이 하는 일: 테스트용 파일\nexport const a = 1;\n';

describe('check-file-headers', () => {
  test('phase-01-task-01 AC1: 첫 5줄 안의 머리 주석만 인정한다', () => {
    expect(hasHeader(GOOD)).toBe(true);
    expect(hasHeader('/* 이 파일이 하는 일: css */\nbody{}')).toBe(true);
    expect(hasHeader('a\nb\nc\nd\n// 이 파일이 하는 일: 다섯째 줄')).toBe(true);
    expect(hasHeader('a\nb\nc\nd\ne\n// 이 파일이 하는 일: 여섯째 줄')).toBe(false);
    expect(hasHeader('export const a = 1;\n')).toBe(false);
  });

  test('phase-01-task-01 AC1: 머리 주석이 없는 임시 파일을 넣으면 그 파일을 찾아낸다(fixtures·node_modules는 제외)', () => {
    const root = fakeProject({
      'server/ok.ts': GOOD,
      'server/sub/no-header.ts': 'export const b = 2;\n',
      'web/src/App.tsx': GOOD,
      'web/src/styles/x.css': 'body { color: red; }\n',
      'tests/fixtures/kb/manual.html': '<p>검사 자료</p>',
      'server/node_modules/pkg/index.js': 'module.exports = 1;',
      'docs/note.ts': 'export {}', // 검사 대상 폴더가 아님
    });
    const r = checkFileHeaders(root);
    expect(r.checked).toBe(4);
    expect(r.missing).toEqual(['server/sub/no-header.ts', 'web/src/styles/x.css']);
  });

  test('phase-01-task-01 AC1: lint의 headers 단계가 머리 주석 없는 파일 때문에 실패(종료 코드 1)한다', () => {
    const root = fakeProject({ 'server/ok.ts': GOOD, 'scripts/tmp-no-header.ts': 'console.log(1);\n' });
    const r = spawnSync(process.execPath, ['scripts/lint.ts', '--steps', 'headers', '--root', root], { encoding: 'utf8' });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status).toBe(1);
    expect(out).toContain('[lint:headers] checked 2');
    expect(out).toContain('scripts/tmp-no-header.ts');
    expect(out).toContain('lint 실패 단계: headers');
  });

  test('phase-01-task-01 AC1: 머리 주석이 모두 있으면 headers 단계가 통과한다', () => {
    const root = fakeProject({ 'server/ok.ts': GOOD, 'shared/x.ts': GOOD });
    const r = spawnSync(process.execPath, ['scripts/lint.ts', '--steps', 'headers', '--root', root], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[lint:headers] checked 2');
  });

  test('phase-01-task-01 AC1: 지금 저장소의 모든 소스 파일에 머리 주석이 있다', () => {
    const r = checkFileHeaders(process.cwd());
    expect(r.checked).toBeGreaterThan(10);
    expect(r.missing).toEqual([]);
  });
});
