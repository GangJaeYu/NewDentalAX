// 이 파일이 하는 일: 보관 문구(saved_texts)의 데모 데이터(database.md §11, 가상 "하늘숲치과", 환자 정보 없음, phase-03-task-05).
// 공용 응대 스크립트 3개, 공용 문자·안내문 템플릿 4개(병원 정보 치환자 사용, 환자 이름 치환자 없음), 공용 리뷰 답글 1개를 넣는다.
// 작성자는 데모 실장(yoongaram) → 아무 manager → 첫 관리자 순서로 고른다. 이미 보관 문구가 있으면 넣지 않는다. desk 모듈 seed.ts의 seedDemo가 부른다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import type { SavedTextKind } from '../../../shared/desk-texts.ts';

/** 데모 보관 문구 */
export const DEMO_SAVED_TEXTS: ReadonlyArray<{ kind: SavedTextKind; category: string; title: string; body: string; meta?: Record<string, string>; minutesAgo: number }> = [
  {
    kind: 'script',
    category: '진료시간 문의',
    title: '진료시간 문의 기본 응대',
    body: '직원: 안녕하세요, 하늘숲치과입니다. 무엇을 도와드릴까요?\n직원: 저희 진료시간은 월~금 9:30~18:30(점심시간 13:00~14:00), 토요일 9:30~14:00, 일요일 휴진입니다.\n직원: 토요일은 점심시간 없이 2시까지 진료합니다. 더 궁금하신 점 있으시면 편하게 전화 주세요.',
    meta: { tone: '친절하고 차분하게', situation: '진료시간 문의' },
    minutesAgo: 60 * 24 * 3,
  },
  {
    kind: 'script',
    category: '주차 문의',
    title: '주차 문의 응대',
    body: '직원: 안녕하세요, 하늘숲치과입니다.\n직원: 건물 지하 1~2층 주차장을 이용하시면 되고, 진료 받으신 뒤 데스크에서 1시간 무료 주차를 등록해 드립니다.\n직원: 주차장이 붐비는 저녁 시간에는 조금 일찍 와 주시면 좋습니다.',
    meta: { tone: '밝고 상냥하게', situation: '주차 문의' },
    minutesAgo: 60 * 24 * 5,
  },
  {
    kind: 'script',
    category: '예약 변경 안내',
    title: '예약 변경 요청 응대',
    body: '직원: 예약 바꾸시려는 거죠? 원하시는 날짜와 시간대를 말씀해 주시면 바로 확인해 드리겠습니다.\n직원: 바뀐 예약은 다시 한번 날짜와 시간을 말씀드려 확인하겠습니다. 감사합니다.',
    meta: { tone: '간결하고 정중하게', situation: '예약 변경 안내' },
    minutesAgo: 60 * 24 * 7,
  },
  {
    kind: 'template',
    category: '예약 안내',
    title: '예약 하루 전 안내(단문)',
    body: '[{병원이름}] {날짜} {시간} 예약 안내입니다. 변경은 {대표번호}',
    minutesAgo: 60 * 24 * 2,
  },
  {
    kind: 'template',
    category: '휴진 안내',
    title: '연말 휴진 안내(장문)',
    body: '[{병원이름}] 연말 휴진 안내\n\n안녕하세요, {병원이름}입니다.\n12월 31일(수)과 1월 1일(목)은 휴진합니다.\n\n- 평소 진료시간: {진료시간}\n- 문의: {대표번호}\n\n새해에도 건강하세요.',
    minutesAgo: 60 * 24 * 4,
  },
  {
    kind: 'template',
    category: '진료 후 안내',
    title: '스케일링 후 주의사항',
    body: '[{병원이름}] 스케일링 후 안내드립니다. 하루 정도는 시린 느낌이 있을 수 있고, 뜨겁거나 찬 음식은 잠시 피해 주세요. 불편이 계속되면 {대표번호}로 연락 주세요.',
    minutesAgo: 60 * 24 * 6,
  },
  {
    kind: 'template',
    category: '예약 안내',
    title: '오시는 길·주차 안내',
    body: '[{병원이름}] 오시는 길 안내\n- 위치: {위치안내}\n- 주차: {주차안내}\n- 진료시간: {진료시간}',
    minutesAgo: 60 * 24 * 8,
  },
  {
    kind: 'review_reply',
    category: '좋은 리뷰',
    title: '친절 칭찬 리뷰 답글',
    body: '안녕하세요, 하늘숲치과입니다. 따뜻한 리뷰 남겨 주셔서 감사합니다. 직원 모두 큰 힘을 얻었어요. 앞으로도 편안한 치과가 되도록 노력하겠습니다.',
    meta: { tone: '따뜻하게' },
    minutesAgo: 60 * 24 * 1,
  },
];

/** 작성자: 데모 실장 → 아무 manager → 첫 관리자 */
function authorOf(db: Db): number | null {
  return (
    db.get<{ id: number }>("SELECT id FROM users WHERE username = 'yoongaram'")?.id ??
    db.get<{ id: number }>("SELECT id FROM users WHERE role = 'manager' AND active = 1 ORDER BY id LIMIT 1")?.id ??
    db.get<{ id: number }>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")?.id ??
    null
  );
}

/** 데모 보관 문구를 넣는다(이미 있으면 건너뜀) */
export function seedSavedTexts(db: Db, ctx: SeedContext): void {
  if (db.get('SELECT 1 AS x FROM saved_texts LIMIT 1')) return;
  const author = authorOf(db);
  if (author === null) return;
  const now = ctx.clock.now().getTime();
  for (const t of DEMO_SAVED_TEXTS) {
    const at = new Date(now - t.minutesAgo * 60_000).toISOString();
    db.run('INSERT INTO saved_texts (kind, category, title, body, meta, shared, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)', [
      t.kind,
      t.category,
      t.title,
      t.body,
      t.meta ? JSON.stringify(t.meta) : null,
      author,
      at,
      at,
    ]);
  }
}
