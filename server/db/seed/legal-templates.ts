// 이 파일이 하는 일: 법정 의무 일정 기본 템플릿(TRD TD-022 표 22행)을 두고, DB에 빠진 템플릿만 넣는 ensureLegalTemplates를 제공한다(FR-100 AC1·AC2).
// 각 항목에는 주기·확인 상태(확인됨/권장값/확인 필요)·적용 조건·근거 조항·출처 주소(국가법령정보센터)·확인일(2026-11-02)·설명(적용 배제 조건 등)이 있다.
// 템플릿은 업무 데이터가 아니라서 데모 초기화 뒤에도 남는다(database.md §11, 02-05 demo-service가 template_key 있는 행을 남김).
// 이미 있는 템플릿은 건드리지 않는다(관리자가 고친 주기·상태·적용 여부를 지키기 위함). 출처 주소는 law.go.kr의 "법령명 주소" 형식이다.
import type { Db } from '../index.ts';
import type { Clock } from '../../lib/clock.ts';
import { LEGAL_CHECKED_ON, type LegalApplicability, type LegalCategory, type LegalVerifyStatus } from '../../../shared/schemas/legal.ts';

/** 템플릿 한 줄 */
export interface LegalTemplate {
  key: string;
  title: string;
  category: LegalCategory;
  cycleMonths: number | null;
  cycleDays: number | null;
  /** TD-022 "기본 주기" 칸 그대로 */
  cycleText: string;
  basis: string;
  sourceUrl: string;
  verifyStatus: LegalVerifyStatus;
  applicability: LegalApplicability;
  /** TD-022 "적용" 칸 그대로 */
  appliesText: string;
  guidance: string | null;
}

const LAW = 'https://www.law.go.kr/법령/';
const RULE = 'https://www.law.go.kr/행정규칙/';
const RADIATION_RULE = `${LAW}진단용방사선발생장치의안전관리에관한규칙`;

/** 규칙 제18조 적용 배제 설명(TD-022 ※) */
export const RADIATION_EXCLUSION =
  '적용 배제(진단용 방사선 규칙 제18조): 구내 촬영장치만 있고 주당 동작부하가 10mA·분 이하면 이 항목이 적용되지 않아요. ' +
  '파노라마나 CBCT가 있으면 배제되지 않아요. 해당하지 않으면 "해당 없음"으로 꺼 주세요.';

