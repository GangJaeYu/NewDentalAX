// 이 파일이 하는 일: desk 모듈(공지·인수인계·오픈/마감 체크리스트)의 데모 데이터(database.md §11, TD-024). 가상 치과 "하늘숲치과" 기준이고 환자 정보는 없다.
// 공지 6개(고정 1개), 인수인계 4개(처리 완료 1개), 오픈 체크리스트 7개·마감 7개 항목, 지난 7일 체크 기록을 넣는다. 오늘 기록은 비워 둔다(오늘은 새로 시작).
// 작성자는 admin 모듈 seed가 먼저 넣은 데모 직원(윤가람 실장 등)이고, 없으면 첫 관리자를 쓴다. 이미 글이나 항목이 있으면 그 부분은 건너뛴다.
// 보관 문구(saved_texts)는 saved-texts-seed.ts가 넣는다(phase-03-task-05). scale=10(성능 측정)이면 공지·인수인계를 더 많이 넣는다. 모양은 server/db/seed/types.ts의 ModuleSeed다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { addDays, kstDate, kstMidnight } from '../../lib/dates.ts';
import type { JobType } from '../../../shared/enums.ts';
import { seedSavedTexts } from './saved-texts-seed.ts';

/** 이 모듈이 소유한 업무 테이블(초기화 때 비울 대상). 비우는 순서는 등록표가 뒤에서부터 정한다 */
export const tables: readonly string[] = ['posts', 'post_reads', 'checklist_items', 'checklist_checks', 'saved_texts'];

/** 데모 공지 6개(가상). daysAgo는 기준일로부터 며칠 전에 올렸는지 */
export const DEMO_NOTICES: ReadonlyArray<{ category: string; title: string; body: string; pinned?: boolean; daysAgo: number; hour: number }> = [
  {
    category: '감염관리',
    title: '11월 원내 감염관리 교육 일정 안내',
    body: '11월 13일(목) 점심시간 13:10~13:50에 상담실에서 감염관리 교육이 있어요.\n교육 자료는 원내 매뉴얼 "감염관리 기본"을 미리 읽어 와 주세요.',
    pinned: true,
    daysAgo: 1,
    hour: 18,
  },
  { category: '진료', title: '수요일 야간 진료 담당 순서', body: '이번 달 수요일 야간 진료(18:30~20:30)는 근무표에 적힌 순서대로 돌아가요. 바꾸고 싶으면 실장에게 먼저 알려 주세요.', daysAgo: 3, hour: 9 },
  { category: '일반', title: '대기실 정수기 필터 교체 완료', body: '대기실 정수기 필터를 새로 바꿨어요. 다음 교체는 내년 2월이에요.', daysAgo: 5, hour: 14 },
  { category: '교육', title: '신규 직원 오리엔테이션 자료 공유', body: '새로 온 직원이 볼 오리엔테이션 자료를 원내 매뉴얼에 올렸어요. 담당 선배는 첫 주에 함께 읽어 주세요.', daysAgo: 8, hour: 10 },
  { category: '행사', title: '연말 회식 날짜 투표', body: '연말 회식 날짜를 정하려고 해요. 12월 19일(금)과 12월 22일(월) 중 편한 날을 실장에게 알려 주세요.', daysAgo: 10, hour: 17 },
  { category: '일반', title: '주차 등록 차량 정리 안내', body: '건물 주차 등록 차량을 정리하고 있어요. 차를 바꾼 직원은 새 차량 번호를 데스크에 알려 주세요.', daysAgo: 14, hour: 11 },
];

/** 데모 인수인계 4개(가상, 환자 정보 없음) */
export const DEMO_HANDOVERS: ReadonlyArray<{ category: string; title: string; body: string; author: string; resolved?: boolean; daysAgo: number; hour: number }> = [
  { category: '재고', title: '거즈 박스 2개 남음, 발주 확인 필요', body: '마감 때 보니 거즈 박스가 2개 남았어요. 내일 오전에 발주 여부 확인 부탁드려요.', author: 'seodaon', daysAgo: 0, hour: 8 },
  { category: '시설', title: '2번 체어 조명 깜빡임', body: '오후부터 2번 체어 조명이 가끔 깜빡여요. 장비 점검 기록에 남겨 두었어요.', author: 'jeonghaneul', daysAgo: 1, hour: 19 },
  { category: '예약', title: '토요일 오전 예약 문의 전화 회신', body: '토요일 오전 예약 가능 시간을 묻는 전화가 두 통 있었어요. 예약표 확인 뒤 회신해 주세요.', author: 'joeunsol', daysAgo: 1, hour: 18 },
  { category: '업무', title: '멸균기 2차 사이클 결과 기록 완료', body: '어제 마감 때 멸균기 2차 사이클 결과를 기록해 두었어요.', author: 'ohsodam', resolved: true, daysAgo: 2, hour: 19 },
];

