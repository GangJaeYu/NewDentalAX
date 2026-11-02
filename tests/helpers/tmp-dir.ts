// 이 파일이 하는 일: 테스트용 임시 폴더를 작업 사본 안 .tmp/unit/ 아래에 만든다(실제 data/ 폴더나 시스템 임시 폴더를 쓰지 않기 위함).
import fs from 'node:fs';
import path from 'node:path';

/** .tmp/unit/<prefix>XXXXXX 폴더를 새로 만들어 경로를 돌려준다 */
export function makeTmpDir(prefix: string): string {
  const base = path.join(process.cwd(), '.tmp', 'unit');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}
