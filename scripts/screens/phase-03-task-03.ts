// 이 파일이 하는 일: phase-03-task-03(CSV 가져오기·내보내기) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// 처음 화면(가져오기 4단계·내보내기 버튼)과, 데모 품목 이름으로 만든 CSV를 올린 미리보기(신규·변경·변경 없음·오류 줄)를 찍는다.
// 찍기 전에 재고 데모 데이터가 없으면 한 번만 서버 DB에 넣는다(server/modules/inventory/seed.ts, phase-03-task-01 목록과 같은 방식).
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

/** 재고 데모 데이터가 없으면 넣는다 */
function ensureDemo(): void {
  const db = openDb(appDbPath(currentDataDir()));
  try {
    if (!db.get('SELECT 1 AS x FROM items LIMIT 1')) seedDemo(db, { clock: fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00'), scale: 1 });
  } finally {
    db.close();
  }
}

/** 미리보기용 CSV: 변경 2줄·신규 2줄·오류 2줄·변경 없음 1줄 */
const SAMPLE = [
  '품목명,분류,단위,적정 재고,유효기간 관리,기본 거래처,보관 위치,메모',
  '니트릴 글러브 M,소모품,박스,8,아니오,한빛덴탈,소모품실 A-1,',
  '덴탈 마스크,소모품,박스,10,,,,',
  '거즈 2×2,소모품,팩,10,,,,',
  '일회용 석션 튜브,소모품,봉,5,아니오,한빛덴탈,소모품실 A-3,새로 들여옴',
  '구강 거울(일회용),기구,개,30,아니오,미소치재,기구장 B-2,',
  '레진 A2,재료,개,다섯,예,,재료장,',
  '포셀린 버,기구,개,3,아니오,없는상사,,',
].join('\r\n');

/** 처음 화면: 데모 데이터를 넣고 다시 그린다 */
async function openImport(page: Page): Promise<void> {
  ensureDemo();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('품목 가져오기').first().waitFor({ timeout: 10000 });
}

export const pages: ShotPage[] = [
  { name: 'inventory-import', url: '/inventory/import', state: 'user', ready: 'CSV 가져오기·내보내기', action: openImport },
  {
    name: 'inventory-import-preview',
    url: '/inventory/import',
    state: 'user',
    ready: 'CSV 가져오기·내보내기',
    action: async (page) => {
      await openImport(page);
      await page.locator('input[type=file]').setInputFiles({ name: '품목-가져오기.csv', mimeType: 'text/csv', buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${SAMPLE}\r\n`, 'utf8') });
      await page.getByRole('table', { name: '가져오기 미리보기' }).waitFor({ timeout: 10000 });
    },
  },
];