/** 데모 체크리스트 항목(가상) */
export const DEMO_CHECKLIST: Record<'open' | 'close', ReadonlyArray<{ text: string; roleHint: JobType | null }>> = {
  open: [
    { text: '출입문·대기실 조명 켜기', roleHint: 'desk' },
    { text: '진료실 체어·석션 작동 확인', roleHint: 'hygienist' },
    { text: '멸균기 예열·1차 사이클 시작', roleHint: 'assistant' },
    { text: '오늘 예약표 확인·특이사항 공유', roleHint: 'desk' },
    { text: '진료 기구 세트 준비', roleHint: 'assistant' },
    { text: '대기실 정리·소독제 채우기', roleHint: null },
    { text: '전화 자동응답을 진료 중으로 바꾸기', roleHint: 'desk' },
  ],
  close: [
    { text: '진료실 체어 소독·석션 세척', roleHint: 'hygienist' },
    { text: '사용 기구 세척·멸균기 마지막 사이클', roleHint: 'assistant' },
    { text: '의료폐기물 보관함 확인', roleHint: 'assistant' },
    { text: '내일 예약 확인 문자 발송 확인', roleHint: 'desk' },
    { text: '수납 마감·현금 정리', roleHint: 'desk' },
    { text: '컴프레서·석션 모터 끄기', roleHint: null },
    { text: '창문·출입문 잠금, 경비 설정', roleHint: null },
  ],
};

/** 아이디로 사용자 id를 찾는다(없으면 null) */
function userIdOf(db: Db, username: string): number | null {
  return db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', [username])?.id ?? null;
}

/** 공지 작성자로 쓸 사람: 데모 실장 → 아무 manager → 첫 관리자 */
function noticeAuthor(db: Db): number | null {
  return (
    userIdOf(db, 'yoongaram') ??
    db.get<{ id: number }>("SELECT id FROM users WHERE role = 'manager' AND active = 1 ORDER BY id LIMIT 1")?.id ??
    db.get<{ id: number }>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")?.id ??
    null
  );
}

/** 기준일 며칠 전 몇 시(KST)의 UTC ISO 시각 */
function atKst(today: string, daysAgo: number, hour: number, minute = 0): string {
  return new Date(kstMidnight(addDays(today, -daysAgo)).getTime() + (hour * 60 + minute) * 60_000).toISOString();
}

/** 데모 공지·인수인계·체크리스트를 넣는다 */
export function seedDemo(db: Db, ctx: SeedContext): void {
  const today = kstDate(ctx.clock.now());
  const author = noticeAuthor(db);
  if (author === null) return; // 사용자 계정이 하나도 없으면 넣을 수 없다
  const userIds = db.all<{ id: number }>('SELECT id FROM users WHERE active = 1 ORDER BY id').map((r) => r.id);
  const scale = Math.max(1, Math.floor(ctx.scale || 1));

  db.tx(() => {
    if (!db.get('SELECT 1 AS x FROM posts LIMIT 1')) {
      const insert = (kind: 'notice' | 'handover', p: { category: string; title: string; body: string; pinned?: boolean; daysAgo: number; hour: number }, by: number, round: number) => {
        const at = atKst(today, p.daysAgo + round * 15, p.hour, round % 60);
        const title = round === 0 ? p.title : `${p.title} (${round + 1})`;
        const r = db.run('INSERT INTO posts (kind, category, title, body, pinned, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          kind,
          p.category,
          title,
          p.body,
          round === 0 && p.pinned ? 1 : 0,
          by,
          at,
          at,
        ]);
        return { id: r.lastInsertRowid, at };
      };
      for (let round = 0; round < scale; round += 1) {
        DEMO_NOTICES.forEach((n, i) => {
          const { id, at } = insert('notice', n, author, round);
          // 오래된 공지일수록 많이 읽었다(데모용 읽음 기록: 앞쪽 공지는 일부만 읽음)
          const readers = userIds.filter((_, k) => k === 0 || (k + i) % 3 !== 0 || i >= 3);
          for (const uid of readers) db.run('INSERT OR IGNORE INTO post_reads (post_id, user_id, read_at) VALUES (?, ?, ?)', [id, uid, at]);
        });
        for (const h of DEMO_HANDOVERS) {
          const by = userIdOf(db, h.author) ?? author;
          const { id, at } = insert('handover', h, by, round);
          db.run('INSERT OR IGNORE INTO post_reads (post_id, user_id, read_at) VALUES (?, ?, ?)', [id, by, at]);
          if (h.resolved) db.run('UPDATE posts SET resolved_at = ?, resolved_by = ? WHERE id = ?', [atKst(today, Math.max(0, h.daysAgo - 1), 9), author, id]);
        }
      }
    }

    if (!db.get('SELECT 1 AS x FROM checklist_items LIMIT 1')) {
      for (const kind of ['open', 'close'] as const) {
        DEMO_CHECKLIST[kind].forEach((it, sort) => {
          const r = db.run('INSERT INTO checklist_items (kind, text, role_hint, sort, active) VALUES (?, ?, ?, ?, 1)', [kind, it.text, it.roleHint, sort]);
          // 지난 7일 기록: 대부분 체크, 가끔 하나씩 빠짐. 오늘은 비워 둔다
          for (let d = 1; d <= 7; d += 1) {
            if ((sort + d) % 6 === 0) continue;
            const by = userIds[(sort + d) % userIds.length] ?? author;
            const hour = kind === 'open' ? 8 : 18;
            db.run('INSERT INTO checklist_checks (item_id, date, checked_by, checked_at) VALUES (?, ?, ?, ?)', [r.lastInsertRowid, addDays(today, -d), by, atKst(today, d, hour, 5 + sort * 3)]);
          }
        });
      }
    }

    // 보관 문구(응대 스크립트·템플릿·리뷰 답글, phase-03-task-05)
    seedSavedTexts(db, ctx);
  });
}
