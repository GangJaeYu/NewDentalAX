// 이 파일이 하는 일: 채용 공고의 차별 소지 표현 규칙 사전과 점검 함수(FR-084 AC1). 나이·성별·결혼·출신 지역·외모·종교·가족 같은 조건을 찾아
// 위치·이유·바꿀 말을 돌려준다. 의료광고 점검(rules.ts)과 같은 방식(규칙 사전 + 위치 하이라이트)이고, DB 없이 쓰는 순수 함수라 단위 테스트한다.
// 근거: 채용절차의 공정화에 관한 법률 제4조의3(용모·키·체중, 출신 지역, 혼인 여부, 재산, 가족의 학력·직업·재산 수집 금지),
// 남녀고용평등과 일과 가정 양립 지원에 관한 법률 제7조(성별·혼인·임신·출산 차별 금지), 고용상 연령차별금지 및 고령자고용촉진에 관한 법률 제4조의4(연령 차별 금지).
// 법률 자문이 아니라 1차 점검이다. 화면에서 "빼야 해요(high)·살펴보세요(medium)"로 보인다. POST /api/hiring/check 입력 검사(hiringCheckSchema)와 처리(runHiringCheck)도 여기 둔다.
import { z } from 'zod';
import { HIRING_CHECK_MAX_TEXT, type HiringCheckResponse, type HiringRiskCategory, type HiringRiskHit, type HiringRiskSeverity } from '../../../shared/schemas/hiring.ts';

/** 규칙 하나 */
export interface HiringRule {
  key: string;
  /** 찾을 정규식(대소문자 무시, 전체 검색) */
  pattern: RegExp;
  category: HiringRiskCategory;
  severity: HiringRiskSeverity;
  reason: string;
  suggestion: string;
}

const AGE_LAW = '나이를 채용 조건으로 두면 연령차별금지법에 어긋날 수 있어요.';
const GENDER_LAW = '성별을 채용 조건으로 두면 남녀고용평등법에 어긋날 수 있어요.';
const MARRIAGE_LAW = '결혼·임신·출산 여부를 조건으로 두거나 묻는 것은 남녀고용평등법·채용절차법에 어긋날 수 있어요.';
const PROCESS_LAW = '채용절차법은 직무와 관계없는 이런 정보를 묻거나 모으지 못하게 해요.';

