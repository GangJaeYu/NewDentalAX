// 이 파일이 하는 일: 교육 이수 기록·온보딩(phase-04-task-02)의 데모 데이터(database.md §11, TD-024). 가상 "하늘숲치과" 기준이고 환자 정보는 없다.
// 교육 항목 6개(법정 일정 감염관리·개인정보·성희롱 예방·방사선 교육과 연결)와 직원별 이수 기록을 넣어, 기한 지남·임박·여유·기록 필요가 고루 보이게 한다.
// 이수일은 기준일(시계)에서 "남은 날"을 거꾸로 계산해 정한다. 온보딩은 직무별 템플릿 3개와 최근 입사자 2명의 배정(멘토 지정, 일부 체크)을 넣는다.
// 직원은 admin 모듈 seed가 먼저 넣은 데모 직원이고, 없으면 그 건은 건너뛴다. 이미 교육 항목이 있으면 넣지 않는다. hr/seed.ts가 이 파일을 부른다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { ensureLegalTemplates } from '../../db/seed/legal-templates.ts';
import { addDays, addMonths, kstDate } from '../../lib/dates.ts';
import type { JobType } from '../../../shared/enums.ts';

/** 이 파일이 채우는 테이블. 데모 초기화(admin/demo-service clearableTables)는 등록표 밖 테이블도 모두 비우므로 hr/seed.ts의 tables에는 더하지 않는다(phase-03-task-09 테스트가 그 목록을 그대로 확인함) */
export const trainingTables: readonly string[] = ['training_records', 'trainings', 'onboarding_progress', 'onboarding_assignments', 'onboarding_templates'];

/** 데모 교육 항목. legal은 legal_tasks.template_key */
export const DEMO_TRAININGS: ReadonlyArray<{ key: string; name: string; cycleMonths: number | null; description: string; legal?: string }> = [
  { key: 'infection', name: '감염관리 교육', cycleMonths: 12, description: '손 위생·보호구·기구 소독과 멸균 기본 수칙', legal: 'infection-edu' },
  { key: 'privacy', name: '개인정보 보호 교육', cycleMonths: 12, description: '진료 기록·연락처 등 개인정보를 다루는 원칙', legal: 'privacy-edu' },
  { key: 'harassment', name: '직장 내 성희롱 예방 교육', cycleMonths: 12, description: '해마다 전 직원이 받는 법정 교육', legal: 'harassment-edu' },
  { key: 'radiation', name: '방사선 안전 교육', cycleMonths: 12, description: '방사선 촬영 보조 직원의 방호 수칙', legal: 'radiation-self-edu' },
  { key: 'cpr', name: '심폐소생술(CPR) 교육', cycleMonths: 24, description: '응급 상황 대응 실습' },
  { key: 'newcomer', name: '신규 직원 안전 교육', cycleMonths: null, description: '입사할 때 한 번 받는 원내 안전 교육' },
];

