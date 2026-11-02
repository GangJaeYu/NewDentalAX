// 이 파일이 하는 일: 개인정보 필터(server/privacy/filter.ts + shared/privacy-rules.ts)를 확인한다.
// 종류별 감지 예시와 오탐 대조 세트(날짜·금액·발주번호·로트·사업자번호 등), 가리기·차단 정책, 허용 목록,
// 설정 읽기, 여러 글·객체 검사, 안내 문구, 긴 글 처리 시간을 본다(phase-02-task-01, FR-032 AC6, TD-010).
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_PRIVACY_POLICY,
  detectPii,
  filterDeep,
  filterText,
  filterTexts,
  findingsSummary,
  mergeFindings,
  parsePrivacySettings,
  privacyNotice,
  privacySettingsSchema,
  type PiiType,
} from './filter.ts';
import { isValidRrnDate, luhnValid, normalizeAllowEntry, normalizeForScan } from '../../shared/privacy-rules.ts';

/** 글에서 찾은 종류 목록(위치 순서) */
function typesOf(text: string, allowlist?: string[]): PiiType[] {
  return detectPii(text, { allowlist }).map((m) => m.type);
}

// ───────── 감지 예시: [설명, 글, 종류, 감지돼야 할 원문 조각] ─────────
const DETECT: [string, string, PiiType, string][] = [
  // 주민·외국인등록번호
  ['주민번호(줄표)', '주민번호 900101-1234567 입니다', 'rrn', '900101-1234567'],
  ['주민번호(줄표 앞뒤 공백)', '번호는 900101 - 2345678 확인', 'rrn', '900101 - 2345678'],
  ['주민번호(2000년대생 3)', '아이 010203-3456789', 'rrn', '010203-3456789'],
  ['주민번호(2000년대생 4, 윤년 2월 29일)', '000229-4123456', 'rrn', '000229-4123456'],
  ['주민번호(공백 구분)', '900101 1234567', 'rrn', '900101 1234567'],
  ['주민번호(붙여 씀 + 문맥)', '주민등록번호 9001011234567', 'rrn', '9001011234567'],
  ['주민번호(뒷자리 가림 형식)', '생년 900101-1****** 직원', 'rrn', '900101-1******'],
  ['주민번호(전각 숫자·줄표)', '９００１０１－１２３４５６７', 'rrn', '９００１０１－１２３４５６７'],
  ['외국인등록번호(5)', '외국인등록번호 850315-5123456', 'rrn', '850315-5123456'],
  ['외국인등록번호(8, 2000년대)', '051231-8123456 등록', 'rrn', '051231-8123456'],
  // 휴대전화
  ['휴대전화(줄표)', '010-1234-5678', 'phone', '010-1234-5678'],
  ['휴대전화(붙여 씀)', '전화 01012345678 주세요', 'phone', '01012345678'],
  ['휴대전화(점)', '010.1234.5678', 'phone', '010.1234.5678'],
  ['휴대전화(공백)', '010 1234 5678', 'phone', '010 1234 5678'],
  ['휴대전화(옛 번호 011, 3자리 가운데)', '011-123-4567', 'phone', '011-123-4567'],
  ['휴대전화(+82 공백)', '+82 10-1234-5678', 'phone', '+82 10-1234-5678'],
  ['휴대전화(+82 줄표)', '+82-10-9876-5432', 'phone', '+82-10-9876-5432'],
  ['휴대전화(한글에 붙음)', '연락처:010-9876-5432입니다', 'phone', '010-9876-5432'],
  ['휴대전화(긴 줄표 문자)', '010–2222–3333', 'phone', '010–2222–3333'],
  // 일반 전화
  ['서울(02, 3자리)', '02-123-4567', 'phone', '02-123-4567'],
  ['서울(02, 4자리)', '02-1234-5678', 'phone', '02-1234-5678'],
  ['경기(031)', '031-123-4567', 'phone', '031-123-4567'],
  ['제주(064)', '064-712-3456', 'phone', '064-712-3456'],
  ['괄호 지역번호', '(02) 123-4567', 'phone', '(02) 123-4567'],
  ['괄호 닫기만', '051)234-5678', 'phone', '051)234-5678'],
  ['인터넷전화(070)', '070-1234-5678', 'phone', '070-1234-5678'],
  ['안심번호(0505)', '0505-123-4567', 'phone', '0505-123-4567'],
  // 이메일
  ['이메일(기본)', '메일 hong.gildong@gmail.com 로', 'email', 'hong.gildong@gmail.com'],
  ['이메일(+태그, co.kr)', 'user+tag@naver.co.kr', 'email', 'user+tag@naver.co.kr'],
  ['이메일(대문자·밑줄)', 'MAIL: A_B-1@Daum.Net', 'email', 'A_B-1@Daum.Net'],
  ['이메일(문장 끝 마침표 제외)', '주소는 kim@clinic.kr.', 'email', 'kim@clinic.kr'],
  // 카드번호(Luhn)
  ['카드(4-4-4-4 줄표)', '4111-1111-1111-1111', 'card', '4111-1111-1111-1111'],
  ['카드(4-4-4-4 공백)', '5500 0000 0000 0004', 'card', '5500 0000 0000 0004'],
  ['카드(16자리 붙여 씀)', '4111111111111111', 'card', '4111111111111111'],
  ['카드(아멕스 4-6-5)', '3782-822463-10005', 'card', '3782-822463-10005'],
  ['카드(국내 전용 9로 시작)', '9410-1234-5678-9010', 'card', '9410-1234-5678-9010'],
  ['카드(13자리 + 카드 문맥)', '카드 4222222222222', 'card', '4222222222222'],
  ['카드(18자리 4-4-4-4-2)', '6212-3456-7890-1234-57', 'card', '6212-3456-7890-1234-57'],
  // 계좌번호(줄표 형식 + 문맥)
  ['계좌(3-3-6)', '계좌 110-123-456789', 'account', '110-123-456789'],
  ['계좌(6-2-6, 은행명)', '국민은행 123456-01-123456', 'account', '123456-01-123456'],
  ['계좌(4-3-6, 입금)', '입금 계좌: 1002-123-456789', 'account', '1002-123-456789'],
  ['계좌(3-4-4-2)', '농협 352-1234-5678-93', 'account', '352-1234-5678-93'],
  ['계좌(문맥이 뒤에)', '352-1234-5678-93 (농협 예금주 김)', 'account', '352-1234-5678-93'],
  ['계좌(붙여 씀 + "계좌")', '계좌번호 110123456789', 'account', '110123456789'],
  // 여권번호
  ['여권(구형 + 문맥)', '여권번호 M12345678', 'passport', 'M12345678'],
  ['여권(신형 M123A4567)', '번호 M123A4567 확인', 'passport', 'M123A4567'],
  ['여권(소문자 + 문맥)', '여권 m12345678', 'passport', 'm12345678'],
  ['여권(영문 문맥)', 'passport no. S98765432', 'passport', 'S98765432'],
  ['여권(문맥이 뒤에, 코드 문맥 무시)', '코드 아님 M12345678 여권', 'passport', 'M12345678'],
  ['계좌(4-2-7, 카카오)', '계좌번호는 3333-01-1234567(카카오)', 'account', '3333-01-1234567'],
  ['전화(줄표 앞뒤 공백)', '연락 010 - 1234 - 5678', 'phone', '010 - 1234 - 5678'],
];

