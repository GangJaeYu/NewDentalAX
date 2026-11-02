// 이 파일이 하는 일: 백업 파일 작업의 "잠깐 잠김" 다시 시도 도우미(backup-fs.ts)를 확인한다(phase-02-task-05 통합 unit 간헐 실패 수정).
// EPERM·EBUSY 같은 잠김은 풀릴 때까지 다시 시도하고, 다른 오류는 바로 던지며, 정해진 횟수가 지나면 포기하는지 본다.
import { describe, expect, test } from 'vitest';
import { isTransientFsError, retryFs, retryFsSync } from './backup-fs.ts';

/** code가 붙은 파일 오류를 만든다 */
function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: 시험 오류`), { code });
}

describe('파일 작업 다시 시도', () => {
  test('phase-02-task-05 범위: EPERM·EBUSY는 풀릴 때까지 다시 시도한다(동기·비동기)', async () => {
    let n = 0;
    expect(
      retryFsSync(() => {
        n += 1;
        if (n < 3) throw fsError(n === 1 ? 'EPERM' : 'EBUSY');
        return 'ok';
      }, { delayMs: 1 }),
    ).toBe('ok');
    expect(n).toBe(3);

    let m = 0;
    await expect(
      retryFs(async () => {
        m += 1;
        if (m < 4) throw fsError('EPERM');
        return 'ok';
      }, { delayMs: 1 }),
    ).resolves.toBe('ok');
    expect(m).toBe(4);
  });

  test('phase-02-task-05 범위: 잠김이 아닌 오류(ENOENT)는 다시 시도하지 않고, 잠김도 정한 횟수가 지나면 포기한다', async () => {
    let n = 0;
    expect(() =>
      retryFsSync(() => {
        n += 1;
        throw fsError('ENOENT');
      }),
    ).toThrow('ENOENT');
    expect(n).toBe(1);

    let m = 0;
    await expect(
      retryFs(() => {
        m += 1;
        throw fsError('EBUSY');
      }, { attempts: 5, delayMs: 1 }),
    ).rejects.toThrow('EBUSY');
    expect(m).toBe(5);
    expect(isTransientFsError(fsError('EACCES'))).toBe(true);
    expect(isTransientFsError(new Error('x'))).toBe(false);
  });
});
