// 이 파일이 하는 일: phase-03-task-10(대시보드) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// 하늘숲치과 데모 데이터를 채운 대시보드와, 대시보드에서 연 "출고 기록" 빠른 입력 대화상자를 찍는다(빈 대시보드는 screenshots.ts의 'dashboard').
// 다른 태스크 화면이 먼저 일부 모듈의 데모 데이터를 넣었을 수 있으므로, 모듈마다 대표 테이블이 비어 있을 때만 그 모듈의 seedDemo를 부른다.
// 서버 데이터 폴더는 screenshots.ts가 이번 실행에 만든 .tmp/screens/run-<시각> 중 가장 최근 것이다(03-01·03-09와 같은 방식).
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { appDbPath, openDb, type Db } from '../../server/db/index.ts';
import { fixedClock } from '../../server/lib/clock.ts';
import { SEED_MODULES, SEED_REGISTRY, type SeedModuleName } from '../../server/db/seed/registry.ts';
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

/** 모듈별 "이미 데모가 들어갔는지" 볼 질의(한 줄이라도 있으면 건너뜀). 없는 모듈은 넣을 업무 데이터가 없다 */
const ALREADY: Partial<Record<SeedModuleName, string>> = {
  admin: "SELECT 1 AS x FROM users WHERE role <> 'admin' LIMIT 1",
  desk: 'SELECT 1 AS x FROM posts LIMIT 1',
  inventory: 'SELECT 1 AS x FROM items LIMIT 1',
  docs: 'SELECT 1 AS x FROM documents LIMIT 1',
  assistant: 'SELECT 1 AS x FROM kb_docs LIMIT 1',
  hr: 'SELECT 1 AS x FROM leave_requests LIMIT 1',
  // 법정 일정 이력과 장비(04-03)가 모두 있어야 건너뛴다(facility seed는 이미 있는 부분을 스스로 건너뛴다)
  facility: 'SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM legal_task_logs) AND EXISTS (SELECT 1 FROM equipment)',
};

/** 아직 비어 있는 모듈의 데모 데이터만 넣는다 */
async function fillDemo(db: Db): Promise<void> {
  const ctx = { clock: fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00'), scale: 1 };
  for (const name of SEED_MODULES) {
    const sql = ALREADY[name];
    if (!sql || db.get(sql)) continue;
    await SEED_REGISTRY[name].seedDemo(db, ctx);
  }
}

let seeded = false;

/** 데모 데이터를 처음 한 번만 채우고, 대시보드를 다시 그려 재고 경고 품목이 보일 때까지 기다린다 */
async function withDashboardDemo(page: Page): Promise<void> {
  if (!seeded) {
    const db = openDb(appDbPath(currentDataDir()));
    try {
      await fillDemo(db);
    } finally {
      db.close();
    }
    seeded = true;
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('region', { name: '오늘 현황' }).getByText('니트릴 글러브 M').first().waitFor({ timeout: 10000 });
}

export const pages: ShotPage[] = [
  { name: 'dashboard-demo', url: '/', state: 'user', ready: '오늘 할 일', action: withDashboardDemo },
  {
    name: 'dashboard-quickout',
    url: '/',
    state: 'user',
    ready: '오늘 할 일',
    action: async (page) => {
      await withDashboardDemo(page);
      await page.getByRole('button', { name: '출고 기록' }).click();
      await page.getByRole('dialog', { name: '출고 기록' }).getByRole('list', { name: '찾은 품목' }).getByRole('button').first().waitFor();
    },
  },
];
