// 이 파일이 하는 일: facility 모듈의 데모 데이터(database.md §11, TD-024). 가상 "하늘숲치과" 기준, 환자 정보 없음. 모양은 server/db/seed/types.ts의 ModuleSeed다.
// 법정 의무 일정(phase-03-task-08): 기본 템플릿(TD-022 22개)을 채우고 여러 항목에 최근 수행일·이력을 넣어 기한 지남·7일 안·30일 안·여유·최초 수행일 필요가 고루 보이게 한다.
// 장비별 방사선 정기검사 항목 두 개("파노라마 정기검사" 등)를 직접 추가한 항목으로 넣는다. 이미 수행 이력이 있으면 건너뛴다.
// 장비·멸균 기록(phase-04-task-03): 장비 6대와 점검·수리 이력, 멸균기 2대의 지난 30일(scale배) 기록(B&D 매일·사이클·BI 주 1회)을 넣고,
// 방사선 장비를 법정 정기검사 항목에 연결한다. 불합격 2건 중 1건은 조치까지, 1건은 조치 전(대시보드 경고 예시)이다. 장비가 이미 있으면 건너뛴다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { addDays, todayKst, weekday } from '../../lib/dates.ts';
import { ensureLegalTemplates, LEGAL_TEMPLATES } from '../../db/seed/legal-templates.ts';

/** 이 모듈이 소유한 업무 테이블. legal_tasks는 초기화 때 템플릿만 남기고(02-05 demo-service), 이력은 모두 비운다 */
export const tables: readonly string[] = ['legal_tasks', 'legal_task_logs', 'equipment', 'equipment_logs', 'sterilizer_logs'];

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

/** 법정 일정 데모와 장비·멸균 기록 데모를 차례로 넣는다 */
export function seedDemo(db: Db, ctx: SeedContext): void {
  seedLegalDemo(db, ctx);
  seedEquipmentDemo(db, ctx);
}