/** 차별 소지 표현 규칙 사전(앞쪽이 우선. 같은 곳에 걸리면 긴 표현을 남긴다) */
export const HIRING_RULES: readonly HiringRule[] = [
  // ── 나이 ──
  {
    key: 'age-decade',
    pattern: /[1-9]0\s*대(?:\s*(?:초반|중반|후반|이하|이상|까지|만))?(?:\s*[~∼-]\s*[1-9]0\s*대(?:\s*(?:초반|중반|후반))?)?/gu,
    category: 'age',
    severity: 'high',
    reason: AGE_LAW,
    suggestion: '나이 대신 "관련 경력 1년 이상"처럼 직무에 필요한 조건으로 적어 주세요.',
  },
  {
    key: 'age-limit',
    pattern: /(?:만\s*)?\d{2}\s*(?:세|살)\s*(?:이하|미만|까지|넘지\s*않)/gu,
    category: 'age',
    severity: 'high',
    reason: AGE_LAW,
    suggestion: '나이 제한을 빼고, 필요한 경력이나 자격으로 적어 주세요.',
  },
  {
    key: 'age-birth-year',
    pattern: /(?:19|20)?\d{2}\s*년생/gu,
    category: 'age',
    severity: 'high',
    reason: AGE_LAW,
    suggestion: '태어난 해 조건을 빼 주세요.',
  },
  {
    key: 'age-word',
    pattern: /(?:나이|연령)\s*(?:제한|조건|순|어린|젊은|많지\s*않은)|(?:젊은|어린|연령대\s*낮은)\s*(?:분|사람|직원|인재|선생님|친구)/gu,
    category: 'age',
    severity: 'high',
    reason: AGE_LAW,
    suggestion: '"젊은 분" 대신 "밝게 응대하는 분"처럼 일하는 모습으로 적어 주세요.',
  },
  // ── 성별 ──
  {
    key: 'gender',
    pattern: /(?:여성|남성|여자|남자|여직원|남직원|여선생님|남선생님)(?:\s*(?:분|만|우대|환영|선호|한정|지원\s*가능))?/gu,
    category: 'gender',
    severity: 'high',
    reason: GENDER_LAW,
    suggestion: '성별을 빼고 "누구나 지원할 수 있어요"처럼 적어 주세요.',
  },
  {
    key: 'military',
    pattern: /군필(?:자)?(?:\s*(?:우대|만|한정))?|병역\s*필(?:한)?/gu,
    category: 'gender',
    severity: 'medium',
    reason: '군필 조건은 사실상 한 성별만 지원하게 만들 수 있어요(간접 차별).',
    suggestion: '직무에 꼭 필요하지 않다면 빼 주세요.',
  },
  // ── 결혼·임신·출산 ──
  {
    key: 'marriage',
    pattern: /미혼(?:자|인\s*분)?|기혼(?:자)?|결혼\s*(?:여부|계획|예정|안\s*한|하신|한)|혼인\s*(?:여부|상태)|싱글(?!벙글)|돌싱/gu,
    category: 'marriage',
    severity: 'high',
    reason: MARRIAGE_LAW,
    suggestion: '결혼 여부는 적지도 묻지도 말아 주세요.',
  },
  {
    key: 'pregnancy',
    pattern: /임신\s*(?:계획|예정|여부|중|하지\s*않)|출산\s*(?:계획|예정|여부)|(?:자녀|아이|애)\s*(?:가\s*)?(?:없는|있는|계획|유무|여부)|육아\s*(?:부담|중이\s*아닌)/gu,
    category: 'marriage',
    severity: 'high',
    reason: MARRIAGE_LAW,
    suggestion: '임신·출산·자녀 조건을 빼 주세요. 근무 시간이 중요하면 "주 5일, 9:30~18:30"처럼 근무 조건으로 적어 주세요.',
  },
  // ── 출신 지역·학교 ──
  {
    key: 'origin',
    pattern: /\S*\s*출신(?:\s*(?:만|우대|환영|한정))?|고향(?:이)?\s*\S+\s*(?:인|이신)\s*분/gu,
    category: 'origin',
    severity: 'high',
    reason: `출신 지역·학교를 조건으로 두면 차별이 될 수 있어요. ${PROCESS_LAW}`,
    suggestion: '출신 대신 필요한 자격(예: 치과위생사 면허)으로 적어 주세요.',
  },
  {
    key: 'school',
    pattern: /명문대(?:학)?|인서울|서울\s*소재\s*대학?|학벌|SKY\s*(?:대학?|출신)?/gu,
    category: 'origin',
    severity: 'high',
    reason: '학교 이름이나 학벌을 조건으로 두면 직무와 관계없는 차별이 될 수 있어요.',
    suggestion: '필요한 면허·교육 이수처럼 직무 자격으로 적어 주세요.',
  },
  {
    key: 'residence',
    pattern: /(?:인근|근처|근거리|\S+[구시동])\s*거주자?\s*(?:우대|만|한정|환영)/gu,
    category: 'origin',
    severity: 'medium',
    reason: '사는 곳을 조건으로 두면 지원을 막을 수 있어요. 출퇴근이 걱정이면 근무 시간을 분명히 적는 편이 좋아요.',
    suggestion: '"출퇴근 시간이 맞는 분"처럼 근무 조건으로 바꿔 주세요.',
  },
  // ── 외모·신체 조건 ──
  {
    key: 'body',
    pattern: /외모|키\s*\d{3}|키\s*(?:큰|작은|가\s*큰)|체중|몸무게|날씬|예쁜|잘생긴|미모|호감\s*(?:가는\s*)?(?:외모|인상)|인상\s*(?:좋은|이\s*좋은)|신체\s*(?:조건|사이즈)|전신\s*사진|사진\s*(?:첨부\s*)?필수/gu,
    category: 'body',
    severity: 'high',
    reason: `용모·키·체중 같은 신체 조건은 직무와 관계없어요. ${PROCESS_LAW}`,
    suggestion: '외모 대신 "환자에게 친절하게 설명하는 분"처럼 일하는 모습으로 적어 주세요.',
  },
  {
    key: 'neat',
    pattern: /용모\s*단정/gu,
    category: 'body',
    severity: 'medium',
    reason: '"용모 단정"은 외모로 사람을 고른다고 읽힐 수 있어요.',
    suggestion: '"근무 복장 규정을 지킬 수 있는 분"처럼 바꿔 주세요.',
  },
  // ── 종교 ──
  {
    key: 'religion',
    pattern: /종교|기독교|불교|천주교|교회\s*(?:다니|출석)|신앙|크리스천|신자/gu,
    category: 'religion',
    severity: 'high',
    reason: '종교를 조건으로 두거나 묻는 것은 차별이 될 수 있어요.',
    suggestion: '종교 조건을 빼 주세요.',
  },
  // ── 가족·재산 ──
  {
    key: 'family',
    pattern: /(?:부모|부모님|가족|형제)\s*(?:의\s*)?(?:직업|학력|재산|관계)|가족\s*사항|재산\s*(?:상태|정도)|자가\s*(?:보유|소유)/gu,
    category: 'family',
    severity: 'high',
    reason: `가족의 학력·직업·재산이나 본인 재산은 ${PROCESS_LAW}`,
    suggestion: '가족·재산 조건을 빼 주세요.',
  },
  // ── 기타 ──
  {
    key: 'health',
    pattern: /장애\s*(?:가\s*)?(?:없는|없으신)|건강한\s*(?:신체|몸)|흡연자\s*(?:불가|제외)|(?:비)?흡연\s*여부|혈액형/gu,
    category: 'other',
    severity: 'medium',
    reason: '직무와 관계없는 건강·신체 조건은 차별이 될 수 있어요.',
    suggestion: '직무에 꼭 필요한 조건(예: "근무 중 금연")만 적어 주세요.',
  },
];

