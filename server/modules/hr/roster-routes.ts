// 이 파일이 하는 일: 근무표·근무 유형 API(backend.md §3.7 roster, FR-081)를 등록한다. 처리 내용은 roster.ts에 있다.
// - GET /roster?from&to : 기간(최대 42일, 비우면 서버 기준 이번 주)의 직원 × 날짜 칸, 승인된 휴가 덧씌움, 날짜별 근무 인원(모든 역할 조회)
// - GET /roster/today?date= : 오늘 근무자(대시보드 "오늘 근무" 카드, 모든 역할)
// - PUT /roster/cell {userId, date, shiftTypeId|null} · POST /roster/copy-week {fromWeekStart, toWeekStart} : 실장 이상(주소별 권한 표 roster.edit가 먼저 막는다)
// - GET /shift-types(모든 역할) · PUT /shift-types {items}(실장 이상). 바꾼 내용은 감사 기록에 남긴다.
import type { FastifyInstance } from 'fastify';
import { audit } from '../../lib/audit.ts';
import { todayKst } from '../../lib/dates.ts';
import { assertCan, auditCtx } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { copyWeekSchema, rosterCellSchema, rosterQuerySchema, saveShiftTypesSchema, todayQuerySchema, weekRange } from '../../../shared/schemas/roster.ts';
import { copyWeek, listShiftTypes, readRoster, saveCell, saveShiftTypes, todayRoster } from './roster.ts';

/** 근무표·근무 유형 API를 등록한다 */
export function registerRosterRoutes(app: FastifyInstance): void {
  app.get('/roster', async (req) => {
    const q = parseInput(rosterQuerySchema, req.query);
    const today = todayKst(app.clock);
    const range = q.from && q.to ? { from: q.from, to: q.to } : weekRange(today);
    return { data: readRoster(app.db, range.from, range.to, today) };
  });

  app.get('/roster/today', async (req) => {
    const q = parseInput(todayQuerySchema, req.query);
    return { data: todayRoster(app.db, q.date ?? todayKst(app.clock)) };
  });

  app.put('/roster/cell', async (req) => {
    assertCan(req, 'roster.edit');
    const input = parseInput(rosterCellSchema, req.body);
    const result = saveCell(app.db, input);
    audit(auditCtx(req), 'roster.cell', 'roster', `${input.userId}:${input.date}`, { userId: input.userId, date: input.date, shiftTypeId: input.shiftTypeId });
    return { data: result };
  });

  app.post('/roster/copy-week', async (req) => {
    assertCan(req, 'roster.edit');
    const input = parseInput(copyWeekSchema, req.body);
    const result = copyWeek(app.db, input);
    audit(auditCtx(req), 'roster.copy_week', 'roster', input.toWeekStart, { from: input.fromWeekStart, to: input.toWeekStart, copied: result.copied, replaced: result.replaced });
    return { data: result };
  });

  app.get('/shift-types', async () => ({ data: listShiftTypes(app.db) }));

  app.put('/shift-types', async (req) => {
    assertCan(req, 'roster.edit');
    const input = parseInput(saveShiftTypesSchema, req.body);
    const saved = saveShiftTypes(app.db, input);
    audit(auditCtx(req), 'shift_types.update', 'shift_types', null, { count: input.items.length, active: input.items.filter((i) => i.active).length });
    return { data: saved };
  });
}
