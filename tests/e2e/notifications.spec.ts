// 이 파일이 하는 일: 알림 화면 E2E(phase-02-task-04 AC2·AC3·AC4, FR-090). 이 파일 전용 격리 서버(fixtures.ts의 isoServer)에서
// 상단바 종 배지가 새로고침 없이 60초 안에 바뀌는지(AC3: 브라우저 시계를 page.clock으로 빨리 돌려 실제 30초 폴링을 그대로 확인),
// 팝오버에서 알림을 누르면 링크 화면으로 이동하고 읽음 처리되어 배지가 줄어드는지(AC2), /notifications 화면의 거르기·모두 읽음,
// staff에게는 manager 전용 알림이 보이지 않는지(AC4), 팝오버·화면의 axe 위반 0건과 콘솔 오류 없음을 확인한다.
// 알림은 업무 모듈이 하듯 서버 DB에 notify.emit으로 만든다(아직 알림을 만드는 업무 API가 없음).
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { appDbPath, openDb, type Db } from '../../server/db/index.ts';
import { fixedClock } from '../../server/lib/clock.ts';
import { emitNotification, type NotificationInput } from '../../server/modules/notifications/emit.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'ntfadmin', password: 'Notif-Admin-Pass-7', withDemo: false };
const MANAGER = { username: 'ntfmanager', password: 'Notif-Manager-Pass-7', name: '박실장' };
const STAFF = { username: 'ntfstaff', password: 'Notif-Staff-Pass-7', name: '이수진' };
const TEST_NOW = '2026-11-02T09:00:00+09:00';

let dataDir = '';

/** 서버 DB에 알림을 만든다(모듈 service가 notify.emit을 부르는 것과 같음) */
function emit(input: NotificationInput): number {
  const db: Db = openDb(appDbPath(dataDir));
  try {
    return emitNotification(db, input, fixedClock(TEST_NOW));
  } finally {
    db.close();
  }
}

/** 콘솔 오류·스크립트 오류를 모은다(시험이 일부러 만든 4xx 응답 줄은 뺀다) */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** API로 로그인해 둔다(브라우저 묶음과 쿠키를 같이 씀) */
async function login(page: Page, who: { username: string; password: string }): Promise<void> {
  const r = await page.request.post('/api/auth/login', { data: { username: who.username, password: who.password } });
  expect(r.status()).toBe(200);
}