/** 한 번에 돌려줄 최대 표현 수 */
export const MAX_HIRING_HITS = 100;

/**
 * 글에서 차별 소지 표현을 모두 찾는다. 글 앞쪽부터 늘어놓고, 다른 표현 안에 완전히 들어가는 것은 뺀다(같은 곳을 두 번 표시하지 않음).
 * rules를 넘기면 그 규칙만 쓴다(테스트용).
 */
export function findHiringRisks(text: string, rules: readonly HiringRule[] = HIRING_RULES): HiringRiskHit[] {
  const all: HiringRiskHit[] = [];
  for (const rule of rules) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null && guard < MAX_HIRING_HITS) {
      guard += 1;
      if (m[0] === '') {
        re.lastIndex += 1;
        continue;
      }
      // 앞뒤 공백은 표시에서 뺀다
      const raw = m[0];
      const lead = raw.length - raw.trimStart().length;
      const phrase = raw.trim();
      if (!phrase) continue;
      const start = m.index + lead;
      all.push({ ruleKey: rule.key, start, end: start + phrase.length, phrase, category: rule.category, severity: rule.severity, reason: rule.reason, suggestion: rule.suggestion });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || sevRank(b.severity) - sevRank(a.severity));
  const out: HiringRiskHit[] = [];
  for (const h of all) {
    // 이미 고른 표현과 겹치면 뺀다(앞쪽·긴 표현 우선)
    if (out.some((o) => h.start < o.end && o.start < h.end)) continue;
    out.push(h);
    if (out.length >= MAX_HIRING_HITS) break;
  }
  return out;
}

function sevRank(s: HiringRiskSeverity): number {
  return s === 'high' ? 2 : 1;
}

/** POST /api/hiring/check 본문 */
export const hiringCheckSchema = z.object({
  text: z
    .string({ error: '점검할 글을 적어 주세요.' })
    .max(HIRING_CHECK_MAX_TEXT, { error: `점검할 글은 ${HIRING_CHECK_MAX_TEXT.toLocaleString('ko-KR')}자까지 넣을 수 있어요.` }),
});

/** 글을 점검해 응답 모양으로 돌려준다(빈 글이면 찾은 표현 없음). 글은 저장하지 않는다 */
export function runHiringCheck(text: string): HiringCheckResponse {
  const t = text.trim();
  return { text: t, hits: t ? findHiringRisks(t) : [] };
}
