// 이 파일이 하는 일: 오류 코드표와 AppError(lib/errors.ts), 서버 오류 처리기가 { error: { code, message, fields? } } 형식의
// 한국어 응답을 내는지, 그리고 시계(lib/clock.ts)가 고정·수동 진행되는지 확인한다(phase-01-task-02 범위: errors·clock).
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { AppError, ERROR_CODES, lockedError, toErrorResponse, validationError } from './errors.ts';
import { fixedClock, manualClock, MINUTE_MS } from './clock.ts';
import { buildApp } from '../app.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';

const tmp = makeTmpDir('dentalax-errors-');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('오류 코드표', () => {
  test('phase-01-task-02 범위(errors): backend.md §2 코드가 상태·한국어 문구와 함께 있다', () => {
    expect(ERROR_CODES.VALIDATION).toEqual([400, '입력값을 확인해 주세요.']);
    expect(ERROR_CODES.INVALID_LOGIN).toEqual([401, '아이디 또는 비밀번호가 맞지 않습니다.']);
    expect(ERROR_CODES.CSRF[0]).toBe(403);
    expect(ERROR_CODES.NETWORK_BLOCKED).toEqual([403, '원내 네트워크에서만 접속할 수 있습니다.']);
    expect(ERROR_CODES.FILE_TOO_LARGE).toEqual([413, '파일이 너무 큽니다(최대 20MB).']);
    expect(ERROR_CODES.MAINTENANCE[0]).toBe(503);
    expect(ERROR_CODES.AI_BUDGET_EXCEEDED[0]).toBe(402);
    expect(ERROR_CODES.AI_PII_BLOCKED[0]).toBe(422);
    for (const [code, [status, message]] of Object.entries(ERROR_CODES)) {
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(message, code).toMatch(/[가-힣]/);
    }
  });

  test('phase-01-task-02 범위(errors): AppError는 상태·코드·fields·추가 값을 응답 본문으로 바꾼다', () => {
    const e = validationError({ name: '이름을 적어 주세요.' });
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(400);
    expect(e.toBody()).toEqual({ error: { code: 'VALIDATION', message: '입력값을 확인해 주세요.', fields: { name: '이름을 적어 주세요.' } } });
    expect(new AppError('NOT_FOUND', { message: '품목을 찾을 수 없습니다.' }).toBody()).toEqual({ error: { code: 'NOT_FOUND', message: '품목을 찾을 수 없습니다.' } });
    const locked = lockedError(14 * 60 + 5);
    expect(locked.status).toBe(423);
    expect(locked.toBody().error).toEqual({ code: 'LOCKED', message: '로그인을 5번 실패해 15분 동안 잠겼습니다. 약 15분 뒤 다시 시도해 주세요.', retryAfterSec: 845 });
  });

  test('phase-01-task-02 범위(errors): 모르는 오류는 500 INTERNAL로 숨기고, 검증 오류는 400 VALIDATION', () => {
    expect(toErrorResponse(new Error('SQLITE_CORRUPT at /secret/path'))).toEqual({ status: 500, body: { error: { code: 'INTERNAL', message: ERROR_CODES.INTERNAL[1] } } });
    expect(toErrorResponse({ validation: [{}], statusCode: 400 }).body.error.code).toBe('VALIDATION');
    expect(toErrorResponse({ statusCode: 413 })).toMatchObject({ status: 413, body: { error: { code: 'FILE_TOO_LARGE' } } });
    expect(toErrorResponse({ statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY' })).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION' } } });
  });

  test('phase-01-task-02 범위(errors): 라우트에서 던진 AppError와 알 수 없는 오류가 한국어 API 오류 응답이 된다', async () => {
    const app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web') });
    app.get('/api/_test/app-error', async () => {
      throw new AppError('FORBIDDEN');
    });
    app.get('/api/_test/crash', async () => {
      throw new Error('내부 비밀 경로 C:\\data');
    });
    const a = await app.inject({ method: 'GET', url: '/api/_test/app-error' });
    expect(a.statusCode).toBe(403);
    expect(a.json()).toEqual({ error: { code: 'FORBIDDEN', message: '이 기능을 사용할 권한이 없습니다.' } });
    const b = await app.inject({ method: 'GET', url: '/api/_test/crash' });
    expect(b.statusCode).toBe(500);
    expect(b.json()).toEqual({ error: { code: 'INTERNAL', message: ERROR_CODES.INTERNAL[1] } });
    expect(b.body).not.toContain('비밀');
    await app.close();
  });
});

describe('시계', () => {
  test('phase-01-task-02 범위(clock): 고정 시계는 멈춰 있고, 수동 시계는 advance만큼 간다', () => {
    const f = fixedClock('2026-11-02T09:00:00+09:00');
    expect(f.now().toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(f.now().getTime()).toBe(f.now().getTime());
    const m = manualClock('2026-11-02T09:00:00+09:00');
    m.advance(15 * MINUTE_MS);
    expect(m.now().toISOString()).toBe('2026-11-02T00:15:00.000Z');
    m.set('2026-11-03T00:00:00Z');
    expect(m.now().toISOString()).toBe('2026-11-03T00:00:00.000Z');
    expect(() => fixedClock('어제')).toThrow('읽을 수 없어요');
  });
});
