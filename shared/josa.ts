// 이 파일이 하는 일: 낱말 끝 받침에 맞춰 조사(을/를, 이/가, 은/는, 과/와, 으로/로, 이에요/예요)를 골라 붙인다.
// AI 데모 문구처럼 낱말이 바뀌는 문장에서 "직원 응대을(를)", "하늘숲치과이 되도록" 같은 어색한 조사를 막는다.
// 숫자로 끝나면 읽는 소리(0 영, 1 일, 3 삼 …)로 받침을 정하고, 영어·기호처럼 받침을 알 수 없으면 "을(를)"처럼 둘 다 적는다.
// 끝에 붙은 괄호 설명("대표번호(02-555-0100)")은 건너뛰고 괄호 앞 낱말 기준으로 고른다. shared 폴더는 다른 폴더를 import하지 않는다.

/** 고를 수 있는 조사 쌍(받침 있을 때/없을 때) */
export const JOSA_PAIRS = {
  '을/를': ['을', '를'],
  '이/가': ['이', '가'],
  '은/는': ['은', '는'],
  '과/와': ['과', '와'],
  '으로/로': ['으로', '로'],
  '이에요/예요': ['이에요', '예요'],
  '이나/나': ['이나', '나'],
} as const;
export type JosaPair = keyof typeof JOSA_PAIRS;

/** 숫자를 읽을 때 받침: 0 영(ㅇ), 1 일(ㄹ), 2 이(없음), 3 삼(ㅁ), 4 사, 5 오, 6 육(ㄱ), 7 칠(ㄹ), 8 팔(ㄹ), 9 구. 값은 종성 번호(0=없음, 8=ㄹ) */
const DIGIT_JONG: Record<string, number> = { '0': 21, '1': 8, '2': 0, '3': 16, '4': 0, '5': 0, '6': 1, '7': 8, '8': 8, '9': 0 };

/** 끝의 괄호 설명과 따옴표·공백을 떼고 받침을 볼 글자를 찾는다 */
function lastSoundChar(word: string): string {
  let w = word.trimEnd();
  // "대표번호(02-555-0100)" → "대표번호"
  while (/\)$/.test(w)) {
    const open = w.lastIndexOf('(');
    if (open <= 0) break;
    w = w.slice(0, open).trimEnd();
  }
  w = w.replace(/["'”’」』\]]+$/u, '');
  return w.slice(-1);
}

/**
 * 낱말 끝 받침(종성 번호). 받침이 없으면 0, ㄹ이면 8, 알 수 없으면 null.
 * 한글 음절은 (글자 - 0xAC00) % 28로 종성을 구한다.
 */
export function finalConsonant(word: string): number | null {
  const ch = lastSoundChar(word);
  if (!ch) return null;
  if (ch in DIGIT_JONG) return DIGIT_JONG[ch] ?? null;
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  return code % 28;
}

/** 조사만 고른다. 예: josa('직원 응대', '을/를') → '를' */
export function josa(word: string, pair: JosaPair): string {
  const [withFinal, withoutFinal] = JOSA_PAIRS[pair];
  const jong = finalConsonant(word);
  if (jong === null) return pair === '으로/로' ? '(으)로' : `${withFinal}(${withoutFinal})`;
  if (pair === '으로/로') return jong === 0 || jong === 8 ? withoutFinal : withFinal; // ㄹ 받침은 '로'
  return jong === 0 ? withoutFinal : withFinal;
}

/** 낱말 + 알맞은 조사. 예: withJosa('하늘숲치과', '이/가') → '하늘숲치과가' */
export function withJosa(word: string, pair: JosaPair): string {
  return `${word}${josa(word, pair)}`;
}
