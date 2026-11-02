// 이 파일이 하는 일: facility 모듈의 데모 데이터(database.md §11, TD-024). 지금은 법정 의무 일정 부분(phase-03-task-08)을 넣는다. 가상 "하늘숲치과" 기준, 환자 정보 없음.
// 기본 템플릿(TD-022 22개)을 먼저 채우고, 그중 여러 항목에 최근 수행일과 수행 이력을 넣어 기한 지남·7일 안·30일 안·여유 있음·최초 수행일 필요가 고루 보이게 한다.
// 장비별 방사선 정기검사 항목 두 개("파노라마 정기검사" 등)를 직접 추가한 항목으로 넣는다. 이미 수행 이력이 있으면 건너뛴다.
// 장비·멸균 기록 데모는 phase-04-task-03이 이 파일에 더한다. 모양은 server/db/seed/types.ts의 ModuleSeed다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { addDays, todayKst } from '../../lib/dates.ts';
import { ensureLegalTemplates, LEGAL_TEMPLATES } from '../../db/seed/legal-templates.ts';

/** 이 모듈이 소유한 업무 테이블. legal_tasks는 초기화 때 템플릿만 남기고(02-05 demo-service), 이력은 모두 비운다 */
export const tables: readonly string[] = ['legal_tasks', 'legal_task_logs'];

/** 템플릿별 데모 최근 수행일(기준일 2026-11-02에서 본 상태를 주석에 적었다) */
export const DEMO_LEGAL_DONE: Readonly<Record<string, string>> = {
  'radiation-manager-edu': '2024-09-02', // 2027-09-02, 여유
  'radiation-dosimetry': '2026-08-10', // 2026-11-10, D-8
  'radiation-health-check': '2025-02-10', // 2027-02-10, 여유
  'radiation-self-edu': '2025-11-20', // 2026-11-20, D-18
  'waste-edu': '2024-03-15', // 2027-03-15, 여유
  'waste-storage-disinfect': '2026-10-28', // 2026-11-04, D-2
  'fire-operation-check': '2025-12-05', // 2026-12-05, D-33
  'fire-drill': '2026-05-20',
  'privacy-edu': '2025-10-15', // 2026-10-15, 기한 지남
  'infection-edu': '2025-11-13', // 2026-11-13, D-11
  'harassment-edu': '2026-03-05',
  'disability-awareness-edu': '2026-04-10',
  'worker-health-check': '2026-06-15',
  'nonpay-report': '2026-03-30',
};

/** 장비별 방사선 정기검사(직접 추가한 항목, 템플릿 radiation-inspection을 복사) */
export const DEMO_EQUIPMENT_INSPECTIONS: ReadonlyArray<{ title: string; lastDoneOn: string; note: string }> = [
  { title: '파노라마 정기검사', lastDoneOn: '2023-11-23', note: '2층 촬영실 파노라마 1대' }, // 2026-11-23, D-21
  { title: '구내 촬영장치 정기검사', lastDoneOn: '2024-05-20', note: '진료실 구내 촬영장치 2대' }, // 2027-05-20
];

/** 기록한 사람: 데모 실장 → 아무 manager → 첫 관리자 */
function recorder(db: Db): number | null {
  return (
    db.get<{ id: number }>("SELECT id FROM users WHERE username = 'yoongaram'")?.id ??
    db.get<{ id: number }>("SELECT id FROM users WHERE role = 'manager' AND active = 1 ORDER BY id LIMIT 1")?.id ??
    db.get<{ id: number }>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")?.id ??
    null
  );
}

/** 법정 일정 데모: 템플릿 채우기 → 최근 수행일·이력 → 장비별 정기검사 항목 */
export function seedDemo(db: Db, ctx: SeedContext): void {
  const { clock, scale } = ctx;
  ensureLegalTemplates(db, clock);
  if (db.get('SELECT 1 AS x FROM legal_task_logs LIMIT 1')) return;
  const now = clock.now().toISOString();
  const userId = recorder(db);
  const today = todayKst(clock);
  const addLog = (taskId: number, doneOn: string, note: string | null) =>
    db.run('INSERT INTO legal_task_logs (legal_task_id, done_on, note, file_id, user_id, created_at) VALUES (?, ?, ?, NULL, ?, ?)', [taskId, doneOn, note, userId, now]);

  db.tx(() => {
    for (const [key, doneOn] of Object.entries(DEMO_LEGAL_DONE)) {
      if (doneOn > today) continue;
      const row = db.get<{ id: number }>('SELECT id FROM legal_tasks WHERE template_key = ?', [key]);
      if (!row) continue;
      db.run('UPDATE legal_tasks SET last_done_on = ?, updated_at = ? WHERE id = ?', [doneOn, now, row.id]);
      if (key === 'waste-storage-disinfect') {
        // 주 1회 소독: 지난 12주(scale배) 이력
        for (let w = 12 * Math.max(1, scale) - 1; w >= 0; w -= 1) addLog(row.id, addDays(doneOn, -7 * w), w === 0 ? '보관함 안팎 소독' : null);
      } else {
        addLog(row.id, doneOn, null);
      }
    }
    const tpl = LEGAL_TEMPLATES.find((t) => t.key === 'radiation-inspection');
    if (!tpl) return;
    for (const eq of DEMO_EQUIPMENT_INSPECTIONS) {
      const r = db.run(
        `INSERT INTO legal_tasks (template_key, title, category, cycle_months, cycle_days, cycle_text, basis, source_url, verify_status, applicability, applies_text, guidance, enabled, last_done_on, note, checked_on, created_at, updated_at)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [eq.title, tpl.category, tpl.cycleMonths, tpl.cycleDays, tpl.cycleText, tpl.basis, tpl.sourceUrl, tpl.verifyStatus, tpl.applicability, tpl.appliesText, null, eq.lastDoneOn, eq.note, '2026-11-02', now, now],
      );
      addLog(r.lastInsertRowid, eq.lastDoneOn, '검사기관 정기검사 합격');
    }
  });
}
