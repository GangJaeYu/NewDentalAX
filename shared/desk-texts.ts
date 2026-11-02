// 이 파일이 하는 일: 데스크 AI 화면(전화 응대 스크립트·리뷰 답글·문자/안내문 템플릿, FR-042~044)과 보관함(saved-texts)이 서버·화면에서 함께 쓰는 규칙을 둔다.
// - 보관 문구 종류·분류 추천값, 스크립트 상황·말투, 리뷰 답글 말투
// - 병원 정보 → 읽기 쉬운 글(진료시간 "월~금 9:30~18:30", "토요일 9:30~14:00" 등)과 템플릿 치환자({진료시간} 등). 환자 이름 치환자는 두지 않는다(FR-044 AC1)
// - 문자 글자 수(바이트, 한글 2·영문 1)와 단문 90바이트 기준(FR-044 AC2), 리뷰 답글의 "진료 사실 확인" 표현 규칙(FR-043 AC2)
// shared 폴더는 다른 폴더를 import하지 않는다(같은 폴더의 schemas만 씀).
import { defaultClinic, WEEKDAYS, type Weekday } from './schemas/admin.ts';

// ── 보관 문구(saved_texts) ─────────────────────────────────────────────────────

/** 보관 문구 종류(database.md §2 saved_texts.kind) */
export const SAVED_TEXT_KINDS = ['script', 'template', 'review_reply', 'promo', 'hiring', 'onboarding'] as const;
export type SavedTextKind = (typeof SAVED_TEXT_KINDS)[number];
export const SAVED_TEXT_KIND_LABELS: Record<SavedTextKind, string> = {
  script: '응대 스크립트',
  template: '문자·안내문 템플릿',
  review_reply: '리뷰 답글',
  promo: '홍보 글',
  hiring: '채용 공고',
  onboarding: '온보딩',
};

/** 보관 문구 한 건(GET /api/saved-texts) */
export interface SavedText {
  id: number;
  kind: SavedTextKind;
  category: string;
  title: string;
  body: string;
  /** 화면별 추가 정보(말투·상황 등) */
  meta: Record<string, unknown> | null;
  /** 모든 직원이 함께 보는 공용 문구인지 */
  shared: boolean;
  createdBy: { id: number; name: string };
  createdAt: string;
  updatedAt: string;
  /** 내가 고치거나 지울 수 있는지(내 문구, 또는 공용 문구를 실장 이상이) */
  canEdit: boolean;
}

/** 전화 응대 상황(FR-042 AC2). 분류로도 쓴다 */
export const SCRIPT_SITUATIONS = ['진료시간 문의', '예약 변경 안내', '주차 문의', '위치·교통 문의', '보험 일반 문의', '휴진 안내'] as const;
/** 직접 적는 상황(분류 "기타") */
export const SCRIPT_CUSTOM = '직접 적기';
/** 스크립트 말투 */
export const SCRIPT_TONES = ['친절하고 차분하게', '밝고 상냥하게', '간결하고 정중하게'] as const;
/** 리뷰 답글 말투(2~3개 고름, FR-043 AC1) */
export const REVIEW_TONES = ['정중하게', '따뜻하게', '간결하게'] as const;
/** 템플릿 분류 추천값 */
export const TEMPLATE_CATEGORIES = ['예약 안내', '휴진 안내', '진료 후 안내', '이벤트·기타'] as const;

// ── 병원 정보 → 글 ────────────────────────────────────────────────────────────

/** 병원 정보 중 글로 쓰는 부분(서버 PromptContext.clinic과 GET /api/settings/clinic 모두 받음) */
export interface ClinicLike {
  name?: string;
  phone?: string;
  hours?: unknown;
  holidayNote?: string;
  parking?: string;
  location?: string;
  insuranceNote?: string;
}

interface DayLike {
  open: string;
  close: string;
  lunch?: { start: string; end: string } | null;
}

const DAY_NAMES: Record<Weekday, string> = { mon: '월요일', tue: '화요일', wed: '수요일', thu: '목요일', fri: '금요일', sat: '토요일', sun: '일요일' };
const DAY_SHORT: Record<Weekday, string> = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
const HHMM = /^\d{2}:\d{2}$/;

/** "09:30" → "9:30"(전화로 읽기 쉽게 앞 0을 뺀다) */
export function speakTime(t: string): string {
  return t.replace(/^0(\d)/, '$1');
}