// ───────── 미감지(오탐 대조) 세트: [설명, 글] ─────────
const NOT_DETECT: [string, string][] = [
  // 날짜
  ['날짜(줄표)', '2026-11-02'],
  ['날짜(점)', '2026.11.02'],
  ['날짜(빗금)', '2026/11/02'],
  ['날짜(두 자리 연도)', '26.11.02'],
  ['날짜(붙여 씀)', '20261102'],
  ['날짜(한글)', '2026년 11월 2일'],
  ['날짜와 시간 범위', '2026-11-02 09:00~18:00'],
  ['유통기한 문장', '유효기간 2027-03-31까지, 2026-11-02 입고'],
  // 금액
  ['금액(쉼표·원)', '1,234,000원'],
  ['금액(원화 기호)', '₩12,345,678'],
  ['금액(붙여 씀)', '12345678원'],
  ['큰 금액', '총 1,234,567,890원 결제'],
  // 발주·주문 번호
  ['발주번호', 'PO-2611-003'],
  ['발주번호 문장', '발주번호 PO-2611-003 입고 완료'],
  ['주문번호 12자리', '주문번호 202611020001'],
  ['주문번호(Luhn 맞는 13자리)', '주문 2026110200030'],
  // 로트·제조번호·품목 코드
  ['로트(영문 섞임)', 'LOT 2611A-0045'],
  ['로트번호', '로트번호 B261015'],
  ['로트(M + 8자리)', 'LOT M20261015'],
  ['로트(S + 8자리, 콜론)', 'Lot: S12345678'],
  ['제조번호', '제조번호 20261015-02'],
  ['모델명(M + 8자리)', '모델 M12345678'],
  ['장비 일련번호(SN)', '멸균기 SN: M12345678'],
  ['시리얼(신형 여권 모양)', '시리얼 S1234A5678'],
  ['인터넷 매장 주문 REF', 'REF 1234-5678-9012'],
  ['영문 코드 + 숫자 묶음', 'KD-2611-0045-12'],
  ['수신자부담(080)·대표번호', '1588-2222 / 080-123-4567'],
  ['진료 시간', '진료시간 09:30-18:30'],
  ['품목코드', '품목코드 GC-FUJI-IX'],
  ['바코드(EAN-13, Luhn 맞음)', '바코드 8801234567892'],
  ['바코드(EAN-13)', '8801234567890'],
  // 사업자등록번호(개인정보 아님, TD-010)
  ['사업자번호(문맥)', '사업자등록번호 123-45-67890'],
  ['사업자번호(형식만)', '123-45-67890'],
  ['사업자번호(붙여 씀)', '사업자번호 1234567890'],
  ['사업자번호와 계좌 문맥이 함께', '사업자 123-45-67890 거래 은행 확인'],
  // 주민번호처럼 보이지만 날짜가 틀림
  ['없는 달(13월)', '991332-1234567'],
  ['평년 2월 29일', '910229-1234567'],
  ['7번째 자리 9', '900101-9234567'],
  ['13자리 붙여 씀(문맥 없음)', '9001011234567'],
  // 카드처럼 보이지만 Luhn 실패
  ['Luhn 실패 4-4-4-4', '1234-5678-9012-3456'],
  ['Luhn 실패 16자리', '1234567890123456'],
  // 계좌처럼 보이지만 문맥 없음
  ['계좌 형식(문맥 없음)', '110-123-456789'],
  // 전화처럼 보이지만 아님
  ['대표번호(15xx, 사업자 전용)', '예약 1588-1234'],
  ['지역번호 없는 8자리', '1234-5678'],
  ['긴 코드 안의 번호', 'SN-010-1234-5678-X'],
  ['IP 주소', '192.168.0.10'],
  ['버전 번호', '버전 1.2.3'],
  ['온도·시간', '121°C 20분, 134°C 4분'],
  ['수량과 단위', '3박스 1,000개 50ml'],
  // 이메일처럼 보이지만 아님
  ['최상위 도메인 없음', 'admin@localhost'],
  ['멘션', '@김실장 확인 부탁'],
];