/** axe 위반 목록을 "규칙: 위치" 글줄로 */
async function axeViolations(page: Page, include?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe.serial('알림 종·팝오버·알림 화면', () => {
  test.beforeAll(async ({ request, isoServer }) => {
    dataDir = isoServer.dataDir;
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test('phase-02-task-04 AC3: 새 알림이 생기면 새로고침 없이 60초 안에 종 배지에 반영된다(실제 30초 폴링, 브라우저 시계 빨리 감기)', async ({ page }) => {
    const errors = watchErrors(page);
    await page.clock.install();
    await login(page, MANAGER);
    await page.goto('/');
    const bell = page.getByTestId('notification-bell');
    await expect(bell).toHaveAccessibleName('알림');
    await expect(page.getByTestId('notification-badge')).toHaveCount(0);

    emit({ type: 'stock_low', title: '거즈 재고가 부족해요', body: '현재 3개 · 적정 10개', link: '/inventory', dedupeKey: 'e2e:item:1' });
    emit({ type: 'notice', title: '11월 회식 안내', link: '/desk/board', dedupeKey: 'e2e:notice:1' });

    // 5초씩 브라우저 시간을 보내며 배지를 본다. 페이지를 새로 고치지 않는다
    let waitedMs = 0;
    while (waitedMs < 60_000) {
      await page.clock.runFor(5_000);
      waitedMs += 5_000;
      if ((await page.getByTestId('notification-badge').count()) > 0) break;
    }
    await expect(page.getByTestId('notification-badge')).toHaveText('2');
    expect(waitedMs).toBeLessThanOrEqual(30_000);
    await expect(bell).toHaveAccessibleName('읽지 않은 알림 2');
    expect(errors).toEqual([]);
  });

  test('phase-02-task-04 AC2: 종 팝오버에서 알림을 누르면 그 화면으로 이동하고 읽음 처리되어 배지 수가 줄어든다', async ({ page }) => {
    const errors = watchErrors(page);
    await login(page, MANAGER);
    await page.goto('/');
    const bell = page.getByTestId('notification-bell');
    await expect(page.getByTestId('notification-badge')).toHaveText('2');

    await bell.click();
    const pop = page.getByRole('dialog', { name: '알림' });
    await expect(pop).toBeVisible();
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    await expect(pop.getByRole('button', { name: /거즈 재고가 부족해요/ })).toBeVisible();
    await expect(pop.getByText('읽지 않음 2개')).toBeVisible();
    expect(await axeViolations(page, '.notif-pop')).toEqual([]);

    // Esc로 닫으면 종으로 포커스가 돌아온다
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await expect(bell).toBeFocused();

    await bell.click();
    await pop.getByRole('button', { name: /거즈 재고가 부족해요/ }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(pop).toBeHidden();
    await expect(page.getByTestId('notification-badge')).toHaveText('1');
    const s = await page.request.get('/api/notifications/summary');
    expect(((await s.json()) as { data: { unread: number } }).data.unread).toBe(1);

    // 새로 고쳐도 읽음 상태가 남는다
    await page.reload();
    await expect(page.getByTestId('notification-badge')).toHaveText('1');
    expect(errors).toEqual([]);
  });

  test('phase-02-task-04 AC2: /notifications 화면에서 거르기·누르면 이동·모두 읽음이 되고, 팝오버의 "전체 보기"로 들어온다', async ({ page }) => {
    const errors = watchErrors(page);
    await login(page, MANAGER);
    await page.goto('/');
    await page.getByTestId('notification-bell').click();
    await page.getByRole('link', { name: '알림 전체 보기' }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole('heading', { level: 1, name: '알림' })).toBeVisible();
    await expect(page.getByText('읽지 않은 알림 1개')).toBeVisible();
    const list = page.getByRole('article', { name: '알림 목록' });
    await expect(list.getByRole('button', { name: /11월 회식 안내/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /거즈 재고가 부족해요/ })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await list.getByRole('button', { name: '읽지 않음', exact: true }).click();
    await expect(list.getByRole('button', { name: /거즈 재고가 부족해요/ })).toHaveCount(0);
    await expect(list.getByRole('button', { name: /11월 회식 안내/ })).toBeVisible();

    await page.getByRole('button', { name: '모두 읽음' }).click();
    await expect(page.getByText('읽지 않은 알림 0개')).toBeVisible();
    await expect(page.getByTestId('notification-badge')).toHaveCount(0);
    await expect(list.getByText('읽지 않은 알림이 없어요')).toBeVisible();

    await list.getByRole('button', { name: '전체', exact: true }).click();
    await list.getByRole('button', { name: /11월 회식 안내/ }).click();
    await expect(page).toHaveURL(/\/desk\/board$/);
    expect(errors).toEqual([]);
  });

  test('phase-02-task-04 AC4: staff 화면에는 manager 전용 알림이 보이지 않고 전원 알림만 보인다', async ({ page }) => {
    const errors = watchErrors(page);
    emit({ type: 'order', title: '발주서 확인이 필요해요', link: '/inventory/orders', dedupeKey: 'e2e:order:1' });
    await login(page, STAFF);
    await page.goto('/notifications');
    const list = page.getByRole('article', { name: '알림 목록' });
    await expect(list.getByRole('button', { name: /11월 회식 안내/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /거즈 재고가 부족해요/ })).toHaveCount(0);
    await expect(list.getByRole('button', { name: /발주서 확인이 필요해요/ })).toHaveCount(0);
    await expect(page.getByTestId('notification-badge')).toHaveText('1');
    expect(errors).toEqual([]);
  });
});
