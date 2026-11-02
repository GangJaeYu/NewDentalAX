// 이 파일이 하는 일: 첫 화면 E2E. Edge로 테스트 서버에 접속해 빌드된 첫 화면(제목·준비 중 안내)이 뜨는지,
// 화면 주소 새로고침(SPA 폴백)과 준비 상태 API가 동작하는지 확인한다(phase-01-task-01 AC2·AC5).
import { expect, test } from '@playwright/test';

test('phase-01-task-01 AC5: 첫 화면이 "하늘숲치과 원내 업무" 제목과 준비 중 안내를 보여 준다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle('하늘숲치과 원내 업무');
  await expect(page.getByRole('heading', { level: 1, name: '하늘숲치과 원내 업무' })).toBeVisible();
  await expect(page.getByText('서비스를 준비하고 있어요')).toBeVisible();
  expect(await page.locator('html').getAttribute('lang')).toBe('ko');
  expect(errors).toEqual([]);
});

test('phase-01-task-01 AC2: 화면 주소로 바로 들어가도(SPA 폴백) 첫 화면이 열린다', async ({ page }) => {
  const res = await page.goto('/inventory/items');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: '하늘숲치과 원내 업무' })).toBeVisible();
});

test('phase-01-task-01 AC2: GET /api/health가 ok:true와 고정 시각(TEST_NOW)을 돌려준다', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; db: string; version: string; now: string };
  expect(body).toMatchObject({ ok: true, db: 'ok' });
  expect(body.now).toBe('2026-11-02T00:00:00.000Z');
});
