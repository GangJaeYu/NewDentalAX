// 이 파일이 하는 일: 설치 리허설 기록(phase-05-task-05)과 PROGRESS.md 최종 보고 목록이 빠짐없이 남아 있는지 확인한다.
// 리허설 자체는 사람이(에이전트가) 새 폴더에서 start.bat을 실행해 남긴 기록이므로, 여기서는 그 기록의 내용을 검사한다.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, 'harness_setup/evidence/phase-05-task-05');
const read = (p: string) => fs.readFileSync(p, 'utf8');

/** PROGRESS.md에서 "## 제목" 아래 다음 "## " 전까지의 본문을 꺼낸다 */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) return '';
  const rest = text.slice(start + heading.length + 5);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('phase-05-task-05 설치 리허설·최종 보고', () => {
  test('phase-05-task-05 AC1 새 폴더 start.bat 로그에 npm ci·서버 시작·종료가 있고, 첫 설정 화면을 확인했다', () => {
    const out = read(path.join(EVIDENCE, 'rehearsal/start-bat-output.txt'));
    expect(out).toMatch(/필요한 파일을 내려받아요/);
    expect(out).toMatch(/added \d+ packages in \d+s/);
    expect(out).toMatch(/서버가 켜졌어요/);
    expect(out).toMatch(/stop\.bat 요청으로 서버를 껐어요/);
    const browser = read(path.join(EVIDENCE, 'rehearsal/browser-check.txt'));
    expect(browser).toMatch(/^redirect: \/ -> \/setup$/m);
    expect(browser).toMatch(/^problems: 0$/m);
    expect(fs.existsSync(path.join(EVIDENCE, 'rehearsal/01-setup-1280.png'))).toBe(true);
    const report = read(path.join(EVIDENCE, 'install-rehearsal.md'));
    expect(report).toMatch(/"ok":true/);
    expect(report).toMatch(/약 \d+초/);
  });

  test('phase-05-task-05 AC2 lint·unit·e2e 최종 수치가 기록되어 있다', () => {
    const report = read(path.join(EVIDENCE, 'install-rehearsal.md'));
    for (const gate of ['lint', 'unit', 'e2e']) {
      expect(report).toMatch(new RegExp(`\\| ${gate} \\| PASS \\| [^|]*\\d[^|]* \\| \`harness_setup/evidence/runs/[^\`]+-phase-05-task-05-${gate}\\.log\``));
    }
    const progress = read(path.join(ROOT, 'PROGRESS.md'));
    expect(section(progress, '최종 게이트 수치 (phase-05-task-05, 2026-11-03)')).toMatch(/e2e PASS: \d+건/);
  });

  test('phase-05-task-05 AC3 PROGRESS.md에 검증한 것·미검증·사용자 할 일 목록이 있다', () => {
    const progress = read(path.join(ROOT, 'PROGRESS.md'));
    const verified = section(progress, '검증한 것');
    // phase-01~05의 모든 태스크가 표에 있고, 적힌 독립 검증 파일이 실제로 있다
    const rows = [...verified.matchAll(/^\| (phase-0[1-5]-task-\d\d) \| [^|]+ \| ([^|]+) \|$/gm)];
    expect(rows.length).toBe(34);
    for (const [, id = '', cell = ''] of rows) {
      for (const file of cell.match(/validation-[\w-]+\.md/g) ?? []) {
        expect(fs.existsSync(path.join(ROOT, 'harness_setup/evidence', id, file)), `${id}/${file}`).toBe(true);
      }
    }
    expect(verified).toMatch(/docs\/PERF\.md/);
    expect(verified).toMatch(/docs\/SECURITY\.md/);
    expect(verified).toMatch(/설치 리허설/);
    const unverified = section(progress, '미검증');
    for (const word of ['AI 답 품질', '휴대폰', '방화벽', '더블클릭', '바코드']) expect(unverified).toContain(word);
    const todo = section(progress, '사용자 할 일');
    for (const word of ['LLM_GUIDE', '방화벽', 'start.bat', '관리자 2명', '백업', 'AI 답 품질', '데모 데이터 초기화', '외부 공개']) expect(todo).toContain(word);
  });
});