describe('phase-02-task-01 AC1: 감지 예시', () => {
  test.each(DETECT)('phase-02-task-01 AC1 감지: %s', (_name, text, type, expected) => {
    const found = detectPii(text);
    expect(found.map((m) => m.type)).toEqual([type]);
    expect(found[0]?.text).toBe(expected);
  });
});

describe('phase-02-task-01 AC1: 미감지(오탐 대조 세트)', () => {
  test.each(NOT_DETECT)('phase-02-task-01 AC1 미감지: %s', (_name, text) => {
    expect(detectPii(text)).toEqual([]);
    const r = filterText(text);
    expect(r.redactedText).toBe(text);
    expect(r.findings).toEqual([]);
    expect(r.blocked).toBe(false);
  });

  test('phase-02-task-01 AC1: 감지·미감지 예시가 합쳐 50개 이상이다', () => {
    expect(DETECT.length + NOT_DETECT.length).toBeGreaterThanOrEqual(50);
    const kinds = new Set(DETECT.map((d) => d[2]));
    expect([...kinds].sort()).toEqual(['account', 'card', 'email', 'passport', 'phone', 'rrn']);
  });

  test('phase-02-task-01 AC1: 오탐 대조 문장 하나에 날짜·금액·발주번호·로트·사업자번호가 섞여도 감지 0건', () => {
    const text =
      '2026-11-02 하늘치재료(사업자등록번호 123-45-67890)에 발주번호 PO-2611-003으로 ' +
      '레진 3박스(LOT 2611A-0045, 유효기간 2027-03-31) 1,234,000원 주문. 대표 1588-1234.';
    expect(detectPii(text)).toEqual([]);
  });
});

