// 이 파일이 하는 일: 게이트(lint·unit·e2e)를 실행하고, 실제로 검사가 돌았는지(0건 통과 금지)를 확인한 뒤 로그를 증거 폴더에 남긴다.
// 사용법: node harness_setup/scripts/gate.mjs <lint|unit|e2e> [태스크ID]
// 판정: PASS(종료 코드 0 + 실행 건수 > 0 + 건너뜀 0) / FAIL / INACTIVE(게이트 명령이 아직 없음 — 통과가 아님)
// 이 스크립트는 제품 코드·테스트·스냅샷을 고치지 않는다(--fix, -u 같은 옵션을 붙이지 않는다).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [gate, taskId = 'adhoc'] = process.argv.slice(2);
const SCRIPT = { lint: 'lint', unit: 'test:unit', e2e: 'test:e2e' }[gate];
if (!SCRIPT) {
  console.error('사용법: node harness_setup/scripts/gate.mjs <lint|unit|e2e> [태스크ID]');
  process.exit(2);
}

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evDir = path.join(root, 'harness_setup', 'evidence', 'runs');
fs.mkdirSync(evDir, { recursive: true });
const logPath = path.join(evDir, `${stamp}-${taskId}-${gate}.log`);

const finish = (verdict, reason, output = '') => {
  const head = `gate=${gate} task=${taskId} verdict=${verdict} reason=${reason}\n` +
    `commit=${gitHead()} dirty=${gitDirty()} at=${new Date().toISOString()}\n---\n`;
  fs.writeFileSync(logPath, head + output);
  console.log(`\n[${gate}] ${verdict} — ${reason}\n로그: ${path.relative(root, logPath)}`);
  process.exit(verdict === 'PASS' ? 0 : verdict === 'INACTIVE' ? 3 : 1);
};
function gitHead() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'none';
}
function gitDirty() {
  const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout.trim() ? 'yes' : 'no') : 'unknown';
}

// 게이트 명령이 있는지(미활성 판정)
const pkgPath = path.join(root, 'package.json');
if (!fs.existsSync(pkgPath)) finish('INACTIVE', 'package.json 없음(phase-01-task-01에서 활성화)');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (!pkg.scripts?.[SCRIPT]) finish('INACTIVE', `npm script "${SCRIPT}" 없음`);
if (/(--fix|--write|\s-u\b|--update)/.test(pkg.scripts[SCRIPT])) finish('FAIL', `"${SCRIPT}" 스크립트에 자동 수정 옵션이 들어 있음`);

const r = spawnSync('npm', ['run', SCRIPT], { encoding: 'utf8', shell: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + '\n' + (r.stderr || '');
process.stdout.write(out.slice(-6000));

if (r.status !== 0) finish('FAIL', `종료 코드 ${r.status}`, out);

// 실제 실행 건수 확인
if (gate === 'unit') {
  const m = out.match(/Tests\s+(\d+)\s+passed/);
  const skipped = out.match(/(\d+)\s+(skipped|todo)/);
  if (!m || +m[1] === 0) finish('FAIL', '실행된 단위 테스트 0건', out);
  if (skipped && +skipped[1] > 0) finish('FAIL', `건너뛴 테스트 ${skipped[1]}건`, out);
  finish('PASS', `단위 테스트 ${m[1]}건 통과`, out);
}
if (gate === 'e2e') {
  const m = out.match(/(\d+)\s+passed/);
  const skipped = out.match(/(\d+)\s+skipped/);
  const flaky = out.match(/(\d+)\s+flaky/);
  if (!m || +m[1] === 0) finish('FAIL', '실행된 E2E 0건', out);
  if (skipped && +skipped[1] > 0) finish('FAIL', `건너뛴 E2E ${skipped[1]}건`, out);
  if (flaky && +flaky[1] > 0) finish('FAIL', `흔들리는(flaky) E2E ${flaky[1]}건 — 원인 수정 필요`, out);
  finish('PASS', `E2E ${m[1]}건 통과`, out);
}
if (gate === 'lint') {
  // lint 스크립트는 각 단계가 "[lint:<단계>] checked N" 형식 줄을 출력해야 한다(phase-01-task-01 계약)
  const steps = [...out.matchAll(/\[lint:([\w-]+)\] checked (\d+)/g)];
  const need = ['tsc-server', 'tsc-web', 'eslint', 'headers'];
  const missing = need.filter((s) => !steps.some((m) => m[1] === s && +m[2] > 0));
  if (missing.length) finish('FAIL', `실행 확인되지 않은 lint 단계: ${missing.join(', ')}`, out);
  finish('PASS', `lint 단계 ${steps.map((m) => `${m[1]}(${m[2]})`).join(', ')}`, out);
}
