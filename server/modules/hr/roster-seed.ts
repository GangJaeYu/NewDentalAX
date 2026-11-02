// 이 파일이 하는 일: 근무표 데모 데이터(database.md §11 "근무표 4주", phase-04-task-01). hr 모듈 seed.ts의 seedDemo가 부른다. 가상 치과 "하늘숲치과" 기준이고 환자 정보는 없다.
// 기준일이 든 주의 2주 전부터 다음 주까지 4주(월~일)를 채운다. 평일은 대부분 "종일", 수요일 야간 진료는 치과위생사가 주마다 돌아가며 맡고,
// 토요일 오전 진료는 주마다 일부만 "오전"으로 나오고 나머지는 "휴무"다. 일요일처럼 병원이 쉬는 날은 비워 둔다.
// 직원은 admin 모듈 seed가 넣은 데모 직원이고, 없으면 그 사람은 건너뛴다. 근무표가 이미 있으면 넣지 않는다. scale=10이면 과거 주를 더 넣는다(성능 측정).
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { kstDate } from '../../lib/dates.ts';
import { readClinic } from '../admin/clinic.ts';
import { isClinicOpen } from '../../../shared/schemas/leave.ts';
import { shiftDate, weekStart } from '../../../shared/schemas/roster.ts';

type Code = 'full' | 'am' | 'pm' | 'night' | 'off';

/** 데모 직원별 평일(월~금) 기본 근무. 없는 요일은 'full' */
const WEEKDAY_PATTERN: Readonly<Record<string, Partial<Record<number, Code>>>> = {
  director: {},
  yoongaram: {},
  jeonghaneul: {},
  ohsodam: { 2: 'am' },
  limchaeun: {},
  seodaon: { 3: 'pm' },
  baenuri: { 4: 'am' },
  moonjian: {},
  joeunsol: { 0: 'pm', 2: 'pm', 4: 'pm', 1: 'am', 3: 'am' },
};

/** 수요일 야간 진료를 주마다 돌아가며 맡는 사람(치과위생사) */
const NIGHT_ROTATION = ['jeonghaneul', 'ohsodam', 'limchaeun'] as const;

/** 데모 근무표 주 수 */
export const DEMO_ROSTER_WEEKS = 4;

/** 데모 근무표 첫 주(기준일이 든 주의 2주 전 월요일) */
export function demoRosterStart(today: string): string {
  return shiftDate(weekStart(today), -14);
}

/** 데모 근무표 4주를 넣는다 */
export function seedRosterDemo(db: Db, ctx: SeedContext): void {
  if (db.get('SELECT 1 AS x FROM roster LIMIT 1')) return;
  const ids = new Map(db.all<{ id: number; code: string }>("SELECT id, code FROM shift_types WHERE active = 1").map((r) => [r.code, r.id]));
  const users = db.all<{ id: number; username: string }>('SELECT id, username FROM users WHERE active = 1');
  const byName = new Map(users.map((u) => [u.username, u.id]));
  const names = Object.keys(WEEKDAY_PATTERN).filter((n) => byName.has(n));
  if (names.length === 0) return;
  const hours = readClinic(db).hours;
  const today = kstDate(ctx.clock.now());
  const scale = Math.max(1, Math.floor(ctx.scale || 1));
  const weeks = DEMO_ROSTER_WEEKS * scale;
  const first = shiftDate(demoRosterStart(today), -7 * (weeks - DEMO_ROSTER_WEEKS));

  db.tx(() => {
    for (let w = 0; w < weeks; w += 1) {
      const monday = shiftDate(first, w * 7);
      for (let d = 0; d < 7; d += 1) {
        const date = shiftDate(monday, d);
        if (!isClinicOpen(date, hours)) continue;
        names.forEach((name, k) => {
          let code: Code;
          if (d < 5) {
            code = WEEKDAY_PATTERN[name]?.[d] ?? 'full';
            if (d === 2 && NIGHT_ROTATION[w % NIGHT_ROTATION.length] === name) code = 'night';
          } else {
            // 토요일 오전 진료: 원장과 직원 3명 정도가 주마다 돌아가며 나온다
            code = name === 'director' ? (w % 2 === 0 ? 'am' : 'off') : (k + w) % 3 === 0 ? 'am' : 'off';
          }
          const shiftId = ids.get(code);
          const userId = byName.get(name);
          if (shiftId === undefined || userId === undefined) return;
          db.run('INSERT OR IGNORE INTO roster (user_id, date, shift_type_id) VALUES (?, ?, ?)', [userId, date, shiftId]);
        });
      }
    }
  });
}