describe('phase-02-task-01 AC2: 가리기', () => {
  test('phase-02-task-01 AC2: "홍길동 010-1234-5678 연락" → [전화번호], findings phone 1건', () => {
    const r = filterText('홍길동 010-1234-5678 연락');
    expect(r.redactedText).toBe('홍길동 [전화번호] 연락');
    expect(r.findings).toEqual([{ type: 'phone', count: 1 }]);
    expect(r.blocked).toBe(false);
    expect(r.redacted).toBe(true);
    expect(privacyNotice(r)).toBe('전화번호 1건을 가리고 보냈습니다');
  });

  test('phase-02-task-01 AC2: 여러 종류를 각각의 표시로 가리고 종류별로 센다', () => {
    const r = filterText('김 010-1111-2222, 이 010-3333-4444, 메일 a@b.com, 계좌 110-123-456789, 여권번호 M12345678');
    expect(r.redactedText).toBe('김 [전화번호], 이 [전화번호], 메일 [이메일], 계좌 [계좌번호], 여권번호 [여권번호]');
    expect(r.findings).toEqual([
      { type: 'phone', count: 2 },
      { type: 'email', count: 1 },
      { type: 'account', count: 1 },
      { type: 'passport', count: 1 },
    ]);
    expect(r.blocked).toBe(false);
    expect(privacyNotice(r)).toBe('전화번호 2건, 이메일 1건, 계좌번호 1건, 여권번호 1건을 가리고 보냈습니다');
  });

  test('phase-02-task-01 AC2: 감지가 없으면 글이 그대로이고 안내가 없다', () => {
    const r = filterText('오늘 멸균기 점검 일정 알려줘');
    expect(r).toEqual({ redactedText: '오늘 멸균기 점검 일정 알려줘', findings: [], blocked: false, blockedTypes: [], redacted: false });
    expect(privacyNotice(r)).toBeNull();
  });

  test('phase-02-task-01 AC2: 빈 글도 오류 없이 처리한다', () => {
    expect(filterText('').redactedText).toBe('');
    expect(detectPii('')).toEqual([]);
  });

  test('phase-02-task-01 AC2: 정책을 block으로 바꾸면 전화번호도 차단된다', () => {
    const r = filterText('010-1234-5678', { policy: { ...DEFAULT_PRIVACY_POLICY, phone: 'block' } });
    expect(r.blocked).toBe(true);
    expect(r.blockedTypes).toEqual(['phone']);
  });
});

describe('phase-02-task-01 AC3: 주민등록번호·카드번호 차단', () => {
  test('phase-02-task-01 AC3: 주민번호가 포함되면 blocked=true', () => {
    const r = filterText('직원 김하늘 900101-1234567 서류 정리해줘');
    expect(r.blocked).toBe(true);
    expect(r.blockedTypes).toEqual(['rrn']);
    expect(r.findings).toEqual([{ type: 'rrn', count: 1 }]);
    expect(r.redactedText).toBe('직원 김하늘 [주민등록번호] 서류 정리해줘');
    expect(privacyNotice(r)).toBe('주민등록번호로 보이는 내용이 있어 AI로 보내지 않았습니다. 해당 부분을 지우고 다시 시도해 주세요.');
  });

  test('phase-02-task-01 AC3: 외국인등록번호도 주민번호와 같이 차단된다', () => {
    const r = filterText('850315-5123456');
    expect(r.blocked).toBe(true);
    expect(r.blockedTypes).toEqual(['rrn']);
  });

  test('phase-02-task-01 AC3: 카드번호도 기본 차단, 전화번호와 함께면 차단 종류만 안내한다', () => {
    const r = filterText('카드 4111-1111-1111-1111, 연락 010-1234-5678, 주민 900101-1234567');
    expect(r.blocked).toBe(true);
    expect(r.blockedTypes).toEqual(['rrn', 'card']);
    expect(r.findings).toEqual([
      { type: 'rrn', count: 1 },
      { type: 'phone', count: 1 },
      { type: 'card', count: 1 },
    ]);
    expect(privacyNotice(r)).toBe('주민등록번호, 카드번호로 보이는 내용이 있어 AI로 보내지 않았습니다. 해당 부분을 지우고 다시 시도해 주세요.');
  });

  test('phase-02-task-01 AC3: 관리자가 주민번호 정책을 redact로 바꾸면 차단 대신 가린다', () => {
    const r = filterText('900101-1234567', { policy: { ...DEFAULT_PRIVACY_POLICY, rrn: 'redact' } });
    expect(r.blocked).toBe(false);
    expect(r.redactedText).toBe('[주민등록번호]');
  });
});