/** 법정 일정 데모: 템플릿 채우기 → 최근 수행일·이력 → 장비별 정기검사 항목 */
function seedLegalDemo(db: Db, ctx: SeedContext): void {
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

/** 데모 장비 한 대: 이름·종류·설치일·업체·점검 주기·점검 이력(날짜·내용)·수리 이력(날짜·내용·비용)·연결할 법정 일정 이름 */
interface DemoEquipment {
  name: string;
  kind: 'xray' | 'sterilizer' | 'unit_chair' | 'compressor' | 'suction' | 'other';
  installedOn: string;
  vendorName: string;
  cycleMonths: number | null;
  memo: string | null;
  inspections: ReadonlyArray<readonly [string, string]>;
  repairs: ReadonlyArray<readonly [string, string, number]>;
  legalTitle?: string;
}

/** 데모 장비 6대(기준일 2026-11-02에서 본 다음 점검 상태를 주석에 적었다) */
export const DEMO_EQUIPMENT: readonly DemoEquipment[] = [
  {
    name: '오토클레이브 1호기',
    kind: 'sterilizer',
    installedOn: '2022-03-15',
    vendorName: '한빛메디칼',
    cycleMonths: 6,
    memo: '진공형(B형), 소독실 왼쪽',
    inspections: [
      ['2025-11-10', '정기 점검: 도어 패킹 상태 양호, 안전밸브 작동 확인'],
      ['2026-05-10', '정기 점검: 챔버 청소, 필터 교체'],
    ], // 2026-11-10, D-8
    repairs: [['2026-02-03', '급수 펌프 소음 → 펌프 교체', 280000]],
  },
  {
    name: '오토클레이브 2호기',
    kind: 'sterilizer',
    installedOn: '2024-08-01',
    vendorName: '한빛메디칼',
    cycleMonths: 6,
    memo: '진공형(B형), 소독실 오른쪽',
    inspections: [['2026-08-20', '정기 점검: 이상 없음']], // 2027-02-20, 여유
    repairs: [],
  },
  {
    name: '파노라마 촬영장치',
    kind: 'xray',
    installedOn: '2020-11-23',
    vendorName: '바른영상',
    cycleMonths: 12,
    memo: '2층 촬영실',
    inspections: [['2025-10-28', '업체 정기 점검(화질·출력 확인)']], // 2026-10-28, 기한 지남 5일
    repairs: [],
    legalTitle: '파노라마 정기검사',
  },
  {
    name: '구내 촬영장치',
    kind: 'xray',
    installedOn: '2021-05-20',
    vendorName: '바른영상',
    cycleMonths: 12,
    memo: '진료실 1·3번 체어 옆, 2대',
    inspections: [['2026-05-20', '업체 정기 점검']], // 2027-05-20, 여유
    repairs: [],
    legalTitle: '구내 촬영장치 정기검사',
  },
  {
    name: '유닛체어 1~3번',
    kind: 'unit_chair',
    installedOn: '2019-04-01',
    vendorName: '하늘덴탈서비스',
    cycleMonths: 12,
    memo: '3대 함께 점검',
    inspections: [['2025-11-25', '핸드피스 라인·석션 호스·조명 점검']], // 2026-11-25, D-23
    repairs: [['2026-06-12', '2번 체어 무영등 교체', 150000]],
  },
  {
    name: '공기 압축기(컴프레서)',
    kind: 'compressor',
    installedOn: '2019-04-01',
    vendorName: '하늘덴탈서비스',
    cycleMonths: 3,
    memo: '지하 기계실, 매일 아침 물 빼기',
    inspections: [
      ['2026-06-01', '오일·필터 점검'],
      ['2026-09-01', '오일 교환, 드레인 밸브 점검'],
    ], // 2026-12-01, D-29
    repairs: [['2026-07-14', '압력 스위치 고장 → 교체', 380000]],
  },
];

/** 멸균 기록 데모 한 줄의 선택 값 */
interface DemoSterilizerOpts {
  temp?: number;
  kpa?: number;
  min?: number;
  result?: 'pass' | 'fail';
  action?: string | null;
}

/** 장비·멸균 기록 데모. 장비가 이미 있으면 건너뛴다 */
function seedEquipmentDemo(db: Db, ctx: SeedContext): void {
  if (db.get('SELECT 1 AS x FROM equipment LIMIT 1')) return;
  const { clock, scale } = ctx;
  const now = clock.now().toISOString();
  const today = todayKst(clock);
  const managerId = recorder(db);
  // 멸균 기록 담당자: 위생사·어시스턴트 직원을 돌아가며(없으면 기록한 사람)
  const staff = db.all<{ id: number }>("SELECT id FROM users WHERE role = 'staff' AND active = 1 AND job_type IN ('hygienist', 'assistant') ORDER BY id").map((r) => r.id);
  const pick = (i: number): number | null => (staff.length ? (staff[i % staff.length] ?? managerId) : managerId);

  db.tx(() => {
    const ids: number[] = [];
    for (const eq of DEMO_EQUIPMENT) {
      const r = db.run(
        'INSERT INTO equipment (name, kind, installed_on, vendor_name, inspect_cycle_months, memo, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
        [eq.name, eq.kind, eq.installedOn, eq.vendorName, eq.cycleMonths, eq.memo, now, now],
      );
      const id = r.lastInsertRowid;
      ids.push(id);
      for (const [date, content] of eq.inspections) {
        if (date > today) continue;
        db.run('INSERT INTO equipment_logs (equipment_id, date, kind, content, cost, vendor_name, file_id, user_id, created_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?)', [id, date, 'inspection', content, eq.vendorName, managerId, now]);
      }
      for (const [date, content, cost] of eq.repairs) {
        if (date > today) continue;
        db.run('INSERT INTO equipment_logs (equipment_id, date, kind, content, cost, vendor_name, file_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)', [id, date, 'repair', content, cost, eq.vendorName, managerId, now]);
      }
      if (eq.legalTitle) db.run('UPDATE legal_tasks SET equipment_id = ? WHERE title = ? AND template_key IS NULL', [id, eq.legalTitle]);
    }

    // 멸균 기록: 지난 30일(scale배), 일요일은 쉬는 날
    const sterilizers = DEMO_EQUIPMENT.map((e, i) => ({ e, id: ids[i] ?? 0 })).filter((x) => x.e.kind === 'sterilizer');
    const cycleNo = new Map<number, number>(sterilizers.map((s, i) => [s.id, 1000 * (i + 1)]));
    const add = (equipmentId: number, date: string, testType: 'bd' | 'bi' | 'ci' | 'cycle', userId: number | null, opts: DemoSterilizerOpts = {}) => {
      const n = (cycleNo.get(equipmentId) ?? 0) + 1;
      cycleNo.set(equipmentId, n);
      const action = opts.action ?? null;
      db.run(
        `INSERT INTO sterilizer_logs (equipment_id, date, test_type, cycle_no, temp_c, pressure_kpa, minutes, result, action_taken, action_at, action_user_id, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [equipmentId, date, testType, String(n), opts.temp ?? null, opts.kpa ?? null, opts.min ?? null, opts.result ?? 'pass', action, action ? now : null, action ? managerId : null, userId, now],
      );
    };
    const days = 30 * Math.max(1, scale);
    // 조치 전 불합격 예시는 오늘 바로 전 진료일(어제가 일요일이면 그제)
    const openFailDay = weekday(addDays(today, -1)) === 0 ? 2 : 1;
    let turn = 0;
    for (let d = days - 1; d >= 0; d -= 1) {
      const date = addDays(today, -d);
      const wd = weekday(date);
      if (wd === 0) continue;
      sterilizers.forEach((s, si) => {
        const who = pick(turn++);
        // 2호기 B&D: 바로 전 진료일 불합격(조치 전 → 대시보드 경고 예시)
        const bdFail = si === 1 && d === openFailDay;
        add(s.id, date, 'bd', who, { temp: 134, kpa: 216, min: 3.5, result: bdFail ? 'fail' : 'pass' });
        const cycles = wd === 6 ? 1 : si === 0 ? 3 : 2;
        for (let c = 0; c < cycles; c += 1) add(s.id, date, 'cycle', who, c % 2 ? { temp: 121, kpa: 110, min: 20 } : { temp: 134, kpa: 216, min: 4 });
        if (wd === 1) {
          // 1호기 BI: 10~16일 전 월요일 불합격(조치 완료)
          const biFail = si === 0 && d >= 10 && d <= 16;
          add(s.id, date, 'bi', who, { temp: 134, kpa: 216, min: 4, result: biFail ? 'fail' : 'pass', action: biFail ? '같은 날 멸균한 기구를 모두 다시 멸균하고, 업체 챔버 점검 뒤 BI 재검사 합격' : null });
        }
        if (wd === 3) add(s.id, date, 'ci', who);
      });
    }
  });
}
