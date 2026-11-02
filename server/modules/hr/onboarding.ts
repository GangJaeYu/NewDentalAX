// 이 파일이 하는 일: 신규 직원 온보딩(FR-083)의 처리 함수. 직무별 체크리스트 템플릿 만들기·고치기, 신규 직원에게 배정(멘토 지정, 항목 복사),
// 항목 체크·해제와 진행률 계산을 맡는다. 진행률 = 끝낸 항목 ÷ 전체 항목(shared/schemas/onboarding.ts의 progressPercent).
// 권한: 템플릿·배정은 onboarding.manage(실장 이상). 체크는 배정받은 본인 또는 담당 멘토만. 배정 목록은 실장 이상은 전부, 그 밖에는 본인·멘토인 것만 본다.
// 배정할 때 템플릿의 제목·항목을 복사해 두므로(items_snapshot), 나중에 템플릿을 고쳐도 진행 중인 배정은 바뀌지 않는다.
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { isValidDate, todayKst } from '../../lib/dates.ts';
import { AppError } from '../../lib/errors.ts';
import { can, type Role } from '../../../shared/roles.ts';
import type { z } from 'zod';
import type { JobType } from '../../../shared/enums.ts';
import {
  progressPercent,
  type createAssignmentSchema,
  type createTemplateSchema,
  type OnboardingAssignment,
  type OnboardingTemplate,
  type updateTemplateSchema,
} from '../../../shared/schemas/onboarding.ts';

/** 요청한 사람 */
export interface OnboardingActor {
  id: number;
  role: Role;
}

interface TemplateRow {
  id: number;
  job_type: JobType;
  title: string;
  items: string;
  source: 'ai' | 'manual';
  active: number;
  assigned: number;
  created_at: string;
  updated_at: string;
}

