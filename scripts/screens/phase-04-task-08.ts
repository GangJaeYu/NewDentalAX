// 이 파일이 하는 일: phase-04-task-08(명세서 사진으로 입고) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// ① 사진을 고르고 확인 체크까지 한 올리기 화면 ② 데모 공급자가 읽은 결과(품목 후보·입력 칸·합계·지출 옵션)를 찍는다.
// 찍기 전에 재고 데모(server/modules/inventory/seed.ts, 품목 후보 연결용)를 없을 때만 한 번 넣는다. 서버 데이터 폴더는 이번 실행의 .tmp/screens/run-* 중 가장 최근 것이다.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { appDbPath, openDb } from '../../server/db/index.ts';
import { fixedClock } from '../../server/lib/clock.ts';
import { seedDemo as seedInventoryDemo } from '../../server/modules/inventory/seed.ts';
import type { ShotPage } from './types.ts';

const PHOTO = path.join(process.cwd(), 'tests', 'fixtures', 'receipt', 'statement-4000x3000.jpg');

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

/** 재고 데모가 없으면 넣는다 */
function ensureDemo(): void {
  const db = openDb(appDbPath(currentDataDir()));
  try {
    if (!db.get('SELECT 1 AS x FROM items LIMIT 1')) seedInventoryDemo(db, { clock: fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00'), scale: 1 });
  } finally {
    db.close();
  }
}

/** 데모를 넣고 화면을 다시 그린 뒤 사진을 고르고 확인 체크를 한다 */
async function pickPhoto(page: Page): Promise<void> {
  ensureDemo();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
  await page.getByText('1600×1200px').first().waitFor({ timeout: 15000 });
  await page.getByLabel('사진에 환자 정보·카드번호가 보이지 않는 것을 확인했어요').check();
}

export const pages: ShotPage[] = [
  { name: 'inventory-receipt-upload', url: '/inventory/receipt', state: 'user', ready: '1. 사진 올리기', action: pickPhoto },
  {
    name: 'inventory-receipt-review',
    url: '/inventory/receipt',
    state: 'user',
    ready: '1. 사진 올리기',
    action: async (page) => {
      await pickPhoto(page);
      await page.getByRole('button', { name: 'AI로 읽기' }).click();
      await page.getByText('2. 읽은 내용 확인·수정').waitFor({ timeout: 15000 });
      await page.getByLabel('비슷한 품목 후보').first().waitFor();
    },
  },
];
