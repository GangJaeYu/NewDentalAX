// 이 파일이 하는 일: phase-04-task-02(교육 이수 기록·신규 직원 온보딩) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// 찍기 전에 데모 직원(admin seed)과 hr 데모(교육 항목·이수 기록·온보딩 템플릿·배정)를 서버 DB에 한 번만 넣는다. 데이터 폴더는 .tmp/screens/run-* 중 가장 최근 것이다
// (무거운 작업은 작업 사본마다 한 번에 하나씩 돌리므로 가장 최근 폴더가 지금 실행 중인 서버의 것이다).
// 화면: 교육 이수 기록(관리자: 직원별 현황·교육 항목), 이수 기록 대화상자, 온보딩(전체 배정·AI 초안·템플릿), AI 초안 결과 편집기.
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

/** 데모 직원·hr 데모를 처음 한 번만 넣고, 화면을 다시 그려 waitText가 보일 때까지 기다린다 */
async function withTrainingDemo(page: Page, waitText: string): Promise<void> {
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
  { name: 'hr-training', url: '/hr/training', state: 'user', ready: '교육 이수 기록', action: (page) => withTrainingDemo(page, '서다온') },
  {
    name: 'hr-training-record',
    url: '/hr/training',
    state: 'user',
    ready: '교육 이수 기록',
    action: async (page) => {
      await withTrainingDemo(page, '서다온');
      await page.getByRole('button', { name: '이수 기록하기', exact: true }).first().click();
      await page.getByRole('dialog', { name: '이수 기록하기' }).getByLabel('메모(선택)').fill('보건소 온라인 교육');
    },
  },
  { name: 'hr-onboarding', url: '/hr/onboarding', state: 'user', ready: '신규 직원 온보딩', action: (page) => withTrainingDemo(page, '간호조무사 첫 달 체크리스트') },
  {
    name: 'hr-onboarding-draft',
    url: '/hr/onboarding',
    state: 'user',
    ready: '신규 직원 온보딩',
    action: async (page) => {
      await withTrainingDemo(page, '간호조무사 첫 달 체크리스트');
      await page.getByTestId('ai-panel-onboarding').getByRole('button', { name: '초안 만들기' }).click();
      await page.getByTestId('onb-draft').waitFor({ timeout: 15000 });
    },
  },
];
