// 이 파일이 하는 일: 데스크 AI 공용 규칙(shared/desk-texts.ts)의 순수 계산을 확인한다(phase-03-task-05 AC1·AC3·AC4·AC5).
// 진료시간 글("토요일 9:30~14:00"), 템플릿 치환자 채우기·고르기 목록(환자 이름 없음), 문자 바이트 수(단문 90바이트·장문), 답글의 진료 사실 확인 표현 점검을 본다.
import { describe, expect, test } from 'vitest';
import { defaultClinic } from './schemas/admin.ts';
import {
  checkReplyFacts,
  fillPlaceholders,
  formatHours,
  PLACEHOLDERS,
  scanPlaceholders,
  situationKind,
  smsBytes,
  smsKind,
  SMS_SHORT_BYTES,
} from './desk-texts.ts';

const clinic = { ...defaultClinic('하늘숲치과'), phone: '02-123-4567', parking: '건물 지하 1~2층, 1시간 무료' };

describe('진료시간 글', () => {
  test('phase-03-task-05 AC1: 월~금은 묶고 토요일·일요일은 따로, 앞 0을 뺀 "토요일 9:30~14:00"으로 쓴다', () => {
    expect(formatHours(clinic.hours)).toBe('월~금 9:30~18:30(점심시간 13:00~14:00), 토요일 9:30~14:00, 일요일 휴진');
    const changed = { ...clinic.hours, wed: { open: '14:00', close: '20:30', lunch: null }, sat: { open: '10:00', close: '13:00', lunch: null } };
    expect(formatHours(changed)).toBe('월~화 9:30~18:30(점심시간 13:00~14:00), 수요일 14:00~20:30, 목~금 9:30~18:30(점심시간 13:00~14:00), 토요일 10:00~13:00, 일요일 휴진');
    // 진료시간을 아직 저장하지 않았으면 병원 정보 화면의 기본값을 쓴다
    expect(formatHours(undefined)).toContain('토요일 9:30~14:00');
  });

  test('phase-03-task-05 AC1: 상황 글을 종류로 나눈다', () => {
    expect(situationKind('진료시간 문의')).toBe('hours');
    expect(situationKind('예약 변경 안내')).toBe('reschedule');
    expect(situationKind('주차 문의')).toBe('parking');
    expect(situationKind('보험 일반 문의')).toBe('insurance');
    expect(situationKind('그 밖의 질문')).toBe('other');
  });
});

describe('템플릿 치환자', () => {
  test('phase-03-task-05 AC4: {진료시간}·{병원이름}·{대표번호}는 병원 정보로 채우고, {날짜}·{시간}은 그대로 둔다', () => {
    const body = '[{병원이름}] {날짜} {시간} 예약 안내. 진료시간 {진료시간}, 문의 {대표번호}';
    expect(fillPlaceholders(body, clinic)).toBe(
      '[하늘숲치과] {날짜} {시간} 예약 안내. 진료시간 월~금 9:30~18:30(점심시간 13:00~14:00), 토요일 9:30~14:00, 일요일 휴진, 문의 02-123-4567',
    );
    // 값이 빈 정보(위치)는 치환자를 그대로 남겨 직원이 알아챌 수 있게 한다
    expect(fillPlaceholders('{위치안내}', clinic)).toBe('{위치안내}');
  });

  test('phase-03-task-05 AC5: 고르기 목록에 환자 이름 치환자가 없고, {이름}·{환자명}은 개인 정보 치환자로 나뉜다', () => {
    const keys = PLACEHOLDERS.map((p) => p.key);
    expect(keys).toContain('진료시간');
    for (const banned of ['이름', '환자명', '환자 이름', '성함', '고객명']) expect(keys).not.toContain(banned);
    expect(keys.some((k) => /이름/.test(k) && k !== '병원이름')).toBe(false);
    expect(scanPlaceholders('{이름}님 {환자명} {진료시간} {쿠폰}')).toEqual({ known: ['진료시간'], personal: ['이름', '환자명'], unknown: ['쿠폰'] });
  });
});

describe('문자 글자 수', () => {
  test('phase-03-task-05 AC4: 한글 2바이트·영문/숫자/공백 1바이트, 90바이트까지 단문이고 넘으면 장문', () => {
    expect(smsBytes('가a 1')).toBe(5);
    expect(smsBytes('줄\r\n바꿈')).toBe(2 + 1 + 4);
    expect(SMS_SHORT_BYTES).toBe(90);
    expect(smsKind(smsBytes('가'.repeat(45)))).toBe('short');
    expect(smsKind(smsBytes(`${'가'.repeat(45)}a`))).toBe('long');
    expect(smsKind(2001)).toBe('over');
  });
});

describe('리뷰 답글 점검', () => {
  test('phase-03-task-05 AC3: 진료 사실을 확인해 주는 표현(치료 받으신·내원·임플란트·진료 기록)을 찾고, 일반 감사 답글은 통과한다', () => {
    const hits = checkReplyFacts('지난주 내원하셔서 임플란트 치료 받으신 부분은 차트를 확인해 보겠습니다.');
    expect(hits.map((h) => h.phrase)).toEqual(['치료 받으', '내원', '임플란트', '차트']);
    expect(hits[0]?.reason).toMatch(/진료를 받았다는 사실/);
    expect(checkReplyFacts('소중한 리뷰 남겨 주셔서 감사합니다. 앞으로도 정성을 다하겠습니다.')).toEqual([]);
  });
});
