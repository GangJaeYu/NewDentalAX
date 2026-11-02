// 이 파일이 하는 일: 오픈·마감 체크리스트 API(backend.md §3.4, FR-041)와 그 처리 함수를 둔다.
// - GET /checklists/:kind?date= : 그 날짜(기본 오늘, 한국 날짜)의 항목과 체크 상태(누가·언제). 오늘이 아니면 readOnly=true로 조회만 된다.
// - PUT /checklists/:kind/items : manager 이상이 항목 전체를 순서대로 저장한다(추가·순서 변경·담당 직무). 빠진 항목은 지우지 않고 사용 중지(active=0)로 두어 지난 기록을 지킨다.
// - POST /checklists/check : { itemId, checked } 오늘 날짜만 체크·해제한다. 해제하면 그 줄을 지운다(database.md §2).
// "오늘"은 늘 주입된 시계(app.clock)로 정하므로, 시계가 다음 날로 넘어가면 새로 시작한다(AC2). 권한 표: PUT 항목은 checklist.edit(api-permissions.ts).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { audit } from '../../lib/audit.ts';
import { isValidDate, todayKst } from '../../lib/dates.ts';
import { AppError } from '../../lib/errors.ts';
import { assertCan, auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { JOB_TYPES, type JobType } from '../../../shared/enums.ts';
import { CHECKLIST_KINDS, type ChecklistDay, type ChecklistItemState, type ChecklistKind } from '../../../shared/schemas/desk.ts';

const kindParams = z.object({ kind: z.enum(CHECKLIST_KINDS, { error: '체크리스트 종류는 오픈 또는 마감으로 골라 주세요.' }) });

const dayQuery = z.object({
  date: z
    .string({ error: '날짜를 확인해 주세요.' })
    .refine((v) => isValidDate(v), { error: '날짜는 2026-11-02처럼 적어 주세요.' })
    .optional(),
});

/** 항목 전체 저장 입력: 화면에 보이는 순서대로 */
export const saveItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number({ error: '항목 번호를 확인해 주세요.' }).int({ error: '항목 번호를 확인해 주세요.' }).positive({ error: '항목 번호를 확인해 주세요.' }).optional(),
        text: z
          .string({ error: '항목 내용을 적어 주세요.' })
          .trim()
          .min(1, { error: '항목 내용을 적어 주세요.' })
          .max(100, { error: '항목 내용은 100자까지 적을 수 있어요.' }),
        roleHint: z.enum(JOB_TYPES, { error: '담당 직무를 목록에서 골라 주세요.' }).nullable().optional(),
      }),
      { error: '항목 목록을 확인해 주세요.' },
    )
    .max(100, { error: '항목은 100개까지 둘 수 있어요.' }),
});

export const checkSchema = z.object({
  itemId: z.number({ error: '항목 번호를 확인해 주세요.' }).int({ error: '항목 번호를 확인해 주세요.' }).positive({ error: '항목 번호를 확인해 주세요.' }),
  checked: z.boolean({ error: '체크 여부를 확인해 주세요.' }),
});

interface ItemRow {
  id: number;
  text: string;
  role_hint: JobType | null;
  sort: number;
  active: number;
  checked_by: number | null;
  checked_name: string | null;
  checked_at: string | null;
}

/**
 * 한 날짜의 체크리스트를 읽는다. 지금 쓰는 항목과, 그날 체크 기록이 있는 지난 항목(사용 중지된 것)을 함께 보여 준다.
 * 앞으로의 날짜는 볼 수 없다(400).
 */
export function getChecklistDay(db: Db, clock: Clock, kind: ChecklistKind, date?: string): ChecklistDay {
  const today = todayKst(clock);
  const day = date ?? today;
  if (day > today) throw new AppError('VALIDATION', { message: '앞으로의 날짜는 볼 수 없어요.', fields: { date: '오늘이나 지난 날짜를 골라 주세요.' } });
  const rows = db.all<ItemRow>(
    `SELECT i.id, i.text, i.role_hint, i.sort, i.active, c.checked_by, u.name AS checked_name, c.checked_at
     FROM checklist_items i
     LEFT JOIN checklist_checks c ON c.item_id = i.id AND c.date = :day
     LEFT JOIN users u ON u.id = c.checked_by
     WHERE i.kind = :kind AND (i.active = 1 OR c.item_id IS NOT NULL)
     ORDER BY i.sort, i.id`,
    { day, kind },
  );
  const items: ChecklistItemState[] = rows.map((r) => ({
    id: r.id,
    text: r.text,
    roleHint: r.role_hint,
    sort: r.sort,
    active: r.active === 1,
    checked: r.checked_at !== null,
    checkedBy: r.checked_by === null ? null : { id: r.checked_by, name: r.checked_name ?? '알 수 없음' },
    checkedAt: r.checked_at,
  }));
  return { kind, date: day, today, readOnly: day !== today, done: items.filter((i) => i.checked).length, total: items.length, items };
}