/** 저장값에서 하루 진료시간을 꺼낸다(모양이 틀리면 undefined, 휴진이면 null) */
function dayOf(hours: unknown, d: Weekday): DayLike | null | undefined {
  if (!hours || typeof hours !== 'object') return undefined;
  const v = (hours as Record<string, unknown>)[d];
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.open !== 'string' || typeof o.close !== 'string' || !HHMM.test(o.open) || !HHMM.test(o.close)) return undefined;
  const l = o.lunch as Record<string, unknown> | null | undefined;
  const lunch = l && typeof l.start === 'string' && typeof l.end === 'string' && HHMM.test(l.start) && HHMM.test(l.end) ? { start: l.start, end: l.end } : null;
  return { open: o.open, close: o.close, lunch };
}

/** 저장된 진료시간이 쓸 만한지(요일 하나라도 읽히면 true). 없으면 기본값(평일 9:30~18:30, 토 9:30~14:00)을 쓴다 */
function hoursOrDefault(hours: unknown): unknown {
  return WEEKDAYS.some((d) => dayOf(hours, d) !== undefined) ? hours : defaultClinic().hours;
}

function dayText(d: DayLike | null | undefined, withLunch: boolean): string {
  if (!d) return '휴진';
  const base = `${speakTime(d.open)}~${speakTime(d.close)}`;
  return withLunch && d.lunch ? `${base}(점심시간 ${speakTime(d.lunch.start)}~${speakTime(d.lunch.end)})` : base;
}

/**
 * 진료시간을 한 줄 글로 바꾼다. 월~금은 같은 시간끼리 묶고, 토요일·일요일은 따로 적는다.
 * 예: "월~금 9:30~18:30(점심시간 13:00~14:00), 토요일 9:30~14:00, 일요일 휴진"
 */
export function formatHours(hours: unknown): string {
  const h = hoursOrDefault(hours);
  const parts: string[] = [];
  const weekdays: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
  let i = 0;
  while (i < weekdays.length) {
    const start = weekdays[i] as Weekday;
    const text = dayText(dayOf(h, start), true);
    let j = i;
    while (j + 1 < weekdays.length && dayText(dayOf(h, weekdays[j + 1] as Weekday), true) === text) j += 1;
    const end = weekdays[j] as Weekday;
    const label = i === j ? DAY_NAMES[start] : `${DAY_SHORT[start]}~${DAY_SHORT[end]}`;
    parts.push(`${label} ${text}`);
    i = j + 1;
  }
  for (const d of ['sat', 'sun'] as const) parts.push(`${DAY_NAMES[d]} ${dayText(dayOf(h, d), true)}`);
  return parts.join(', ');
}

/** 점심시간 글(요일마다 다르면 첫 요일 기준, 없으면 "점심시간 없음") */
export function formatLunch(hours: unknown): string {
  const h = hoursOrDefault(hours);
  for (const d of WEEKDAYS) {
    const day = dayOf(h, d);
    if (day?.lunch) return `${speakTime(day.lunch.start)}~${speakTime(day.lunch.end)}`;
  }
  return '점심시간 없음';
}

/** 휴진 요일 글(예: "일요일") */
function closedDays(hours: unknown): string {
  const h = hoursOrDefault(hours);
  const names = WEEKDAYS.filter((d) => dayOf(h, d) === null).map((d) => DAY_NAMES[d]);
  return names.length ? names.join('·') : '';
}

/** 휴진 안내 글(휴진 요일 + 저장한 휴진 안내) */
export function formatHoliday(c: ClinicLike | null | undefined): string {
  const days = closedDays(c?.hours);
  const note = c?.holidayNote?.trim() ?? '';
  if (days && note) return `${days} 휴진, ${note}`;
  if (days) return `${days} 휴진`;
  return note;
}

/** 스크립트·템플릿에 넣는 병원 정보(모두 글. 비어 있으면 '') */
export interface ClinicFacts {
  name: string;
  phone: string;
  hours: string;
  lunch: string;
  holiday: string;
  parking: string;
  location: string;
  insurance: string;
}

