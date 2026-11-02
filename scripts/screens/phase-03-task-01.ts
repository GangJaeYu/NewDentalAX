// 이 파일이 하는 일: phase-03-task-01(재고) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// 재고 현황·품목 상세(품목 2 = 니트릴 글러브 M)·입출고 기록·거래처·단가 변동·출고 빠른 입력 대화상자를 찍는다.
// 찍기 전에 재고 데모 데이터(거래처 5곳·품목 약 80개·90일 기록, server/modules/inventory/seed.ts)를 한 번만 서버 DB에 넣고 화면을 다시 그린다.
// 서버 데이터 폴더는 screenshots.ts가 이번 실행에 만든 .tmp/screens/run-<시각> 중 가장 최근 것이다(이 파일에서 그 값을 직접 받을 수 없어서 폴더 이름으로 찾는다).
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { appDbPath, openDb } from '../../server/db/index.ts';
import { fixedClock } from '../../server/lib/clock.ts';
import { seedDemo } from '../../server/modules/inventory/seed.ts';
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

/** 재고 데모 데이터를 처음 한 번만 넣고, 화면을 다시 그려 waitText가 보일 때까지 기다린다 */
async function withInventoryDemo(page: Page, waitText: string): Promise<void> {
  if (!seeded) {
    const db = openDb(appDbPath(currentDataDir()));
    try {
      if (!db.get('SELECT 1 AS x FROM items LIMIT 1')) seedDemo(db, { clock: fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00'), scale: 1 });
    } finally {
      db.close();
    }
    seeded = true;
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(waitText).first().waitFor({ timeout: 10000 });
}

/** ready는 데이터가 없어도 보이는 글자(쪽 제목·메뉴 묶음 이름)이고, 실제 내용은 action에서 기다린다 */
export const pages: ShotPage[] = [
  { name: 'inventory', url: '/inventory', state: 'user', ready: '재고 현황', action: (page) => withInventoryDemo(page, '니트릴 글러브 M') },
  { name: 'inventory-item', url: '/inventory/items/2', state: 'user', ready: '재고·구매', action: (page) => withInventoryDemo(page, '단가 기록') },
  { name: 'inventory-moves', url: '/inventory/moves', state: 'user', ready: '입출고 기록', action: (page) => withInventoryDemo(page, '기록한 사람') },
  { name: 'inventory-vendors', url: '/inventory/vendors', state: 'user', ready: '거래처', action: (page) => withInventoryDemo(page, '한빛덴탈') },
  { name: 'inventory-prices', url: '/inventory/prices', state: 'user', ready: '단가 변동', action: (page) => withInventoryDemo(page, '직전 단가') },
  {
    name: 'inventory-quick-out',
    url: '/inventory',
    state: 'user',
    ready: '재고 현황',
    action: async (page) => {
      await withInventoryDemo(page, '니트릴 글러브 M');
      await page.getByRole('button', { name: '출고 기록' }).click();
      await page.getByRole('dialog', { name: '출고 기록' }).getByRole('list', { name: '찾은 품목' }).getByRole('button').first().waitFor();
    },
  },
];