/**
 * 항목 전체를 순서대로 저장한다(FR-041 AC1). 목록 순서가 곧 sort다.
 * id가 있으면 그 항목을 고치고(같은 종류여야 함), 없으면 새로 만든다. 목록에서 빠진 항목은 사용 중지한다.
 * 바뀐 내용 요약(더한 수·고친 수·뺀 수)을 돌려준다.
 */
export function saveChecklistItems(db: Db, kind: ChecklistKind, input: z.output<typeof saveItemsSchema>): { added: number; updated: number; removed: number } {
  const existing = new Map(db.all<{ id: number }>('SELECT id FROM checklist_items WHERE kind = ? AND active = 1', [kind]).map((r) => [r.id, r]));
  const seen = new Set<number>();
  input.items.forEach((it, i) => {
    if (it.id === undefined) return;
    if (!existing.has(it.id)) throw new AppError('VALIDATION', { message: '목록에 없는 항목이 있어요. 화면을 새로 고친 뒤 다시 저장해 주세요.', fields: { [`items.${i}.id`]: '이 항목을 찾을 수 없어요.' } });
    if (seen.has(it.id)) throw new AppError('VALIDATION', { fields: { [`items.${i}.id`]: '같은 항목이 두 번 들어 있어요.' } });
    seen.add(it.id);
  });
  return db.tx(() => {
    let added = 0;
    let updated = 0;
    input.items.forEach((it, sort) => {
      const roleHint = it.roleHint ?? null;
      if (it.id === undefined) {
        db.run('INSERT INTO checklist_items (kind, text, role_hint, sort, active) VALUES (?, ?, ?, ?, 1)', [kind, it.text, roleHint, sort]);
        added += 1;
      } else {
        db.run('UPDATE checklist_items SET text = ?, role_hint = ?, sort = ? WHERE id = ?', [it.text, roleHint, sort, it.id]);
        updated += 1;
      }
    });
    let removed = 0;
    for (const id of existing.keys()) {
      if (seen.has(id)) continue;
      db.run('UPDATE checklist_items SET active = 0 WHERE id = ?', [id]);
      removed += 1;
    }
    return { added, updated, removed };
  });
}

/**
 * 오늘 날짜의 항목을 체크하거나 푼다(FR-041 AC2). 지난 날짜는 바꿀 수 없다.
 * 이미 다른 사람이 체크했으면 처음 체크한 사람·시각을 그대로 둔다. 바뀐 그 항목의 종류를 돌려준다.
 */
export function setCheck(db: Db, clock: Clock, userId: number, input: z.output<typeof checkSchema>): { kind: ChecklistKind; date: string } {
  const item = db.get<{ id: number; kind: ChecklistKind; active: number }>('SELECT id, kind, active FROM checklist_items WHERE id = ?', [input.itemId]);
  if (!item || item.active !== 1) throw new AppError('NOT_FOUND', { message: '찾는 체크 항목이 없어요. 화면을 새로 고쳐 주세요.' });
  const date = todayKst(clock);
  if (input.checked) {
    db.run('INSERT OR IGNORE INTO checklist_checks (item_id, date, checked_by, checked_at) VALUES (?, ?, ?, ?)', [item.id, date, userId, clock.now().toISOString()]);
  } else {
    db.run('DELETE FROM checklist_checks WHERE item_id = ? AND date = ?', [item.id, date]);
  }
  return { kind: item.kind, date };
}

/** 체크리스트 API를 등록한다(routes.ts가 부른다) */
export function registerChecklistRoutes(app: FastifyInstance): void {
  app.get('/checklists/:kind', async (req, reply) => {
    const { kind } = parseInput(kindParams, req.params);
    const { date } = parseInput(dayQuery, req.query);
    reply.header('cache-control', 'no-store');
    return { data: getChecklistDay(app.db, app.clock, kind, date) };
  });

  app.put('/checklists/:kind/items', async (req) => {
    assertCan(req, 'checklist.edit');
    const { kind } = parseInput(kindParams, req.params);
    const input = parseInput(saveItemsSchema, req.body);
    const summary = saveChecklistItems(app.db, kind, input);
    audit(auditCtx(req), 'checklist.items_save', 'checklist', kind, { count: input.items.length, ...summary });
    return { data: getChecklistDay(app.db, app.clock, kind) };
  });

  app.post('/checklists/check', async (req) => {
    assertCan(req, 'checklist.check');
    const input = parseInput(checkSchema, req.body);
    const { kind } = setCheck(app.db, app.clock, currentUser(req).id, input);
    return { data: getChecklistDay(app.db, app.clock, kind) };
  });
}
