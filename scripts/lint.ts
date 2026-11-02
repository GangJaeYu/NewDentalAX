// 이 파일이 하는 일: `npm run lint`의 본체. 타입 검사(서버·화면), ESLint, 머리 주석 검사를 차례로 실행하고
// 단계마다 "[lint:<단계>] checked <검사한 파일 수>" 줄을 출력한다(harness_setup/quality_gates/lint.md 계약).
// 자동 수정(--fix)은 하지 않는다. 한 단계라도 실패하면 나머지도 끝까지 돌린 뒤 종료 코드 1로 끝낸다.
// 사용법: node scripts/lint.ts [--steps tsc-server,tsc-web,eslint,headers] [--root <폴더>(headers 단계 전용)]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { checkFileHeaders, HEADER_TEXT } from './check-file-headers.ts';

const ROOT = process.cwd();
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

interface StepResult {
  checked: number;
  ok: boolean;
}

/** 인자에서 --name 값 읽기 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** tsc 실행(출력은 그대로 보여 줌) */
function runTsc(args: string[]) {
  return spawnSync(process.execPath, [TSC, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** 타입 검사 한 단계: 포함된 .ts/.tsx 파일 수를 세고, --noEmit으로 오류를 확인한다 */
function tscStep(project: string): StepResult {
  const list = runTsc(['-p', project, '--listFilesOnly']);
  const files = (list.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /\.(ts|tsx)$/.test(l) && !l.endsWith('.d.ts') && !l.includes('/node_modules/'));
  const r = runTsc(['--noEmit', '-p', project]);
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (out) console.log(out);
  return { checked: files.length, ok: r.status === 0 && list.status === 0 };
}

/** ESLint 단계: Node API로 실행해서 검사한 파일 수를 정확히 센다(쓰기 옵션 없음) */
async function eslintStep(): Promise<StepResult> {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: ROOT, fix: false, errorOnUnmatchedPattern: false });
  const results = await eslint.lintFiles(['.']);
  const formatter = await eslint.loadFormatter('stylish');
  const text = await formatter.format(results);
  if (text.trim()) console.log(text);
  const errors = results.reduce((n, r) => n + r.errorCount + r.fatalErrorCount, 0);
  const warnings = results.reduce((n, r) => n + r.warningCount, 0);
  // 경고도 통과로 넘기지 않는다: 규칙 예외가 필요하면 근거와 함께 설정에서 다룬다
  return { checked: results.length, ok: errors === 0 && warnings === 0 };
}

/** 머리 주석 단계 */
function headersStep(root: string): StepResult {
  const r = checkFileHeaders(root);
  if (r.missing.length) {
    console.log(`머리 주석("// ${HEADER_TEXT}: ...")이 첫 5줄 안에 없는 파일 ${r.missing.length}개:`);
    for (const m of r.missing) console.log(`  - ${m}`);
  }
  return { checked: r.checked, ok: r.missing.length === 0 };
}

const ALL = ['tsc-server', 'tsc-web', 'eslint', 'headers'] as const;
type Step = (typeof ALL)[number];

async function run(step: Step): Promise<StepResult> {
  switch (step) {
    case 'tsc-server':
      return tscStep('tsconfig.server.json');
    case 'tsc-web':
      return tscStep(path.join('web', 'tsconfig.json'));
    case 'eslint':
      return eslintStep();
    case 'headers':
      return headersStep(path.resolve(arg('--root') ?? ROOT));
  }
}

const wanted = (arg('--steps')?.split(',') ?? [...ALL]) as Step[];
const unknown = wanted.filter((s) => !ALL.includes(s));
if (unknown.length) {
  console.error(`알 수 없는 lint 단계: ${unknown.join(', ')} (가능: ${ALL.join(', ')})`);
  process.exit(2);
}

let failed: string[] = [];
for (const step of wanted) {
  const r = await run(step);
  console.log(`[lint:${step}] checked ${r.checked}${r.ok ? '' : ' — 실패'}`);
  if (!r.ok || r.checked === 0) failed = [...failed, step];
}
if (failed.length) {
  console.error(`\nlint 실패 단계: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nlint 모든 단계 통과');
