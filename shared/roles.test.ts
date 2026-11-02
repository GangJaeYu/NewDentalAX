// 이 파일이 하는 일: shared/roles.ts의 권한 표(CAPS)가 PRD §2 권한 표준안 네 줄과 backend.md의 cap 이름을 그대로 담았는지 확인한다
// (phase-01-task-03 AC8의 표 부분, FR-003 AC1). 화면 경로 권한(PAGE_CAPS)도 frontend.md §3의 A·M 표기와 맞는지 본다.
import { describe, expect, test } from 'vitest';
import { atLeast, can, canSeePage, CAP_NAMES, CAPS, capsOf, isCap, isRole, PAGE_CAPS, PERMISSION_ROWS, ROLES, type Cap, type Role } from './roles.ts';

const yes = (roles: Role[], cap: Cap) => ROLES.filter((r) => can(r, cap)).sort().join(',') === [...roles].sort().join(',');

describe('권한 표(CAPS)', () => {
  test('phase-01-task-03 AC8: PRD §2 표의 네 줄이 순서대로 A·M·M·S다', () => {
    expect(PERMISSION_ROWS.map((r) => r.roles.join(','))).toEqual(['admin', 'admin,manager', 'admin,manager', 'admin,manager,staff']);
    expect(PERMISSION_ROWS[0]?.row).toContain('감사 로그');
    expect(PERMISSION_ROWS[1]?.row).toContain('연차 승인');
    expect(PERMISSION_ROWS[2]?.row).toContain('CSV 가져오기');
    expect(PERMISSION_ROWS[3]?.row).toContain('AI 기능 사용');
    // 모든 권한은 정확히 한 줄에 속한다
    const all = PERMISSION_ROWS.flatMap((r) => r.caps);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...CAP_NAMES].sort());
  });

  test('phase-01-task-03 AC8: PRD 표 ❌ 칸 — staff·manager는 관리자 기능을, staff는 실장 기능을 못 한다', () => {
    const adminOnly: Cap[] = ['users.manage', 'ai.settings', 'ai.usage', 'backup.manage', 'demo.manage', 'audit.view'];
    for (const c of adminOnly) expect(yes(['admin'], c), c).toBe(true);
    const managerUp: Cap[] = ['leave.approve', 'roster.edit', 'orders.manage', 'vendors.manage', 'expenses.manage', 'finance.monthly', 'notices.write', 'items.manage', 'items.import'];
    for (const c of managerUp) expect(yes(['admin', 'manager'], c), c).toBe(true);
    const everyone: Cap[] = ['app.view', 'inventory.move', 'checklist.check', 'facility.log', 'handover.write', 'leave.request'];
    for (const c of everyone) expect(yes(['admin', 'manager', 'staff'], c), c).toBe(true);
  });

  test('phase-01-task-03 AC8: backend.md의 cap 이름(ai.receipt·ai.assistant·ai.adcheck)과 AI 기능 14개가 모두 있다', () => {
    const features = ['quick', 'script', 'review_reply', 'template', 'doc_writer', 'doc_revise', 'minutes', 'adcheck', 'promo', 'hiring', 'onboarding', 'assistant', 'receipt', 'monthly_summary'];
    for (const f of features) expect(isCap(`ai.${f}`), f).toBe(true);
    expect(CAP_NAMES.filter((c) => c.startsWith('ai.') && c !== 'ai.settings' && c !== 'ai.usage')).toHaveLength(14);
    for (const f of features.filter((x) => x !== 'monthly_summary')) expect(yes(['admin', 'manager', 'staff'], `ai.${f}` as Cap)).toBe(true);
    expect(yes(['admin', 'manager'], 'ai.monthly_summary')).toBe(true);
  });

  test('phase-01-task-03 AC8: can·atLeast·capsOf·isRole이 표대로 동작하고, 로그인 안 함(null)은 아무것도 못 한다', () => {
    expect(can(null, 'app.view')).toBe(false);
    expect(can(undefined, 'app.view')).toBe(false);
    expect(atLeast('manager', 'manager')).toBe(true);
    expect(atLeast('staff', 'manager')).toBe(false);
    expect(atLeast('admin', 'manager')).toBe(true);
    expect(capsOf('admin')).toEqual(CAP_NAMES);
    expect(capsOf('staff').every((c) => CAPS[c].roles.includes('staff'))).toBe(true);
    expect(capsOf(null)).toEqual([]);
    expect(isRole('staff')).toBe(true);
    expect(isRole('owner')).toBe(false);
    expect(isCap('nope.nope')).toBe(false);
    expect(isCap('toString')).toBe(false);
    for (const c of CAP_NAMES) expect(CAPS[c].label, c).toMatch(/[가-힣]/);
  });

  test('phase-01-task-03 AC8: 화면 경로 권한(PAGE_CAPS)이 frontend.md §3의 A·M 표기와 맞다', () => {
    const adminPages = ['/admin/users', '/admin/clinic', '/admin/ai', '/admin/ai-usage', '/admin/backup', '/admin/audit', '/admin/reset'];
    const managerPages = ['/inventory/orders', '/inventory/orders/3', '/inventory/import', '/finance/expenses', '/finance/monthly'];
    for (const p of adminPages) {
      expect(canSeePage('admin', p), p).toBe(true);
      expect(canSeePage('manager', p), p).toBe(false);
      expect(canSeePage('staff', p), p).toBe(false);
    }
    for (const p of managerPages) {
      expect(canSeePage('manager', p), p).toBe(true);
      expect(canSeePage('staff', p), p).toBe(false);
    }
    for (const p of ['/', '/inventory', '/inventory/moves', '/desk/board', '/admin/ai-usagex', '/hr/leave?mine=1']) expect(canSeePage('staff', p), p).toBe(true);
    expect(canSeePage('admin', '/admin/ai-usage')).toBe(true);
    expect(canSeePage(null, '/')).toBe(false);
    expect(Object.values(PAGE_CAPS).every((c) => isCap(c))).toBe(true);
  });
});
