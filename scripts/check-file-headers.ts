// 이 파일이 하는 일: 모든 소스 파일의 첫 5줄 안에 "이 파일이 하는 일" 한국어 요약 주석이 있는지 검사한다(NFR-010).
// 대상: server/ web/src/ shared/ scripts/ tests/ 아래 소스 파일과 루트 설정 파일·실행 배치 파일(.bat·.cmd). tests/fixtures/는 검사 자료라 뺀다.
// 사용법: node scripts/check-file-headers.ts [--root <폴더>]   (빠진 파일이 있으면 목록을 출력하고 종료 코드 1)
import fs from 'node:fs';
import path from 'node:path';

/** 검사하는 폴더(프로젝트 폴더 기준) */
export const HEADER_DIRS = ['server', 'web/src', 'shared', 'scripts', 'tests'];
/** 폴더 밖에서 따로 검사하는 루트 파일(없으면 건너뜀) */
export const HEADER_ROOT_FILES = [
  'config/vite.config.ts', 'config/vitest.config.ts', 'config/playwright.config.ts', 'config/eslint.config.js',
  'web/index.html', 'start.bat', 'stop.bat',
];
/** 소스 파일로 보는 확장자 */
export const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.sql', '.html', '.bat', '.cmd', '.ps1']);
/** 검사하지 않는 폴더 이름(경로 일부) */
const SKIP_PARTS = ['node_modules', 'dist', 'fixtures'];

export const HEADER_TEXT = '이 파일이 하는 일';

export interface HeaderResult {
  /** 검사한 파일 수 */
  checked: number;
  /** 머리 주석이 없는 파일(프로젝트 폴더 기준 상대 경로, / 구분) */
  missing: string[];
}

/** 폴더 아래 소스 파일을 모두 찾는다 */
function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_PARTS.includes(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile() && SOURCE_EXT.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
}

/** 파일 첫 5줄 안에 머리 주석 문구가 있는지 */
export function hasHeader(text: string): boolean {
  return text.split(/\r?\n/, 5).some((line) => line.includes(HEADER_TEXT));
}

/** root 폴더 기준으로 머리 주석 검사를 한다 */
export function checkFileHeaders(root: string = process.cwd()): HeaderResult {
  const files: string[] = [];
  for (const d of HEADER_DIRS) walk(path.join(root, d), files);
  for (const f of HEADER_ROOT_FILES) {
    const full = path.join(root, f);
    if (fs.existsSync(full) && !files.includes(full)) files.push(full);
  }
  const missing = files
    .filter((f) => !hasHeader(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
  return { checked: files.length, missing };
}

if (import.meta.main) {
  const i = process.argv.indexOf('--root');
  const root = i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1] as string) : process.cwd();
  const r = checkFileHeaders(root);
  console.log(`[lint:headers] checked ${r.checked}`);
  if (r.missing.length) {
    console.error(`머리 주석("// ${HEADER_TEXT}: ...")이 첫 5줄 안에 없는 파일 ${r.missing.length}개:`);
    for (const m of r.missing) console.error(`  - ${m}`);
    process.exit(1);
  }
}