describe('phase-02-task-01 AC4: 허용 목록', () => {
  const allowlist = ['02-123-4567'];

  test('phase-02-task-01 AC4: 허용 목록의 대표번호는 가려지지 않는다', () => {
    const r = filterText('대표번호 02-123-4567로 전화 주세요. 담당 010-1111-2222', { allowlist });
    expect(r.redactedText).toBe('대표번호 02-123-4567로 전화 주세요. 담당 [전화번호]');
    expect(r.findings).toEqual([{ type: 'phone', count: 1 }]);
  });

  test('phase-02-task-01 AC4: 쓰는 모양이 달라도(괄호·공백·+82) 같은 번호면 허용한다', () => {
    for (const text of ['(02) 123-4567', '02 123 4567', '02.123.4567', '+82 2-123-4567', '+82-02-123-4567']) {
      expect(typesOf(text, allowlist), text).toEqual([]);
      expect(typesOf(text), text).toEqual(['phone']);
    }
  });

  test('phase-02-task-01 AC4: 허용 목록의 병원 이메일은 대소문자가 달라도 가리지 않는다', () => {
    const r = filterText('문의 Info@HaneulSoop.kr / 개인 kim@gmail.com', { allowlist: ['info@haneulsoop.kr'] });
    expect(r.redactedText).toBe('문의 Info@HaneulSoop.kr / 개인 [이메일]');
  });

  test('phase-02-task-01 AC4: 허용 목록 값 정리(번호는 숫자만, +82는 0, 너무 짧거나 빈 값은 무시)', () => {
    expect(normalizeAllowEntry('02-123-4567')).toBe('021234567');
    expect(normalizeAllowEntry('+82 10-1234-5678')).toBe('01012345678');
    expect(normalizeAllowEntry(' A@B.COM ')).toBe('a@b.com');
    expect(normalizeAllowEntry('12')).toBe('');
    expect(normalizeAllowEntry('   ')).toBe('');
    expect(typesOf('010-1234-5678', ['', '12', '대표'])).toEqual(['phone']);
  });
});

describe('phase-02-task-01 검사 도우미', () => {
  test('phase-02-task-01 AC1: Luhn 검사', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('378282246310005')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(luhnValid('12a4')).toBe(false);
  });

  test('phase-02-task-01 AC1: 주민번호 앞자리 날짜 유효성(윤년·말일·세기)', () => {
    expect(isValidRrnDate('000229', '3')).toBe(true); // 2000년은 윤년
    expect(isValidRrnDate('000229', '1')).toBe(false); // 1900년은 평년
    expect(isValidRrnDate('960229', '1')).toBe(true);
    expect(isValidRrnDate('900431', '1')).toBe(false);
    expect(isValidRrnDate('900100', '2')).toBe(false);
    expect(isValidRrnDate('901231', '9')).toBe(false);
  });

  test('phase-02-task-01 AC1: 전각 정리는 글자 수를 바꾸지 않는다', () => {
    const s = '０１０－１２３４－５６７８　ＡＢ（주）';
    const n = normalizeForScan(s);
    expect(n).toBe('010-1234-5678 AB(주)');
    expect(n.length).toBe(s.length);
  });

  test('phase-02-task-01 AC1: 겹치는 후보는 하나만 고르고, 위치 순서로 돌려준다', () => {
    const found = detectPii('01012345678@kakao.com 그리고 010-2222-3333');
    expect(found.map((m) => [m.type, m.text])).toEqual([
      ['email', '01012345678@kakao.com'],
      ['phone', '010-2222-3333'],
    ]);
  });
});

