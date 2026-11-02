// 이 파일이 하는 일: phase-04-task-01(근무표) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// 찍기 전에 데모 직원(admin seed)과 hr 데모(근무표 4주·연차 신청)를 서버 DB에 한 번만 넣는다. 스크린샷 스크립트는 데이터 폴더를 .tmp/screens/run-<시각>에 만들므로
// 그중 가장 최근 폴더를 쓴다(03-09와 같은 방식, 무거운 작업은 작업 사본마다 한 번에 하나씩 돌린다).
// 화면: 주간 근무표(데모 연차 표시), 월간 근무표, 칸 고르기 대화상자, 근무 유형 관리, 대시보드 "오늘 근무" 카드, 근무표 인쇄.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { appDbPath, openDb } from '../../server/db/index.ts';
import { fixedClock } from '../../server/lib/clock.ts';
import { seedDemo as seedAdminDemo } from '../../server/modules/admin/seed.ts';
import { seedDemo as seedHrDemo } from '../../server/modules/hr/seed.ts';
import type { ShotPage } from './types.ts';

/** 지금 실행 중인 스크린샷 서버의 데이터 폴더(.tmp/screens/run-* 중 가장 최근) */
function currentDataDir(): string {
  const base = path.join(process.cwd(), '.tmp', 'screens');
  const runs = fs
    .readdirSync(base)
    .filter((n) => n.startsWith('run-'))
    .sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
  if (!runs[0]) throw new Error('스크린샷 데이터 폴더(.tmp/screens/run-*)를 찾지 못했어요.');
  return path.join(base, runs[0]);
}

let seeded = false;

/** 데모 직원·근무표를 처음 한 번만 넣고(이미 있으면 seed가 건너뜀), 화면을 다시 그려 waitText가 보일 때까지 기다린다 */
async function withRosterDemo(page: Page, waitText: string): Promise<void> {
  if (!seeded) {
    const db = openDb(appDbPath(currentDataDir()));
    try {
      const ctx = { clock: fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00'), scale: 1 };
      await seedAdminDemo(db, ctx);
      seedHrDemo(db, ctx);
    } finally {
      db.close();
    }
    seeded = true;
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(waitText).first().waitFor({ timeout: 10000 });
}

export const pages: ShotPage[] = [
  { name: 'hr-roster', url: '/hr/roster', state: 'user', ready: '근무표', action: (page) => withRosterDemo(page, '정하늘') },
  { name: 'hr-roster-month', url: '/hr/roster?view=month', state: 'user', ready: '근무표', action: (page) => withRosterDemo(page, '2026년 11월') },
  {
    name: 'hr-roster-pick',
    url: '/hr/roster',
    state: 'user',
    ready: '근무표',
    action: async (page) => {
      await withRosterDemo(page, '정하늘');
      await page.getByRole('button', { name: /^정하늘 11월 6일\(금\) / }).click();
      await page.getByTestId('roster-pick-leave').waitFor();
    },
  },
  {
    name: 'hr-roster-types',
    url: '/hr/roster',
    state: 'user',
    ready: '근무표',
    action: async (page) => {
      await withRosterDemo(page, '정하늘');
      await page.getByRole('button', { name: '근무 유형', exact: true }).click();
      await page.getByTestId('shift-types').waitFor();
    },
  },
  {
    name: 'dashboard-roster',
    url: '/',
    state: 'user',
    ready: '오늘 근무',
    action: async (page) => {
      await withRosterDemo(page, '오늘 근무');
      await page.getByTestId('roster-today').waitFor({ timeout: 10000 });
    },
  },
  { name: 'print-roster', url: '/print/roster', state: 'user', ready: '근무표 인쇄', action: (page) => withRosterDemo(page, '근무 인원') },
];
