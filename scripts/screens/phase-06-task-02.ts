// 이 파일이 하는 일: phase-06-task-02(AI 근무표 배정 제안) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// 찍기 전에 데모 직원(admin seed)과 hr 데모(근무표 4주·연차)를 서버 DB에 한 번만 넣는다(이미 있으면 seed가 건너뜀). 데이터 폴더는 .tmp/screens/run-* 중 가장 최근 것이다.
// 화면: "AI 배정 제안" 조건 대화상자, 데모 제안 미리보기(고친 내용·바뀌는 칸 표시). AI는 데모 모드라 실제 공급자를 부르지 않는다.
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

/** 데모 데이터를 넣고 근무표에서 "AI 배정 제안"을 연다 */
async function openSuggest(page: Page): Promise<void> {
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
  await page.getByText('정하늘').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'AI 배정 제안' }).click();
  await page.getByLabel('하루 최소 인원').waitFor();
}

export const pages: ShotPage[] = [
  { name: 'hr-roster-suggest', url: '/hr/roster', state: 'user', ready: '근무표', action: openSuggest },
  {
    name: 'hr-roster-suggest-preview',
    url: '/hr/roster',
    state: 'user',
    ready: '근무표',
    action: async (page) => {
      await openSuggest(page);
      await page.getByRole('dialog').getByRole('button', { name: '제안 받기' }).click();
      await page.getByTestId('roster-suggest-preview').waitFor({ timeout: 10000 });
    },
  },
];
