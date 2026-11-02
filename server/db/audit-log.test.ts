// 이 파일이 하는 일: 감사 로그가 고쳐지거나 지워지지 않는지(DB 트리거) 확인하고, audit() 함수가 시각·사용자·IP·detail을
// 제대로 남기며 비밀 항목을 가리는지 확인한다(phase-01-task-02 AC2, FR-005 AC3).
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openAppDb } from './migrate.ts';
import type { Db } from './index.ts';
import { audit, REDACTED, scrubDetail, type AuditRow } from '../lib/audit.ts';
import { fixedClock } from '../lib/clock.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';

let tmp: string;
let db: Db;
const clock = fixedClock('2026-11-02T09:00:00+09:00');

beforeEach(() => {
  tmp = makeTmpDir('dentalax-audit-');
  db = openAppDb(tmp, { clock }).db;
});
afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('audit_log 고치기·지우기 금지', () => {
  test('phase-01-task-02 AC2: audit_log에 UPDATE를 실행하면 오류가 나고 행이 그대로 남는다', () => {
    const id = audit({ db, clock, user: { id: 1, username: 'admin' }, ip: '192.168.0.5' }, 'user.create', 'user', 7, { role: 'staff' });
    const before = db.get<AuditRow>('SELECT * FROM audit_log WHERE id = ?', [id]);
    expect(() => db.run("UPDATE audit_log SET action = 'hacked' WHERE id = ?", [id])).toThrow('감사 로그는 고칠 수 없습니다');
    expect(() => db.run("UPDATE audit_log SET detail = NULL")).toThrow('감사 로그는 고칠 수 없습니다');
    expect(db.get<AuditRow>('SELECT * FROM audit_log WHERE id = ?', [id])).toEqual(before);
    expect(before?.action).toBe('user.create');
  });

  test('phase-01-task-02 AC2: audit_log에 DELETE를 실행하면 오류가 나고 행이 그대로 남는다', () => {
    audit({ db, clock }, 'auth.login_failed', 'user', null, { username: 'kim' });
    audit({ db, clock }, 'settings.update', 'settings', 'clinic');
    expect(() => db.run('DELETE FROM audit_log WHERE id = 1')).toThrow('감사 로그는 지울 수 없습니다');
    expect(() => db.run('DELETE FROM audit_log')).toThrow('감사 로그는 지울 수 없습니다');
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n).toBe(2);
  });

  test('phase-01-task-02 AC2: 트랜잭션 안에서 지우려 해도 되돌려지고 앞서 쓴 기록도 남는다', () => {
    audit({ db, clock }, 'backup.create');
    expect(() =>
      db.tx(() => {
        audit({ db, clock }, 'demo.reset');
        db.run('DELETE FROM audit_log');
      }),
    ).toThrow('감사 로그는 지울 수 없습니다');
    // 트랜잭션 전체가 되돌려져 처음 1건만 남는다
    expect(db.all<AuditRow>('SELECT action FROM audit_log').map((r) => r.action)).toEqual(['backup.create']);
  });
});

describe('audit() 함수', () => {
  test('phase-01-task-02 AC2: 주입 시계의 시각·사용자·IP·대상·detail(JSON)을 남긴다', () => {
    const id = audit({ db, clock, user: { id: 3, username: 'manager1' }, ip: '192.168.0.23' }, 'item.update', 'item', 42, { field: 'par_level', from: 5, to: 8 });
    const row = db.get<AuditRow>('SELECT * FROM audit_log WHERE id = ?', [id]);
    expect(row).toEqual({
      id,
      at: '2026-11-02T00:00:00.000Z',
      user_id: 3,
      username: 'manager1',
      action: 'item.update',
      target_type: 'item',
      target_id: '42',
      detail: JSON.stringify({ field: 'par_level', from: 5, to: 8 }),
      ip: '192.168.0.23',
    });
  });

  test('phase-01-task-02 AC2: 로그인 전(사용자 없음)이면 user_id·username이 비어 있다', () => {
    const id = audit({ db, clock, user: null }, 'auth.login_failed');
    expect(db.get<AuditRow>('SELECT user_id, username, target_type, detail FROM audit_log WHERE id = ?', [id])).toEqual({
      user_id: null, username: null, target_type: null, detail: null,
    });
  });

  test('phase-01-task-02 AC2: detail의 비밀번호·토큰·키 항목은 저장 전에 가린다(토큰 개수 같은 숫자는 남긴다)', () => {
    const id = audit({ db, clock }, 'ai.settings_update', 'settings', 'ai', {
      provider: 'anthropic', apiKey: 'sk-secret-1234', keys: { anthropic: 'x' }, nested: { tempPassword: 'Temp1234!' }, inputTokens: 120, csrfToken: 'abc',
    });
    const detail = db.get<{ detail: string }>('SELECT detail FROM audit_log WHERE id = ?', [id])?.detail ?? '';
    expect(detail).not.toContain('sk-secret-1234');
    expect(detail).not.toContain('Temp1234!');
    expect(JSON.parse(detail)).toEqual({ provider: 'anthropic', apiKey: REDACTED, keys: REDACTED, nested: { tempPassword: REDACTED }, inputTokens: 120, csrfToken: REDACTED });
    expect(scrubDetail([{ password: 'p' }])).toEqual([{ password: REDACTED }]);
  });
});