/** 병원 정보를 글 묶음으로 바꾼다(병원 이름이 없으면 "저희 치과") */
export function clinicFacts(c: ClinicLike | null | undefined): ClinicFacts {
  return {
    name: c?.name?.trim() || '저희 치과',
    phone: c?.phone?.trim() ?? '',
    hours: formatHours(c?.hours),
    lunch: formatLunch(c?.hours),
    holiday: formatHoliday(c),
    parking: c?.parking?.trim() ?? '',
    location: c?.location?.trim() ?? '',
    insurance: c?.insuranceNote?.trim() ?? '',
  };
}

/** 상황 글 → 스크립트 종류(데모 응답이 어떤 병원 정보를 앞에 둘지 고를 때 씀) */
export function situationKind(situation: string): 'hours' | 'reschedule' | 'parking' | 'location' | 'insurance' | 'holiday' | 'other' {
  if (/예약/.test(situation)) return 'reschedule';
  if (/휴진|쉬는\s*날|공휴일|명절/.test(situation)) return 'holiday';
  if (/주차/.test(situation)) return 'parking';
  if (/위치|교통|오시는|찾아|길/.test(situation)) return 'location';
  if (/보험|실비|비용|수가/.test(situation)) return 'insurance';
  if (/진료\s*시간|몇\s*시|영업|점심|시간/.test(situation)) return 'hours';
  return 'other';
}

// ── 템플릿 치환자 ─────────────────────────────────────────────────────────────

/** 템플릿 치환자 하나 */
export interface Placeholder {
  /** 중괄호 안 글자(예: 진료시간) */
  key: string;
  label: string;
  /** 병원 정보에서 채우는지(false면 보낼 때 직접 고치는 자리) */
  fromClinic: boolean;
}

/**
 * 고르기 목록에 보이는 치환자(FR-044 AC1). 병원 정보에서 채우는 것과 날짜·시간 자리만 있다.
 * 환자 이름 같은 개인 정보 치환자는 일부러 넣지 않는다.
 */
export const PLACEHOLDERS: readonly Placeholder[] = [
  { key: '병원이름', label: '병원 이름', fromClinic: true },
  { key: '대표번호', label: '대표번호', fromClinic: true },
  { key: '진료시간', label: '진료시간', fromClinic: true },
  { key: '점심시간', label: '점심시간', fromClinic: true },
  { key: '휴진안내', label: '휴진 안내', fromClinic: true },
  { key: '주차안내', label: '주차 안내', fromClinic: true },
  { key: '위치안내', label: '위치·교통 안내', fromClinic: true },
  { key: '보험안내', label: '보험 일반 안내', fromClinic: true },
  { key: '날짜', label: '날짜(직접 고침)', fromClinic: false },
  { key: '시간', label: '시간(직접 고침)', fromClinic: false },
];

/** 개인 정보로 보는 치환자(쓰면 경고). 이름·연락처·생일 등 */
const PERSONAL_PLACEHOLDER = /^(이름|성함|성명|환자\s*(명|이름)?|고객\s*(명|이름)?|보호자|수신자|name|patient|연락처|전화번호|휴대폰|생년월일|생일|주소)$/i;

/** 병원 정보 치환자의 실제 값(비어 있으면 빈 글) */
export function placeholderValues(c: ClinicLike | null | undefined): Record<string, string> {
  return {
    병원이름: c?.name?.trim() ?? '',
    대표번호: c?.phone?.trim() ?? '',
    진료시간: formatHours(c?.hours),
    점심시간: formatLunch(c?.hours),
    휴진안내: formatHoliday(c),
    주차안내: c?.parking?.trim() ?? '',
    위치안내: c?.location?.trim() ?? '',
    보험안내: c?.insuranceNote?.trim() ?? '',
  };
}

/** 글에 쓰인 치환자를 나눠 본다: 아는 것 · 개인 정보(환자 이름 등) · 모르는 것 */
export function scanPlaceholders(body: string): { known: string[]; personal: string[]; unknown: string[] } {
  const known = new Set<string>();
  const personal = new Set<string>();
  const unknown = new Set<string>();
  for (const m of body.matchAll(/\{([^{}\n]{1,20})\}/g)) {
    const key = (m[1] ?? '').trim();
    if (PLACEHOLDERS.some((p) => p.key === key)) known.add(key);
    else if (PERSONAL_PLACEHOLDER.test(key)) personal.add(key);
    else unknown.add(key);
  }
  return { known: [...known], personal: [...personal], unknown: [...unknown] };
}