describe('phase-02-task-01 서버 설정·여러 글·객체', () => {
  test('phase-02-task-01 AC4: settings.privacy JSON을 읽고 빠진 정책은 기본값으로 채운다', () => {
    const s = parsePrivacySettings('{"allowlist":["02-123-4567","02-123-4567"],"policy":{"phone":"block"}}');
    expect(s.allowlist).toEqual(['02-123-4567']);
    expect(s.policy).toEqual({ ...DEFAULT_PRIVACY_POLICY, phone: 'block' });
    expect(filterText('02-123-4567', s).findings).toEqual([]);
  });

  test('phase-02-task-01 AC3: 설정이 없거나 깨졌으면 기본 정책(주민·카드 차단)을 쓴다', () => {
    for (const raw of [undefined, null, '', '{깨짐', { policy: { rrn: 'allow' } }, 42]) {
      const s = parsePrivacySettings(raw);
      expect(s.policy).toEqual(DEFAULT_PRIVACY_POLICY);
      expect(s.allowlist).toEqual([]);
    }
  });

  test('phase-02-task-01 AC4: 허용 목록은 50개·100자까지만 받는다', () => {
    expect(privacySettingsSchema.safeParse({ allowlist: Array.from({ length: 51 }, (_, i) => `02-100-${1000 + i}`) }).success).toBe(false);
    expect(privacySettingsSchema.safeParse({ allowlist: ['x'.repeat(101)] }).success).toBe(false);
    expect(privacySettingsSchema.safeParse({ allowlist: ['02-123-4567'], policy: { card: 'redact' } }).success).toBe(true);
  });

  test('phase-02-task-01 AC2: 여러 글을 한꺼번에 검사하면 건수를 합치고 하나라도 차단이면 차단', () => {
    const r = filterTexts(['병원 안내문 작성', '담당 010-1111-2222', '메일 a@b.com, 010-3333-4444']);
    expect(r.redactedTexts).toEqual(['병원 안내문 작성', '담당 [전화번호]', '메일 [이메일], [전화번호]']);
    expect(r.findings).toEqual([
      { type: 'phone', count: 2 },
      { type: 'email', count: 1 },
    ]);
    expect(r.blocked).toBe(false);
    expect(filterTexts(['괜찮음', '4111 1111 1111 1111']).blockedTypes).toEqual(['card']);
  });

  test('phase-02-task-01 AC2: 객체 안의 글자 값(사진 인식 결과)을 가린 복사본을 만든다', () => {
    const input = {
      vendorName: '하늘치재료',
      date: '2026-11-02',
      memo: '담당 010-1234-5678',
      lines: [{ name: '레진', qty: 3, unitPrice: 12000, note: 'kim@vendor.co.kr' }],
      total: 36000,
      ok: true,
      none: null,
    };
    const r = filterDeep(input);
    expect(r.value).toEqual({ ...input, memo: '담당 [전화번호]', lines: [{ name: '레진', qty: 3, unitPrice: 12000, note: '[이메일]' }] });
    expect(input.memo).toBe('담당 010-1234-5678');
    expect(r.findings).toEqual([
      { type: 'phone', count: 1 },
      { type: 'email', count: 1 },
    ]);
    expect(r.blocked).toBe(false);
    expect(filterDeep(['900101-1234567']).blocked).toBe(true);
  });

  test('phase-02-task-01 AC2: 사용 기록용 요약은 종류별 건수만 담는다(원문 없음)', () => {
    const r = filterText('010-1234-5678 010-2222-3333 a@b.com');
    expect(findingsSummary(r.findings)).toEqual({ phone: 2, email: 1 });
    expect(JSON.stringify(findingsSummary(r.findings))).not.toContain('010');
    expect(mergeFindings([[{ type: 'email', count: 1 }], [{ type: 'rrn', count: 2 }, { type: 'email', count: 2 }]])).toEqual([
      { type: 'rrn', count: 2 },
      { type: 'email', count: 3 },
    ]);
  });

  test('phase-02-task-01 AC1: 긴 글(약 30만 자)도 1초 안에 검사한다', () => {
    const block = '2026-11-02 레진 3박스 1,234,000원 PO-2611-003 LOT 2611A-0045 aaaa.bbbb.cccc ';
    const text = block.repeat(4000) + ' 끝 010-1234-5678 ' + 'x'.repeat(5000) + '@'.repeat(1000);
    const t0 = performance.now();
    const r = filterText(text);
    const ms = performance.now() - t0;
    expect(r.findings).toEqual([{ type: 'phone', count: 1 }]);
    expect(ms).toBeLessThan(1000);
  });
});
