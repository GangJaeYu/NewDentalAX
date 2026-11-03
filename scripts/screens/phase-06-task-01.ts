// 이 파일이 하는 일: phase-06-task-01(바코드 출고) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// ① 데모 바코드(니트릴 글러브 M, 2001000000029)를 스캐너처럼 쳐서 열린 출고 창 ② 없는 바코드 안내 ③ 바코드 칸이 있는 품목 수정 창을 찍는다.
// 찍기 전에 재고 데모 데이터(server/modules/inventory/seed.ts, 바코드 품목 포함)를 없을 때만 한 번 넣는다. 서버 데이터 폴더는 이번 실행의 .tmp/screens/run-* 중 가장 최근 것이다.
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

/** 재고 데모가 없으면 넣고 화면을 다시 그린다 */
async function withDemo(page: Page, waitText: string): Promise<void> {
  const db = openDb(appDbPath(currentDataDir()));
  try {
    if (!db.get('SELECT 1 AS x FROM items LIMIT 1')) seedDemo(db, { clock: fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00'), scale: 1 });
  } finally {
    db.close();
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(waitText).first().waitFor({ timeout: 10000 });
}

/** 바코드 입력란에 스캐너처럼 치고 Enter */
async function scan(page: Page, code: string): Promise<void> {
  await page.getByRole('textbox', { name: '바코드로 출고' }).click();
  await page.keyboard.type(code, { delay: 5 });
  await page.keyboard.press('Enter');
}

export const pages: ShotPage[] = [
  {
    name: 'inventory-barcode-out',
    url: '/inventory',
    state: 'user',
    ready: '재고 현황',
    action: async (page) => {
      await withDemo(page, '니트릴 글러브 M');
      await scan(page, '2001000000029');
      await page.getByRole('dialog', { name: '출고 기록' }).getByText('니트릴 글러브 M').waitFor();
    },
  },
  {
    name: 'inventory-barcode-notfound',
    url: '/inventory',
    state: 'user',
    ready: '재고 현황',
    action: async (page) => {
      await withDemo(page, '니트릴 글러브 M');
      await scan(page, '8800000000000');
      await page.getByTestId('barcode-notice').waitFor();
    },
  },
  {
    name: 'inventory-item-barcode-edit',
    url: '/inventory/items/2',
    state: 'user',
    ready: '재고·구매',
    action: async (page) => {
      await withDemo(page, '단가 기록');
      await page.getByRole('button', { name: '수정' }).click();
      await page.getByRole('dialog', { name: '품목 수정' }).getByLabel('바코드').waitFor();
    },
  },
];