/** TRD TD-022 표 22행(순서도 표와 같다) */
export const LEGAL_TEMPLATES: readonly LegalTemplate[] = [
  {
    key: 'radiation-inspection',
    title: '진단용 방사선 발생장치 정기검사(장비별)',
    category: 'radiation',
    cycleMonths: 36,
    cycleDays: null,
    cycleText: '3년, 만료일 전후 31일이 검사기간',
    basis: '진단용 방사선 규칙 제4조',
    sourceUrl: RADIATION_RULE,
    verifyStatus: 'verified',
    applicability: 'always',
    appliesText: '항상(구내·파노라마·CBCT)',
    guidance: '장비마다 따로 관리해요. 장비가 여러 대면 "항목 추가"에서 이 템플릿을 골라 "파노라마 정기검사"처럼 장비별 항목을 만들어 주세요.',
  },
  {
    key: 'radiation-manager-edu',
    title: '방사선 안전관리책임자 보수교육',
    category: 'radiation',
    cycleMonths: 36,
    cycleDays: null,
    cycleText: '3년(선임교육은 선임 후 1년 이내)',
    basis: '의료법 제37조, 질병관리청고시 2023-18',
    sourceUrl: `${LAW}의료법`,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '해당 시 ※',
    guidance: RADIATION_EXCLUSION,
  },
  {
    key: 'radiation-dosimetry',
    title: '개인 피폭선량 측정(TLD)',
    category: 'radiation',
    cycleMonths: 3,
    cycleDays: null,
    cycleText: '3개월',
    basis: '진단용 방사선 규칙 제4조⑤',
    sourceUrl: RADIATION_RULE,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '해당 시 ※',
    guidance: RADIATION_EXCLUSION,
  },
  {
    key: 'radiation-health-check',
    title: '방사선 관계 종사자 건강진단',
    category: 'radiation',
    cycleMonths: 24,
    cycleDays: null,
    cycleText: '2년(신규는 업무 전)',
    basis: '진단용 방사선 규칙 제13조',
    sourceUrl: RADIATION_RULE,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '해당 시 ※',
    guidance: RADIATION_EXCLUSION,
  },
  {
    key: 'radiation-self-edu',
    title: '방사선 종사자 자체 교육',
    category: 'radiation',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '진단용 방사선 규칙 제11조',
    sourceUrl: RADIATION_RULE,
    verifyStatus: 'recommended',
    applicability: 'always',
    appliesText: '항상',
    guidance: '법정 주기가 없어 연 1회를 권장값으로 넣었어요.',
  },
  {
    key: 'waste-edu',
    title: '의료폐기물 배출자 교육',
    category: 'waste',
    cycleMonths: 36,
    cycleDays: null,
    cycleText: '3년(최초는 처리계획 확인 후 1년 이내)',
    basis: '폐기물관리법 시행규칙 제50조',
    sourceUrl: `${LAW}폐기물관리법시행규칙`,
    verifyStatus: 'verified',
    applicability: 'always',
    appliesText: '항상',
    guidance: null,
  },
  {
    key: 'waste-storage-disinfect',
    title: '의료폐기물 보관시설 소독',
    category: 'waste',
    cycleMonths: null,
    cycleDays: 7,
    cycleText: '주 1회',
    basis: '폐기물관리법 시행규칙 별표5',
    sourceUrl: `${LAW}폐기물관리법시행규칙`,
    verifyStatus: 'verified',
    applicability: 'always',
    appliesText: '항상',
    guidance: null,
  },
  {
    key: 'waste-storage-period',
    title: '의료폐기물 보관기간 안내',
    category: 'waste',
    cycleMonths: null,
    cycleDays: null,
    cycleText: '치아 60일, 손상성 30일, 일반 15일(냉장 4℃ 이하 30일) 등',
    basis: '폐기물관리법 시행규칙 별표5',
    sourceUrl: `${LAW}폐기물관리법시행규칙`,
    verifyStatus: 'verified',
    applicability: 'always',
    appliesText: '항상',
    guidance: '정해진 날에 하는 일이 아니라 보관기간 안내문으로 보여 줘요. 보관함에 붙여 두고 지켜 주세요.',
  },
  {
    key: 'fire-operation-check',
    title: '소방시설 작동점검',
    category: 'fire',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '소방시설법 시행규칙 별표3',
    sourceUrl: `${LAW}소방시설설치및관리에관한법률시행규칙`,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '해당 시(건물 단위, 임차 시 건물 관리주체)',
    guidance: '건물 단위로 하는 점검이에요. 임차한 건물이면 건물 관리주체가 하는지 확인해 주세요.',
  },
  {
    key: 'fire-full-check',
    title: '소방시설 종합점검',
    category: 'fire',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '소방시설법 시행규칙 별표3',
    sourceUrl: `${LAW}소방시설설치및관리에관한법률시행규칙`,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '해당 시(스프링클러 설치 건물 등)',
    guidance: null,
  },
  {
    key: 'fire-drill',
    title: '소방훈련·교육',
    category: 'fire',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '화재예방법 시행규칙 제36조',
    sourceUrl: `${LAW}화재의예방및안전관리에관한법률시행규칙`,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '해당 시(소방안전관리대상물)',
    guidance: '소방안전관리대상물 등급 기준은 아직 확인하지 못했어요. 건물 관리주체에게 확인해 주세요.',
  },
  {
    key: 'privacy-edu',
    title: '개인정보취급자 교육',
    category: 'privacy',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '개인정보 보호법 제28조, 안전성 확보조치 기준 제4조',
    sourceUrl: `${LAW}개인정보보호법`,
    verifyStatus: 'recommended',
    applicability: 'always',
    appliesText: '항상',
    guidance: '법령에는 "정기적으로"라고만 적혀 있어 연 1회를 권장값으로 넣었어요.',
  },
  {
    key: 'privacy-plan-check',
    title: '개인정보 내부관리계획 이행 점검',
    category: 'privacy',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '개인정보의 안전성 확보조치 기준 제4조',
    sourceUrl: `${RULE}개인정보의안전성확보조치기준`,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '해당 시',
    guidance: null,
  },
  {
    key: 'infection-edu',
    title: '감염병 예방 교육',
    category: 'infection',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '의료법 제47조, 시행규칙 제46조의2',
    sourceUrl: `${LAW}의료법시행규칙`,
    verifyStatus: 'recommended',
    applicability: 'always',
    appliesText: '항상',
    guidance: '법령에는 "정기적으로"(감염병 유행 시 2회 이상)라고 적혀 있어 연 1회를 권장값으로 넣었어요. 세부 고시는 아직 확인하지 못했어요.',
  },
  {
    key: 'harassment-edu',
    title: '직장 내 성희롱 예방교육',
    category: 'labor',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '남녀고용평등법 시행령 제3조',
    sourceUrl: `${LAW}남녀고용평등과일ㆍ가정양립지원에관한법률시행령`,
    verifyStatus: 'verified',
    applicability: 'always',
    appliesText: '항상(10명 미만은 자료 게시로 대체 가능)',
    guidance: '상시 직원이 10명 미만이면 교육 자료를 게시하거나 배포하는 것으로 대신할 수 있어요.',
  },
  {
    key: 'disability-awareness-edu',
    title: '직장 내 장애인 인식개선 교육',
    category: 'labor',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '장애인고용촉진법 시행령 제5조의2',
    sourceUrl: `${LAW}장애인고용촉진및직업재활법시행령`,
    verifyStatus: 'verified',
    applicability: 'always',
    appliesText: '항상(50명 미만은 자료 배포로 대체 가능)',
    guidance: '상시 직원이 50명 미만이면 교육 자료를 배포하거나 게시하는 것으로 대신할 수 있어요.',
  },
  {
    key: 'pension-edu',
    title: '퇴직연금 가입자 교육',
    category: 'labor',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '근로자퇴직급여 보장법 제32조',
    sourceUrl: `${LAW}근로자퇴직급여보장법`,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '해당 시(퇴직연금 설정 시)',
    guidance: '퇴직연금 제도를 쓰지 않으면 "해당 없음"으로 꺼 주세요.',
  },
  {
    key: 'worker-health-check',
    title: '근로자 일반건강진단',
    category: 'labor',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '진료 직원 1년, 사무직 2년',
    basis: '산업안전보건법 시행규칙 제197조',
    sourceUrl: `${LAW}산업안전보건법시행규칙`,
    verifyStatus: 'verified',
    applicability: 'always',
    appliesText: '항상',
    guidance: '진료 직원 기준(1년)으로 알려 드려요. 사무직은 2년마다예요. 산업안전보건교육은 상시 50명 미만 보건업(병원 제외)에 적용되지 않아 템플릿에 넣지 않았어요.',
  },
  {
    key: 'nonpay-report',
    title: '비급여 진료비용 보고',
    category: 'report',
    cycleMonths: 12,
    cycleDays: null,
    cycleText: '연 1회',
    basis: '의료법 제45조의2, 복지부고시 2026-38',
    sourceUrl: `${LAW}의료법`,
    verifyStatus: 'verified',
    applicability: 'always',
    appliesText: '항상',
    guidance: '마약류 취급 보고는 수시 보고라서 주기 일정에 넣지 않았어요. 해당하면 "항목 추가"로 직접 넣어 주세요.',
  },
  {
    key: 'dentist-license',
    title: '치과의사 면허신고 / 보수교육',
    category: 'license',
    cycleMonths: 36,
    cycleDays: null,
    cycleText: '3년 / 연 8시간',
    basis: '의료법 제25조',
    sourceUrl: `${LAW}의료법`,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '개인별(직원 교육 기록과 연결)',
    guidance: '면허신고는 3년마다, 보수교육은 해마다 8시간이에요. 사람마다 날짜가 달라 직원 교육 기록과 함께 확인해 주세요.',
  },
  {
    key: 'hygienist-report',
    title: '치과위생사 실태신고 / 보수교육',
    category: 'license',
    cycleMonths: 36,
    cycleDays: null,
    cycleText: '3년 / 연 8시간',
    basis: '의료기사법 시행령 제11조',
    sourceUrl: `${LAW}의료기사등에관한법률시행령`,
    verifyStatus: 'verified',
    applicability: 'conditional',
    appliesText: '개인별',
    guidance: '실태신고는 3년마다, 보수교육은 해마다 8시간이에요. 사람마다 날짜가 달라요.',
  },
  {
    key: 'nurse-aide-edu',
    title: '간호조무사 보수교육·신고',
    category: 'license',
    cycleMonths: null,
    cycleDays: null,
    cycleText: '—',
    basis: '의료법(2024 개정으로 조문 이동)',
    sourceUrl: `${LAW}의료법`,
    verifyStatus: 'needs_check',
    applicability: 'conditional',
    appliesText: '개인별',
    guidance: '2024년 법 개정으로 조문이 옮겨져 주기를 확인하지 못했어요. 관할 기관 안내를 확인한 뒤 관리자가 주기와 상태를 고쳐 주세요.',
  },
];

/**
 * DB에 없는 템플릿만 넣는다. 넣은 개수를 돌려준다. 이미 있는 템플릿(관리자가 고친 것 포함)은 그대로 둔다.
 * 서버 시작 때와 목록을 읽을 때 부른다(백업 복원으로 예전 DB가 들어와도 빠진 템플릿이 다시 생긴다).
 */
export function ensureLegalTemplates(db: Db, clock: Clock): number {
  const have = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM legal_tasks WHERE template_key IS NOT NULL');
  if ((have?.n ?? 0) >= LEGAL_TEMPLATES.length) return 0;
  const now = clock.now().toISOString();
  let added = 0;
  db.tx(() => {
    for (const t of LEGAL_TEMPLATES) {
      const r = db.run(
        `INSERT OR IGNORE INTO legal_tasks
           (template_key, title, category, cycle_months, cycle_days, cycle_text, basis, source_url, verify_status, applicability, applies_text, guidance, enabled, checked_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [t.key, t.title, t.category, t.cycleMonths, t.cycleDays, t.cycleText, t.basis, t.sourceUrl, t.verifyStatus, t.applicability, t.appliesText, t.guidance, LEGAL_CHECKED_ON, now, now],
      );
      added += r.changes;
    }
  });
  return added;
}
