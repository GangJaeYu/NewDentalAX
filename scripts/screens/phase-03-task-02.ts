// 이 파일이 하는 일: phase-03-task-02(발주서) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// 발주서 목록·입고 완료 발주서(1번)·발주함 발주서(2번)·작성 중 발주서(편집 화면)·입고 처리 대화상자·발주서 인쇄 화면을 찍는다.
// 찍기 전에 재고 데모 데이터(server/modules/inventory/seed.ts — 발주서 데모 2건 포함)를 한 번만 넣고, 남은 부족 품목으로 작성 중 초안도 만든다.
// 서버 데이터 폴더는 screenshots.ts가 이번 실행에 만든 .tmp/screens/run-<시각> 중 가장 최근 것이다(phase-03-task-01 방식과 같음).
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { appDbPath, openDb } from '../../server/db/index.ts';
import { fixedClock } from '../../server/lib/clock.ts';
import { seedDemo } from '../../server/modules/inventory/seed.ts';
import { createDrafts } from '../../server/modules/inventory/orders.service.ts';
import type { ShotPage } from './types.ts';

/** 이번 스크린샷 실행의 서버 데이터 폴더(가장 최근 run-* 중 app.db가 있는 것) */
function currentDataDir(): string {
  const base = path.join(process.cwd(), '.tmp', 'screens');
  const runs = fs
    .readdirSync(base)
    .filter((n) => /^run-\d+$/.test(n) && fs.existsSync(appDbPath(path.join(base, n))))
    .sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
  if (!runs[0]) throw new Error('스크린샷 서버의 데이터 폴더(.tmp/screens/run-*)를 찾지 못했어요.');
  return path.join(base, runs[0]);
}

let seeded = false;
/** 작성 중 초안의 번호(넣은 뒤 정해진다) */
let draftId = 0;

/** 데모 데이터와 작성 중 초안을 처음 한 번만 넣는다 */
function ensureDemo(): void {
  if (seeded) return;
  const db = openDb(appDbPath(currentDataDir()));
  try {
    const clock = fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00');
    if (!db.get('SELECT 1 AS x FROM items LIMIT 1')) seedDemo(db, { clock, scale: 1 });
    const draft = db.get<{ id: number }>("SELECT id FROM purchase_orders WHERE status = 'draft' ORDER BY id LIMIT 1");
    draftId = draft?.id ?? createDrafts({ db, clock, user: null }).orders[0]?.id ?? 0;
  } finally {
    db.close();
  }
  seeded = true;
}

/** 데모를 넣고 주소로 다시 가서 waitText가 보일 때까지 기다린다 */
async function withOrdersDemo(page: Page, waitText: string, to?: () => string): Promise<void> {
  ensureDemo();
  if (to) await page.goto(new URL(to(), page.url()).toString(), { waitUntil: 'networkidle' });
  else await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(waitText).first().waitFor({ timeout: 10000 });
}

/** ready는 데이터가 없어도 보이는 글자이고, 실제 내용은 action에서 기다린다 */
export const pages: ShotPage[] = [
  {
    name: 'inventory-orders',
    url: '/inventory/orders',
    state: 'user',
    ready: '발주서',
    action: async (page) => {
      await withOrdersDemo(page, '미소치재');
      await page.getByRole('group', { name: '상태' }).getByRole('button', { name: '전체' }).click();
      await page.getByText('청정위생').first().waitFor();
    },
  },
  { name: 'inventory-order-received', url: '/inventory/orders/1', state: 'user', ready: '재고·구매', action: (page) => withOrdersDemo(page, '입고 수량') },
  { name: 'inventory-order-ordered', url: '/inventory/orders/2', state: 'user', ready: '재고·구매', action: (page) => withOrdersDemo(page, '거래처 정보') },
  {
    name: 'inventory-order-draft',
    url: '/inventory/orders',
    state: 'user',
    ready: '발주서',
    action: (page) => withOrdersDemo(page, '발주 품목 고치기', () => `/inventory/orders/${draftId}`),
  },
  {
    name: 'inventory-order-receive',
    url: '/inventory/orders/2',
    state: 'user',
    ready: '재고·구매',
    action: async (page) => {
      await withOrdersDemo(page, '거래처 정보');
      await page.getByRole('button', { name: '입고 처리' }).click();
      await page.getByRole('dialog', { name: '입고 처리' }).waitFor();
    },
  },
  { name: 'print-order', url: '/print/order/2', state: 'user', ready: '발주서 인쇄', action: (page) => withOrdersDemo(page, '아래와 같이 주문합니다.') },
];