/** 병원 정보 치환자를 실제 값으로 바꾼다. 값이 비어 있거나 날짜·시간 자리면 그대로 둔다 */
export function fillPlaceholders(body: string, c: ClinicLike | null | undefined): string {
  const values = placeholderValues(c);
  return body.replace(/\{([^{}\n]{1,20})\}/g, (all, k: string) => {
    const v = values[k.trim()];
    return v ? v : all;
  });
}

// ── 문자 글자 수 ──────────────────────────────────────────────────────────────

/** 단문(SMS) 최대 바이트 */
export const SMS_SHORT_BYTES = 90;
/** 장문(LMS) 최대 바이트 */
export const SMS_LONG_BYTES = 2000;

/** 문자 바이트 수(한글·기호 등 2바이트, 영문·숫자·공백·줄바꿈 1바이트. 통신사 EUC-KR 기준) */
export function smsBytes(text: string): number {
  let n = 0;
  for (const ch of text.replace(/\r\n/g, '\n')) n += (ch.codePointAt(0) ?? 0) < 0x80 ? 1 : 2;
  return n;
}

/** 단문/장문 구분. 90바이트 넘으면 장문, 2000바이트 넘으면 너무 김 */
export function smsKind(bytes: number): 'short' | 'long' | 'over' {
  if (bytes <= SMS_SHORT_BYTES) return 'short';
  return bytes <= SMS_LONG_BYTES ? 'long' : 'over';
}
export const SMS_KIND_LABELS = { short: '단문', long: '장문', over: '너무 김' } as const;

// ── 리뷰 답글 점검(진료 사실 확인 표현) ─────────────────────────────────────────

/** 답글 점검 규칙 하나 */
export interface ReplyRule {
  re: RegExp;
  reason: string;
  suggestion: string;
}

/**
 * 답글에서 "리뷰 쓴 분이 우리 환자였다·이런 진료를 받았다"를 확인해 주는 표현(FR-043 AC2).
 * 답글은 누구나 보므로, 진료 사실을 밝히면 개인정보·의료법 문제가 될 수 있다.
 */
export const REPLY_FACT_RULES: readonly ReplyRule[] = [
  {
    re: /(치료|진료|시술|수술|검진|검사|상담|처치)\s*(을|를)?\s*(받으|받아|받고|받았|받은|받는|하신|하셨|해\s*드|해드)/,
    reason: '진료를 받았다는 사실을 확인해 주는 표현이에요.',
    suggestion: '"소중한 의견 남겨 주셔서 감사합니다"처럼 진료 여부를 밝히지 않는 말로 바꿔 주세요.',
  },
  {
    re: /내원|방문(해|하|하신|하셔|하셨|해\s*주)|다녀가/,
    reason: '병원에 다녀갔다는 사실을 확인해 주는 표현이에요.',
    suggestion: '방문·내원 이야기는 빼고 의견에 대한 감사만 적어 주세요.',
  },
  {
    re: /임플란트|교정|스케일링|발치|신경\s*치료|사랑니|크라운|레진|충치|미백|보철|잇몸\s*치료|틀니/,
    reason: '어떤 치료인지 드러나는 표현이에요.',
    suggestion: '치료 이름은 빼 주세요. 궁금한 점은 대표번호로 문의해 달라고 안내하면 돼요.',
  },
  {
    re: /차트|진료\s*기록|기록을\s*(확인|살펴)|예약\s*(내역|기록)|담당\s*(의|선생|원장)|지난\s*(번|진료|내원)/,
    reason: '진료 기록을 확인했다는 표현이에요.',
    suggestion: '기록을 확인했다는 말 대신 "직접 연락 주시면 자세히 안내드리겠습니다"로 바꿔 주세요.',
  },
];

/** 답글 점검 결과 한 줄 */
export interface ReplyHit {
  phrase: string;
  reason: string;
  suggestion: string;
}

/** 답글에서 진료 사실 확인 표현을 찾는다(규칙마다 처음 찾은 한 곳) */
export function checkReplyFacts(text: string): ReplyHit[] {
  const hits: ReplyHit[] = [];
  for (const rule of REPLY_FACT_RULES) {
    const m = rule.re.exec(text);
    if (m) hits.push({ phrase: m[0], reason: rule.reason, suggestion: rule.suggestion });
  }
  return hits;
}
