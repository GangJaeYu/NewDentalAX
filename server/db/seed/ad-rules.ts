// 이 파일이 하는 일: 의료광고 1차 점검 기본 규칙 사전(FR-120 AC1)을 두고, DB에 빠진 기본 규칙만 넣는 ensureAdRules를 제공한다(phase-04-task-06).
// 분류: 최고·유일·순위(과장), 100%·완치·무통(효과 보장), 치료 전후 비교, 치료 경험담, 할인·특가 강조, 무료 강조, 다른 병원과 비교, 전문병원 명칭 등.
// 이유 문구는 의료법 제56조(의료광고의 금지 등)·제27조 제3항(환자 유인)을 쉬운 말로 옮긴 참고 설명이며, 법률 자문이 아니다(고지는 결과마다 붙는다).
// 이미 있는 규칙(rule_key 같음)은 건드리지 않는다(admin이 고친 내용·끈 상태를 지키기 위함). 규칙은 업무 데이터가 아니라 데모 초기화 뒤에도 남는다.
import type { Db } from '../index.ts';
import type { Clock } from '../../lib/clock.ts';
import type { AdMatchType, AdRuleCategory, AdSeverity } from '../../../shared/schemas/adcheck.ts';

/** 기본 규칙 한 줄 */
export interface AdRuleSeed {
  key: string;
  pattern: string;
  matchType: AdMatchType;
  category: AdRuleCategory;
  severity: AdSeverity;
  reason: string;
  suggestion: string;
}

const EXAGGERATION = '객관적인 근거 없이 쓰면 사실을 부풀린 광고로 볼 수 있어요(의료법 제56조).';

