// 이 파일이 하는 일: 화면 입력 중 개인정보 경고(web/src/lib/privacy.ts)를 확인한다.
// 서버와 같은 규칙(shared/privacy-rules.ts)을 쓰는지, 경고 문구가 쉬운 한국어로 나오는지 본다(phase-02-task-01).
import { describe, expect, test } from 'vitest';
import { inputPrivacyWarning, PRIVACY_GUARD_TEXT } from './privacy.ts';
import { detectPii, scanPrivacy } from '../../../shared/privacy-rules.ts';

describe('phase-02-task-01 화면 입력 중 경고', () => {
  test('phase-02-task-01 AC2: 전화번호를 입력하면 가려진다는 노란 경고 문구를 만든다', () => {
    const w = inputPrivacyWarning('홍길동 010-1234-5678 연락');
    expect(w).toEqual({
      types: ['phone'],
      blockTypes: [],
      redactTypes: ['phone'],
      message: '전화번호로 보이는 내용이 있어요. 보내면 자동으로 가려집니다(예: [전화번호]). 환자 정보라면 지워 주세요.',
    });
  });

  test('phase-02-task-01 AC3: 주민번호는 보낼 수 없다는 경고를 먼저 보여 준다', () => {
    const w = inputPrivacyWarning('900101-1234567, 메일 a@b.com');
    expect(w?.blockTypes).toEqual(['rrn']);
    expect(w?.redactTypes).toEqual(['email']);
    expect(w?.message).toBe(
      '주민등록번호로 보이는 내용이 있어요. 이대로는 AI로 보낼 수 없으니 지워 주세요. ' +
        '이메일로 보이는 내용이 있어요. 보내면 자동으로 가려집니다(예: [이메일]). 환자 정보라면 지워 주세요.',
    );
  });

  test('phase-02-task-01 AC4: 허용 목록의 대표번호만 있으면 경고하지 않는다', () => {
    expect(inputPrivacyWarning('대표번호 02-123-4567 안내', { allowlist: ['02-123-4567'] })).toBeNull();
    expect(inputPrivacyWarning('대표번호 02-123-4567 안내')?.types).toEqual(['phone']);
  });

  test('phase-02-task-01 AC1: 날짜·금액·발주번호·사업자번호만 있으면 경고하지 않는다', () => {
    expect(inputPrivacyWarning('2026-11-02 PO-2611-003 1,234,000원 사업자등록번호 123-45-67890')).toBeNull();
    expect(inputPrivacyWarning('')).toBeNull();
  });

  test('phase-02-task-01 AC1: 화면 경고와 서버 판정(scanPrivacy)이 같은 규칙을 쓴다(감지 종류가 같다)', () => {
    const samples = ['010-1234-5678', '900101-1234567', 'a@b.com', '4111-1111-1111-1111', '계좌 110-123-456789', '여권 M12345678', 'PO-2611-003'];
    for (const s of samples) {
      const server = scanPrivacy(s).findings.map((f) => f.type);
      expect(inputPrivacyWarning(s)?.types ?? [], s).toEqual(server);
      expect(detectPii(s).map((m) => m.type), s).toEqual(server);
    }
  });

  test('phase-02-task-01: 관리자 정책을 넘기면 그에 맞춰 차단·가리기 문구를 고른다', () => {
    const w = inputPrivacyWarning('4111-1111-1111-1111', { policy: { card: 'redact' } });
    expect(w?.blockTypes).toEqual([]);
    expect(w?.redactTypes).toEqual(['card']);
    expect(PRIVACY_GUARD_TEXT).toContain('환자 개인정보 입력 금지');
  });
});
