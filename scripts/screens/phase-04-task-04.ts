// 이 파일이 하는 일: phase-04-task-04(지출 기록·월간 요약) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// 지출 목록(이번 달), 지출 기록 대화상자, 월간 요약(데이터가 많은 지난달, 이전 달 버튼으로 이동), 지출이 없는 달의 빈 상태를 찍는다.
// 찍기 전에 재고 데모(발주서 포함, 없을 때만)와 지출 데모(server/modules/finance/seed.ts)를 한 번만 넣는다. 서버 데이터 폴더는 이번 실행의 .tmp/screens/run-* 중 가장 최근 것이다.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { appDbPath, openDb } from '../../server/db/index.ts';
import { fixedClock } from '../../server/lib/clock.ts';
import { seedDemo as seedInventoryDemo } from '../../server/modules/inventory/seed.ts';
import { seedDemo as seedFinanceDemo } from '../../server/modules/finance/seed.ts';
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

/** 재고·지출 데모를 처음 한 번만 넣는다 */
function ensureDemo(): void {
  if (seeded) return;
  const db = openDb(appDbPath(currentDataDir()));
  try {
    const clock = fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00');
    if (!db.get('SELECT 1 AS x FROM items LIMIT 1')) seedInventoryDemo(db, { clock, scale: 1 });
    if (!db.get('SELECT 1 AS x FROM expenses LIMIT 1')) seedFinanceDemo(db, { clock, scale: 1 });
  } finally {
    db.close();
  }
  seeded = true;
}

/** 데모를 넣고 화면을 다시 그린 뒤 waitText가 보일 때까지 기다린다 */
async function withFinanceDemo(page: Page, waitText: string): Promise<void> {
  ensureDemo();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(waitText).first().waitFor({ timeout: 10000 });
}

export const pages: ShotPage[] = [
  { name: 'finance-expenses', url: '/finance/expenses', state: 'user', ready: '지출 기록', action: (page) => withFinanceDemo(page, '하늘빌딩 관리사무소') },
  {
    name: 'finance-expense-dialog',
    url: '/finance/expenses',
    state: 'user',
    ready: '지출 기록',
    action: async (page) => {
      await withFinanceDemo(page, '하늘빌딩 관리사무소');
      await page.getByRole('button', { name: '지출 기록', exact: true }).click();
      await page.getByRole('dialog', { name: '지출 기록' }).getByText('영수증(PDF·JPG·PNG)').waitFor();
    },
  },
  {
    name: 'finance-monthly',
    url: '/finance/monthly',
    state: 'user',
    ready: '월간 요약',
    action: async (page) => {
      await withFinanceDemo(page, '분류별 비중');
      await page.getByRole('button', { name: '이전 달' }).click();
      await page.getByText('2026년 10월 지출 합계').waitFor();
    },
  },
  {
    name: 'finance-monthly-empty',
    url: '/finance/monthly',
    state: 'user',
    ready: '월간 요약',
    action: async (page) => {
      await withFinanceDemo(page, '분류별 비중');
      // 한 달씩 옮기며 그 달 이름이 보일 때까지 기다린다(11월 → 6월)
      for (const m of [10, 9, 8, 7, 6]) {
        await page.getByRole('button', { name: '이전 달' }).click();
        await page.getByRole('group', { name: '달 고르기' }).getByText(`2026년 ${m}월`).waitFor();
      }
      await page.getByText('2026년 6월에는 지출 기록이 없어요').waitFor();
    },
  },
];