/** 기본 규칙(순서가 화면 표시 순서다) */
export const AD_RULE_SEEDS: readonly AdRuleSeed[] = [
  {
    key: 'superlative-best',
    pattern: '((국내|지역|업계|세계|대한민국|동네)\\s*)?최고',
    matchType: 'regex',
    category: 'superlative',
    severity: 'high',
    reason: `'최고'는 다른 곳보다 낫다는 뜻의 최상급 표현이라 ${EXAGGERATION}`,
    suggestion: "'꼼꼼하게 진료하는', '정성을 다하는'처럼 우리 병원의 사실만 적어 주세요.",
  },
  {
    key: 'superlative-only',
    pattern: '유일',
    matchType: 'word',
    category: 'superlative',
    severity: 'high',
    reason: `'유일'은 확인하기 어려운 비교 표현이라 ${EXAGGERATION}`,
    suggestion: "'○○ 장비를 갖추고 있어요'처럼 확인할 수 있는 사실로 바꿔 주세요.",
  },
  {
    key: 'superlative-rank',
    pattern: '최초|((국내|지역|업계)\\s*)?(1위|1등|넘버\\s*원|no\\.?\\s*1)',
    matchType: 'regex',
    category: 'superlative',
    severity: 'high',
    reason: `순위나 '최초' 같은 말은 ${EXAGGERATION}`,
    suggestion: '순위 대신 진료 과목, 진료 시간처럼 사실인 내용을 알려 주세요.',
  },
  {
    key: 'superlative-most',
    pattern: '(가장|제일)\\s*(잘하는|좋은|유명한|뛰어난|확실한|안전한)',
    matchType: 'regex',
    category: 'superlative',
    severity: 'medium',
    reason: `'가장·제일'로 시작하는 자랑은 ${EXAGGERATION}`,
    suggestion: "'○○ 진료를 하고 있어요'처럼 꾸밈말 없이 적어 주세요.",
  },
  {
    key: 'superlative-master',
    pattern: '명의|신의\\s*손',
    matchType: 'regex',
    category: 'superlative',
    severity: 'medium',
    reason: `'명의' 같은 말은 ${EXAGGERATION}`,
    suggestion: "의료진 소개는 '○○과 전문의'처럼 확인할 수 있는 자격만 적어 주세요.",
  },
  {
    key: 'guarantee-100',
    pattern: '100\\s*(%|퍼센트|프로)',
    matchType: 'regex',
    category: 'guarantee',
    severity: 'high',
    reason: "'100%'는 치료 결과를 장담하는 표현이에요. 치료 결과는 사람마다 달라서 과장 광고로 볼 수 있어요(의료법 제56조).",
    suggestion: "숫자로 장담하지 말고 '개인에 따라 결과가 다를 수 있어요'를 함께 적어 주세요.",
  },
  {
    key: 'guarantee-effect',
    pattern: '완치|무통(증)?|(통증|부작용)\\s*(이|이\\s*전혀|\\s*걱정)?\\s*없|평생\\s*(보장|사용|유지)|(효과|결과|성공)\\s*(를|을)?\\s*보장|성공률',
    matchType: 'regex',
    category: 'guarantee',
    severity: 'high',
    reason: '통증·부작용이 없다거나 결과를 보장한다는 말은 효과를 잘못 믿게 하고 중요한 정보(부작용)를 빠뜨린 광고로 볼 수 있어요(의료법 제56조).',
    suggestion: "'통증을 줄이려고 노력해요', '개인에 따라 붓기·통증 같은 부작용이 있을 수 있어요'처럼 적어 주세요.",
  },
  {
    key: 'before-after',
    pattern: '(치료|시술|수술|교정|미백)?\\s*전\\s*[·ㆍ/]?\\s*후\\s*(비교|사진)|비포\\s*(앤|&)?\\s*애프터|before\\s*(&|and)?\\s*after',
    matchType: 'regex',
    category: 'before_after',
    severity: 'high',
    reason: '치료 전후 비교 사진·글은 치료 효과를 잘못 믿게 할 수 있어 의료광고에서 제한돼요(의료법 제56조).',
    suggestion: '전후 비교 대신 치료 과정과 치료 뒤 주의할 점을 글로 안내해 주세요.',
  },
  {
    key: 'testimonial',
    pattern: '(치료|시술|수술|환자|실제|생생한|솔직한)\\s*(후기|경험담|체험기)|경험담|체험기',
    matchType: 'regex',
    category: 'testimonial',
    severity: 'high',
    reason: '환자의 치료 경험담은 다른 사람도 같은 효과를 볼 것처럼 믿게 할 수 있어 의료광고에서 금지돼요(의료법 제56조).',
    suggestion: '경험담 대신 치료 방법과 기간, 주의할 점 같은 일반 정보를 적어 주세요.',
  },
  {
    key: 'discount',
    pattern: '\\d{1,3}\\s*(%|퍼센트|프로)\\s*(할인|DC|디씨|off)|반값|파격\\s*(할인|가격|혜택)|최저가|특가|할인\\s*(이벤트|행사)',
    matchType: 'regex',
    category: 'discount',
    severity: 'high',
    reason: '진료비 할인을 크게 내세우면 환자를 끌어들이는 광고(의료법 제27조 제3항)나 소비자를 현혹하는 광고로 볼 수 있어요.',
    suggestion: '할인 대신 진료 내용과 예약 방법을 안내하고, 비용은 병원에서 상담받도록 적어 주세요.',
  },
  {
    key: 'discount-urgency',
    pattern: '선착순|마감\\s*임박|한정\\s*(수량|인원|기간)',
    matchType: 'regex',
    category: 'discount',
    severity: 'medium',
    reason: '인원·기간을 내세워 서두르게 하는 말은 환자를 끌어들이는 광고로 볼 수 있어요.',
    suggestion: '진료 일정과 예약 방법만 차분하게 안내해 주세요.',
  },
  {
    key: 'free',
    pattern: '(무료|공짜)\\s*(검진|진료|시술|스케일링|치료|미백|교정|이벤트)|0원\\s*(진료|치료|시술)|본인\\s*부담금?\\s*(면제|할인|없)',
    matchType: 'regex',
    category: 'free',
    severity: 'high',
    reason: '무료 진료·본인부담금 면제를 내세우면 환자를 끌어들이는 행위로 볼 수 있어요(의료법 제27조 제3항).',
    suggestion: "'무료' 대신 '건강보험 적용 기준은 병원에 문의해 주세요'처럼 안내해 주세요.",
  },
  {
    key: 'comparison',
    pattern: '(다른|타)\\s*(병원|치과|의원)\\s*(보다|과|와|에\\s*비해|대비)|(어디|누구)보다',
    matchType: 'regex',
    category: 'comparison',
    severity: 'high',
    reason: '다른 병원·의료인과 비교하는 광고는 의료광고에서 금지돼요(의료법 제56조).',
    suggestion: '비교하지 말고 우리 병원의 진료 방식만 사실대로 적어 주세요.',
  },
  {
    key: 'specialty-hospital',
    pattern: '전문병원',
    matchType: 'word',
    category: 'other',
    severity: 'high',
    reason: "보건복지부가 지정한 전문병원이 아니면 '전문병원'이라는 이름을 쓸 수 없어요.",
    suggestion: "'○○ 진료를 하고 있어요'처럼 진료 과목으로 적어 주세요.",
  },
];

/** 빠진 기본 규칙만 넣는다. 넣은 개수를 돌려준다 */
export function ensureAdRules(db: Db, clock: Clock): number {
  const have = new Set(db.all<{ rule_key: string }>('SELECT rule_key FROM ad_rules WHERE rule_key IS NOT NULL').map((r) => r.rule_key));
  const missing = AD_RULE_SEEDS.map((s, i) => ({ s, i })).filter(({ s }) => !have.has(s.key));
  if (!missing.length) return 0;
  const now = clock.now().toISOString();
  db.tx(() => {
    for (const { s, i } of missing) {
      db.run(
        'INSERT INTO ad_rules (rule_key, pattern, match_type, category, severity, reason, suggestion, active, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
        [s.key, s.pattern, s.matchType, s.category, s.severity, s.reason, s.suggestion, i, now, now],
      );
    }
  });
  return missing.length;
}
