// 이 파일이 하는 일: AI 호출 오류를 서버 로그(<DATA_DIR>/logs/server.log)에 한 줄씩 남긴다. 기능·공급자·오류 코드·HTTP 상태만 적고,
// 키·프롬프트·공급자 오류 본문은 절대 적지 않는다(TD-008, FR-031 AC1). 로그를 못 써도 요청 처리는 계속한다.
import fs from 'node:fs';
import path from 'node:path';
import type { Clock } from '../lib/clock.ts';

/** 로그 파일 경로(main.ts와 같은 곳) */
export function serverLogPath(dataDir: string): string {
  return path.join(dataDir, 'logs', 'server.log');
}

/** 로그에 넣어도 되는 값만(영문·숫자·몇 가지 기호, 64자까지) */
function safe(v: string | number | null | undefined): string {
  return String(v ?? '-').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64) || '-';
}

/** AI 오류 한 줄을 남긴다 */
export function logAiEvent(
  dataDir: string,
  clock: Clock,
  e: { feature: string; provider: string; model?: string | null; code: string; httpStatus?: number | null; durationMs?: number },
): void {
  const line = `${clock.now().toISOString()} AI 오류 feature=${safe(e.feature)} provider=${safe(e.provider)} model=${safe(e.model)} code=${safe(e.code)} status=${safe(e.httpStatus)} ms=${safe(e.durationMs)}\n`;
  try {
    fs.mkdirSync(path.dirname(serverLogPath(dataDir)), { recursive: true });
    fs.appendFileSync(serverLogPath(dataDir), line);
  } catch {
    // 로그를 못 써도 사용자 요청은 계속 처리한다
  }
}