/** JSON 문자열 배열을 안전하게 읽는다(깨졌으면 빈 배열) */
export function parseItems(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const TEMPLATE_SELECT = `SELECT t.*, (SELECT COUNT(*) FROM onboarding_assignments a WHERE a.template_id = t.id) AS assigned FROM onboarding_templates t`;

function toTemplate(r: TemplateRow): OnboardingTemplate {
  return {
    id: r.id,
    jobType: r.job_type,
    title: r.title,
    items: parseItems(r.items),
    source: r.source,
    active: r.active === 1,
    assignedCount: r.assigned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 템플릿 하나(없으면 404) */
export function getTemplate(db: Db, id: number): OnboardingTemplate {
  const row = db.get<TemplateRow>(`${TEMPLATE_SELECT} WHERE t.id = ?`, [id]);
  if (!row) throw new AppError('NOT_FOUND', { message: '찾는 온보딩 템플릿이 없어요.' });
  return toTemplate(row);
}

/** GET /onboarding/templates: 템플릿 목록(사용 중 먼저, 직무·이름 순). 실장 이상만 */
export function listTemplates(db: Db, opts: { jobType?: JobType } = {}): OnboardingTemplate[] {
  const rows = db.all<TemplateRow>(`${TEMPLATE_SELECT} ${opts.jobType ? 'WHERE t.job_type = ?' : ''} ORDER BY t.active DESC, t.job_type, t.title, t.id`, opts.jobType ? [opts.jobType] : []);
  return rows.map(toTemplate);
}

/** POST /onboarding/templates: 템플릿 만들기(AI 초안을 저장할 때는 source='ai') */
export function createTemplate(db: Db, clock: Clock, actor: OnboardingActor, input: z.output<typeof createTemplateSchema>): OnboardingTemplate {
  const now = clock.now().toISOString();
  const r = db.run('INSERT INTO onboarding_templates (job_type, title, items, source, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)', [
    input.jobType,
    input.title,
    JSON.stringify(input.items),
    input.source,
    actor.id,
    now,
    now,
  ]);
  return getTemplate(db, r.lastInsertRowid);
}

/** PATCH /onboarding/templates/:id: 보낸 칸만 바꾼다. 이미 배정된 체크리스트는 그대로 둔다 */
export function updateTemplate(db: Db, clock: Clock, id: number, input: z.output<typeof updateTemplateSchema>): OnboardingTemplate {
  const cur = getTemplate(db, id);
  db.run('UPDATE onboarding_templates SET job_type = ?, title = ?, items = ?, active = ?, updated_at = ? WHERE id = ?', [
    input.jobType ?? cur.jobType,
    input.title ?? cur.title,
    JSON.stringify(input.items ?? cur.items),
    (input.active ?? cur.active) ? 1 : 0,
    clock.now().toISOString(),
    id,
  ]);
  return getTemplate(db, id);
}

interface AssignmentRow {
  id: number;
  title: string;
  template_id: number | null;
  user_id: number;
  user_name: string;
  user_job: JobType;
  mentor_id: number;
  mentor_name: string;
  started_on: string;
  items_snapshot: string;
  created_at: string;
}

const ASSIGNMENT_SELECT = `SELECT a.id, a.title, a.template_id, a.user_id, u.name AS user_name, u.job_type AS user_job, a.mentor_id, m.name AS mentor_name,
    a.started_on, a.items_snapshot, a.created_at
  FROM onboarding_assignments a
  JOIN users u ON u.id = a.user_id
  JOIN users m ON m.id = a.mentor_id`;

/** 배정 줄 + 체크 기록 → 화면 모양(보는 사람 기준 관계·체크 가능 여부 포함) */
function toAssignment(db: Db, r: AssignmentRow, actor: OnboardingActor): OnboardingAssignment {
  const items = parseItems(r.items_snapshot);
  const progress = db.all<{ item_index: number; done_at: string; done_by: number | null; by_name: string | null }>(
    `SELECT p.item_index, p.done_at, p.done_by, u.name AS by_name FROM onboarding_progress p LEFT JOIN users u ON u.id = p.done_by WHERE p.assignment_id = ?`,
    [r.id],
  );
  const byIndex = new Map(progress.map((p) => [p.item_index, p]));
  const states = items.map((text, index) => {
    const p = byIndex.get(index);
    return { index, text, doneAt: p?.done_at ?? null, doneBy: p && p.done_by && p.by_name ? { id: p.done_by, name: p.by_name } : null };
  });
  const done = states.filter((s) => s.doneAt).length;
  const relation = r.user_id === actor.id ? 'self' : r.mentor_id === actor.id ? 'mentor' : 'viewer';
  return {
    id: r.id,
    title: r.title,
    templateId: r.template_id,
    user: { id: r.user_id, name: r.user_name, jobType: r.user_job },
    mentor: { id: r.mentor_id, name: r.mentor_name },
    startedOn: r.started_on,
    items: states,
    done,
    total: items.length,
    percent: progressPercent(done, items.length),
    relation,
    canCheck: relation !== 'viewer',
    createdAt: r.created_at,
  };
}

/** 배정 줄 하나(없으면 404) */
function assignmentRow(db: Db, id: number): AssignmentRow {
  const row = db.get<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE a.id = ?`, [id]);
  if (!row) throw new AppError('NOT_FOUND', { message: '찾는 온보딩 배정이 없어요.' });
  return row;
}

/** 배정 하나를 본다. 실장 이상이 아니면 본인·멘토인 것만(아니면 404로 숨긴다) */
export function getAssignment(db: Db, actor: OnboardingActor, id: number): OnboardingAssignment {
  const row = assignmentRow(db, id);
  if (!can(actor.role, 'onboarding.manage') && row.user_id !== actor.id && row.mentor_id !== actor.id) {
    throw new AppError('NOT_FOUND', { message: '찾는 온보딩 배정이 없어요.' });
  }
  return toAssignment(db, row, actor);
}

/** GET /onboarding/assignments: 실장 이상은 전부, 그 밖에는 본인이 받았거나 멘토인 배정만(최근 시작 먼저) */
export function listAssignments(db: Db, actor: OnboardingActor): OnboardingAssignment[] {
  const all = can(actor.role, 'onboarding.manage');
  const rows = db.all<AssignmentRow>(
    `${ASSIGNMENT_SELECT} ${all ? '' : 'WHERE a.user_id = ? OR a.mentor_id = ?'} ORDER BY a.started_on DESC, a.id DESC`,
    all ? [] : [actor.id, actor.id],
  );
  return rows.map((r) => toAssignment(db, r, actor));
}

/** 사용 중인 직원인지 확인한다(아니면 400, 칸 이름과 함께) */
function activeUser(db: Db, id: number, field: string, label: string): { id: number; name: string } {
  const u = db.get<{ id: number; name: string }>('SELECT id, name FROM users WHERE id = ? AND active = 1', [id]);
  if (!u) throw new AppError('VALIDATION', { message: `${label}을(를) 찾지 못했어요. 다시 골라 주세요.`, fields: { [field]: `${label}을(를) 다시 골라 주세요.` } });
  return u;
}

/** POST /onboarding/assignments: 신규 직원에게 템플릿을 배정한다(실장 이상). 같은 템플릿을 같은 직원에게 두 번 배정하지 않는다 */
export function createAssignment(db: Db, clock: Clock, actor: OnboardingActor, input: z.output<typeof createAssignmentSchema>): OnboardingAssignment {
  activeUser(db, input.userId, 'userId', '신규 직원');
  activeUser(db, input.mentorId, 'mentorId', '담당 멘토');
  const tpl = getTemplate(db, input.templateId);
  if (!tpl.active) throw new AppError('VALIDATION', { message: '사용하지 않는 템플릿이에요. 다른 템플릿을 골라 주세요.', fields: { templateId: '다른 템플릿을 골라 주세요.' } });
  if (tpl.items.length === 0) throw new AppError('VALIDATION', { message: '항목이 없는 템플릿이에요. 항목을 넣은 뒤 배정해 주세요.', fields: { templateId: '항목이 없어요.' } });
  const startedOn = input.startedOn ?? todayKst(clock);
  if (!isValidDate(startedOn)) throw new AppError('VALIDATION', { message: '시작일이 달력에 없는 날이에요.', fields: { startedOn: '날짜를 다시 골라 주세요.' } });
  if (db.get('SELECT 1 AS x FROM onboarding_assignments WHERE user_id = ? AND template_id = ?', [input.userId, input.templateId])) {
    throw new AppError('CONFLICT', { message: '이 직원에게 이미 같은 템플릿을 배정했어요.', fields: { templateId: '이미 배정한 템플릿이에요.' } });
  }
  const r = db.run(
    'INSERT INTO onboarding_assignments (user_id, template_id, mentor_id, started_on, title, items_snapshot, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [input.userId, tpl.id, input.mentorId, startedOn, tpl.title, JSON.stringify(tpl.items), actor.id, clock.now().toISOString()],
  );
  return toAssignment(db, assignmentRow(db, r.lastInsertRowid), actor);
}

/** DELETE /onboarding/assignments/:id: 잘못 만든 배정 지우기(실장 이상). 체크 기록도 함께 지워진다 */
export function deleteAssignment(db: Db, actor: OnboardingActor, id: number): OnboardingAssignment {
  const cur = toAssignment(db, assignmentRow(db, id), actor);
  db.run('DELETE FROM onboarding_assignments WHERE id = ?', [id]);
  return cur;
}

/**
 * POST /onboarding/assignments/:id/items/:idx {done}: 항목 체크·해제. 배정받은 본인 또는 담당 멘토만 할 수 있다.
 * 체크하면 누가 언제 했는지 남기고, 해제하면 그 줄을 지운다. 바뀐 배정(진행률 포함)을 돌려준다.
 */
export function checkItem(db: Db, clock: Clock, actor: OnboardingActor, id: number, index: number, done: boolean): OnboardingAssignment {
  const row = assignmentRow(db, id);
  if (row.user_id !== actor.id && row.mentor_id !== actor.id) {
    throw new AppError('FORBIDDEN', { message: '배정받은 본인이나 담당 멘토만 체크할 수 있어요.' });
  }
  const items = parseItems(row.items_snapshot);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new AppError('NOT_FOUND', { message: '찾는 체크리스트 항목이 없어요.' });
  }
  if (done) {
    db.run('INSERT OR IGNORE INTO onboarding_progress (assignment_id, item_index, done_at, done_by) VALUES (?, ?, ?, ?)', [id, index, clock.now().toISOString(), actor.id]);
  } else {
    db.run('DELETE FROM onboarding_progress WHERE assignment_id = ? AND item_index = ?', [id, index]);
  }
  return toAssignment(db, assignmentRow(db, id), actor);
}
