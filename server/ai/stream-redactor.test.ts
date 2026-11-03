// 이 파일이 하는 일: 스트림 가리기(StreamRedactor)의 "첫 글자 빨리 보내기"(phase-05-task-03)가 개인정보 가림을 약하게 하지 않는지 증명한다.
// 실제 가림 규칙(server/privacy/filter.ts, 모든 종류 가리기)으로, 여러 문장을 1~7글자 조각으로 잘라 흘려보낸 결과가
// 글 전체를 한 번에 가린 결과와 같고, 가린 결과에 원래 번호가 남지 않는지 본다. 숫자·@가 없는 앞부분이 48글자를 기다리지 않고 나가는지도 본다.
import { describe, expect, test } from 'vitest';
import { PII_TYPES, type PrivacySettings } from '../../shared/privacy-rules.ts';
import { filterText } from '../privacy/filter.ts';
import { StreamRedactor } from './gateway.ts';

const POLICY = Object.fromEntries(PII_TYPES.map((t) => [t, 'redact'])) as PrivacySettings['policy'];
/** 게이트웨이와 같은 방식의 출력 가림(모든 종류를 가린다) */
const redact = (s: string) => filterText(s, { allowlist: [], policy: POLICY }).redactedText;

/** 글을 size 글자씩 잘라 넣고 나온 글(조각 목록)을 돌려준다 */
function run(text: string, size: number): { out: string; pieces: string[]; firstAt: number } {
  const r = new StreamRedactor(redact);
  const pieces: string[] = [];
  let fed = 0;
  let firstAt = -1;
  for (let i = 0; i < text.length; i += size) {
    const part = text.slice(i, i + size);
    fed += part.length;
    const ready = r.push(part);
    if (ready) {
      if (firstAt < 0) firstAt = fed;
      pieces.push(ready);
    }
  }
  const rest = r.flush();
  if (rest) pieces.push(rest);
  return { out: pieces.join(''), pieces, firstAt };
}

// 번호와 그 앞뒤 문맥 단어가 여러 자리에 섞인 글(모두 가상의 값)
const SAMPLES: Array<{ text: string; secrets: string[] }> = [
  { text: '안녕하세요. 오늘 안내드릴 내용은 다음과 같습니다. 담당 번호는 010-1234-5678 입니다. 오전 9시부터 받습니다.', secrets: ['010-1234-5678'] },
  { text: '자료를 정리해서 보내 드립니다. 궁금한 점은 담당자 메일 hong.gildong@example.com 으로 보내 주세요. 감사합니다.', secrets: ['hong.gildong@example.com'] },
  { text: '거래처에 대금을 보낼 때는 아래 내용을 확인해 주세요. 입금 계좌는 국민은행 123456-01-234567 예금주 하늘숲입니다.', secrets: ['123456-01-234567'] },
  { text: '서류에 적힌 내용을 옮겨 적지 마세요. 주민등록번호 9001011234568 같은 값은 가려야 합니다. 꼭 확인해 주세요.', secrets: ['9001011234568'] },
  { text: '출장 준비물 목록입니다. 여권번호 M12345678 은 복사본으로 챙기고, 카드번호 4111 1111 1111 1111 은 적지 마세요.', secrets: ['M12345678', '4111 1111 1111 1111'] },
  { text: '숫자가 전혀 없는 아주 긴 안내 문장입니다. 오늘은 원내 감염관리 교육이 있으니 모두 참석해 주시고, 교육이 끝나면 소감을 짧게 남겨 주세요.', secrets: [] },
  { text: '휴대폰 01012345678 과 전화 02-345-6789, 그리고 메일 a@b.co 도 있습니다.\n줄을 바꾼 뒤에도 010-9876-5432 가 나옵니다.', secrets: ['01012345678', '02-345-6789', '010-9876-5432'] },
];

describe('phase-05-task-03 스트림 첫 글자 빨리 보내기', () => {
  test('phase-05-task-03 AC1 보조: 어떤 크기로 잘라 보내도 결과가 글 전체를 한 번에 가린 것과 같고 번호가 남지 않는다', () => {
    for (const { text, secrets } of SAMPLES) {
      const whole = redact(text);
      for (const s of secrets) expect(whole, `전체 가림에 ${s}가 남음`).not.toContain(s);
      for (const size of [1, 2, 3, 5, 7, 16]) {
        const { out, pieces } = run(text, size);
        expect(out, `${size}글자 조각: ${text.slice(0, 20)}`).toBe(whole);
        for (const s of secrets) for (const p of pieces) expect(p).not.toContain(s.slice(0, 6));
      }
    }
  });

  test('phase-05-task-03 AC1 보조: 숫자·@가 없는 앞부분은 48글자를 기다리지 않고 먼저 나간다', () => {
    const text = '오늘 안내드릴 내용은 다음과 같습니다. 원내 감염관리 교육이 있으니 모두 참석해 주세요. 끝나면 소감을 남겨 주세요.';
    const { firstAt, pieces } = run(text, 3);
    expect(firstAt).toBeGreaterThan(0);
    expect(firstAt).toBeLessThan(StreamRedactor.HOLD);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.join('')).toBe(text);
  });

  test('phase-05-task-03 AC1 보조: 번호 앞 문맥 글자(CONTEXT)는 번호가 올 때까지 남겨 둔다', () => {
    const r = new StreamRedactor(redact);
    // 숫자 앞 문맥("입금 계좌는")이 먼저 나가 버리면 뒤 조각만으로는 계좌번호를 알아볼 수 없다
    let out = r.push('대금 안내입니다. 아래 내용을 확인해 주세요. 입금 계좌는 국민은행 ');
    expect(out).not.toContain('계좌');
    out += r.push('123456-01-234567 입니다. 확인 부탁드립니다.');
    out += r.flush();
    expect(out).not.toContain('123456-01-234567');
    expect(out).toContain('[계좌번호]');
  });
});