/** 데모 이수 기록. daysLeft는 기준일에서 본 다음 예정일까지 남은 날(음수면 지남). 주기가 없는 교육은 daysAgo(며칠 전 이수) */
export const DEMO_TRAINING_RECORDS: ReadonlyArray<{ training: string; user: string; daysLeft?: number; daysAgo?: number; note?: string }> = [
  { training: 'infection', user: 'yoongaram', daysLeft: 120 },
  { training: 'infection', user: 'jeonghaneul', daysLeft: 11, note: '보건소 온라인 교육' },
  { training: 'infection', user: 'ohsodam', daysLeft: 11, note: '보건소 온라인 교육' },
  { training: 'infection', user: 'seodaon', daysLeft: -6 },
  { training: 'infection', user: 'moonjian', daysLeft: 200 },
  { training: 'infection', user: 'joeunsol', daysLeft: 25 },
  { training: 'privacy', user: 'yoongaram', daysLeft: -18 },
  { training: 'privacy', user: 'moonjian', daysLeft: -18 },
  { training: 'privacy', user: 'joeunsol', daysLeft: 300 },
  { training: 'privacy', user: 'jeonghaneul', daysLeft: 160 },
  { training: 'harassment', user: 'yoongaram', daysLeft: 123 },
  { training: 'harassment', user: 'jeonghaneul', daysLeft: 123 },
  { training: 'harassment', user: 'ohsodam', daysLeft: 123 },
  { training: 'harassment', user: 'seodaon', daysLeft: 123 },
  { training: 'harassment', user: 'moonjian', daysLeft: 123 },
  { training: 'harassment', user: 'joeunsol', daysLeft: 5 },
  { training: 'radiation', user: 'yoongaram', daysLeft: 18 },
  { training: 'radiation', user: 'jeonghaneul', daysLeft: 18 },
  { training: 'radiation', user: 'ohsodam', daysLeft: 240 },
  { training: 'cpr', user: 'yoongaram', daysLeft: 400 },
  { training: 'cpr', user: 'moonjian', daysLeft: 60 },
  { training: 'newcomer', user: 'limchaeun', daysAgo: 118 },
  { training: 'newcomer', user: 'baenuri', daysAgo: 38 },
];

/** 데모 온보딩 템플릿 */
export const DEMO_ONBOARDING_TEMPLATES: ReadonlyArray<{ key: string; jobType: JobType; title: string; items: readonly string[] }> = [
  {
    key: 'hygienist',
    jobType: 'hygienist',
    title: '치과위생사 첫 달 체크리스트',
    items: [
      '비상 연락망·근무 시간 확인',
      '진료실·소독실 동선과 기구 위치 익히기',
      '감염관리 기본 수칙 익히기',
      '스케일링 기구·초음파 장비 준비와 정리',
      '멸균기 사용법과 멸균 기록 쓰는 법',
      '방사선 촬영 보조와 방호 수칙 확인',
      '선배 위생사 진료 보조 참관 3회',
      '첫 달 마치고 멘토와 면담',
    ],
  },
  {
    key: 'assistant',
    jobType: 'assistant',
    title: '간호조무사 첫 달 체크리스트',
    items: [
      '비상 연락망·근무 시간 확인',
      '진료실·소독실 물품 위치 익히기',
      '기본 기구 세팅(검진·충전·발치) 익히기',
      '멸균기 사용법과 멸균 기록 쓰는 법',
      '재료 재고 확인과 입출고 기록 방법',
      '진료 후 유닛 체어 소독 순서 실습',
      '첫 달 마치고 멘토와 면담',
    ],
  },
  {
    key: 'desk',
    jobType: 'desk',
    title: '데스크 첫 주 체크리스트',
    items: ['예약 접수·변경·취소 응대 순서', '전화 응대 스크립트 따라 해 보기', '수납·영수증 발행 절차', '진료 시간·휴진일·주차 안내 외우기', '인수인계 게시판 쓰는 법'],
  },
];

/** 데모 배정: 신규 직원·멘토·템플릿·시작(며칠 전)·끝낸 항목 번호 */
export const DEMO_ASSIGNMENTS: ReadonlyArray<{ user: string; mentor: string; template: string; startedDaysAgo: number; done: readonly number[] }> = [
  { user: 'baenuri', mentor: 'seodaon', template: 'assistant', startedDaysAgo: 38, done: [0, 1, 2] },
  { user: 'limchaeun', mentor: 'jeonghaneul', template: 'hygienist', startedDaysAgo: 118, done: [0, 1, 2, 3, 4, 5, 6] },
];

/** 아이디로 사용자 id를 찾는다(없으면 null) */
function userIdOf(db: Db, username: string): number | null {
  return db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', [username])?.id ?? null;
}

/** 기록한 사람: 데모 실장 → 아무 manager → 첫 관리자 */
function recorder(db: Db): number | null {
  return (
    userIdOf(db, 'yoongaram') ??
    db.get<{ id: number }>("SELECT id FROM users WHERE role = 'manager' AND active = 1 ORDER BY id LIMIT 1")?.id ??
    db.get<{ id: number }>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")?.id ??
    null
  );
}

