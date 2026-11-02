// 이 파일이 하는 일: phase-03-task-09(연차·휴가) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// 찍기 전에 데모 직원(admin seed)과 데모 연차 신청(hr seed)을 서버 DB에 한 번만 넣는다. 스크린샷 스크립트는 데이터 폴더를 .tmp/screens/run-<시각>에 만들므로
// 그중 가장 최근 폴더를 쓴다(무거운 작업은 작업 사본마다 한 번에 하나씩 돌리므로 가장 최근 폴더가 지금 실행 중인 서버의 것이다).
// 화면: 관리자 화면(승인 대기·경고·직원별 연차·전체 기록), 인원 초과 경고가 있는 승인 대화상자, 일수 미리 보기가 있는 신청 대화상자.
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

/** 데모 직원·연차 신청을 처음 한 번만 넣고, 화면을 다시 그려 waitText가 보일 때까지 기다린다 */
async function withLeaveDemo(page: Page, waitText: string): Promise<void> {
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
  { name: 'hr-leave', url: '/hr/leave', state: 'user', ready: '연차·휴가', action: (page) => withLeaveDemo(page, '하루 최대 2명을 넘어요') },
  {
    name: 'hr-leave-approve',
    url: '/hr/leave',
    state: 'user',
    ready: '연차·휴가',
    action: async (page) => {
      await withLeaveDemo(page, '하루 최대 2명을 넘어요');
      await page.getByTestId('leave-pending-item').filter({ hasText: '오소담' }).getByRole('button', { name: /승인$/ }).click();
      await page.getByRole('dialog', { name: '휴가 승인' }).getByText('경고가 있어도 승인할 수 있어요.').waitFor();
    },
  },
  {
    name: 'hr-leave-request',
    url: '/hr/leave',
    state: 'user',
    ready: '연차·휴가',
    action: async (page) => {
      await withLeaveDemo(page, '하루 최대 2명을 넘어요');
      await page.getByRole('button', { name: '휴가 신청', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '휴가 신청', exact: true });
      await dialog.getByLabel('시작 날짜').fill('2026-11-14');
      await dialog.getByLabel('끝 날짜').fill('2026-11-17');
      await dialog.getByLabel('사유(선택)').fill('가족 여행');
      await dialog.getByTestId('leave-preview').waitFor();
    },
  },
];