/** 교육·온보딩 데모 데이터를 넣는다 */
export function seedTrainingDemo(db: Db, ctx: SeedContext): void {
  if (db.get('SELECT 1 AS x FROM trainings LIMIT 1')) return;
  ensureLegalTemplates(db, ctx.clock);
  const today = kstDate(ctx.clock.now());
  const now = ctx.clock.now().toISOString();
  const scale = Math.max(1, Math.floor(ctx.scale || 1));
  const by = recorder(db);

  db.tx(() => {
    const trainingIds = new Map<string, { id: number; cycle: number | null }>();
    for (const t of DEMO_TRAININGS) {
      const legalId = t.legal ? (db.get<{ id: number }>('SELECT id FROM legal_tasks WHERE template_key = ?', [t.legal])?.id ?? null) : null;
      const r = db.run('INSERT INTO trainings (name, cycle_months, description, legal_task_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', [
        t.name,
        t.cycleMonths,
        t.description,
        legalId,
        now,
        now,
      ]);
      trainingIds.set(t.key, { id: r.lastInsertRowid, cycle: t.cycleMonths });
    }
    const addRecord = (trainingId: number, userId: number, completedOn: string, note: string) =>
      db.run('INSERT INTO training_records (training_id, user_id, completed_on, file_id, note, created_by, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)', [
        trainingId,
        userId,
        completedOn,
        note,
        by,
        now,
      ]);
    for (const rec of DEMO_TRAINING_RECORDS) {
      const t = trainingIds.get(rec.training);
      const userId = userIdOf(db, rec.user);
      if (!t || userId === null) continue;
      const completedOn = t.cycle ? addMonths(addDays(today, rec.daysLeft ?? 0), -t.cycle) : addDays(today, -(rec.daysAgo ?? 0));
      if (completedOn > today) continue;
      // scale=10(성능 측정): 지난 주기 기록을 더 쌓는다
      for (let i = scale - 1; i >= 1; i -= 1) if (t.cycle) addRecord(t.id, userId, addMonths(completedOn, -t.cycle * i), '');
      addRecord(t.id, userId, completedOn, rec.note ?? '');
    }

    const templateIds = new Map<string, { id: number; title: string; items: readonly string[] }>();
    for (const tpl of DEMO_ONBOARDING_TEMPLATES) {
      const r = db.run('INSERT INTO onboarding_templates (job_type, title, items, source, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)', [
        tpl.jobType,
        tpl.title,
        JSON.stringify(tpl.items),
        'manual',
        by,
        now,
        now,
      ]);
      templateIds.set(tpl.key, { id: r.lastInsertRowid, title: tpl.title, items: tpl.items });
    }
    for (const a of DEMO_ASSIGNMENTS) {
      const userId = userIdOf(db, a.user);
      const mentorId = userIdOf(db, a.mentor);
      const tpl = templateIds.get(a.template);
      if (userId === null || mentorId === null || !tpl) continue;
      const startedOn = addDays(today, -a.startedDaysAgo);
      const r = db.run(
        'INSERT INTO onboarding_assignments (user_id, template_id, mentor_id, started_on, title, items_snapshot, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, tpl.id, mentorId, startedOn, tpl.title, JSON.stringify(tpl.items), by, now],
      );
      a.done.forEach((index, k) => {
        if (index >= tpl.items.length) return;
        const doneOn = addDays(startedOn, Math.min(a.startedDaysAgo, k * 3 + 1));
        db.run('INSERT INTO onboarding_progress (assignment_id, item_index, done_at, done_by) VALUES (?, ?, ?, ?)', [
          r.lastInsertRowid,
          index,
          `${doneOn}T08:00:00.000Z`,
          k % 2 === 0 ? userId : mentorId,
        ]);
      });
    }
  });
}
